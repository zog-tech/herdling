//! `serve` and "Notify me when it finishes" (`shell.watch`): the poll of `pane.process_info`
//! and the early check after `pane.updated`.

#[path = "support/fake_herdr_events.rs"]
mod fake_herdr_events;
#[path = "support/mock_http.rs"]
mod mock_http;

use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use fake_herdr_events::{spawn_fake_snapshot, Push};
use herdlingd::config::{self, Device, Prefs};
use herdlingd::serve::{watch::watch, ServeCtx};
use herdlingd::shell_watch;
use mock_http::MockHttp;
use serde_json::{json, Value};
use tokio::sync::mpsc;

const TOKEN: &str = "ExponentPushToken[test]";
const PANE: &str = "w1:p1";

fn busy() -> Value {
    json!({"shell_pid": 41, "foreground_process_group_id": 77,
           "foreground_processes": [{"pid": 77, "name": "cargo", "cmdline": "cargo build"}]})
}

fn idle() -> Value {
    json!({"shell_pid": 41, "foreground_process_group_id": 41})
}

/// The herdr state: one shell pane, with `info` as its `pane.process_info`.
fn herdr_state(info: Value) -> Value {
    json!({
        "snapshot": {"panes": [{"pane_id": PANE, "workspace_id": "w1", "cwd": "/home/sam/proj"}], "agents": []},
        "process_info": {PANE: info}
    })
}

/// A `pane.updated` event line, as herdr sends it for a terminal title change.
fn updated_ev(pane: &str) -> Value {
    json!({"event": "pane.updated",
           "data": {"type": "pane_updated", "pane": {"pane_id": pane, "workspace_id": "w1", "terminal_title": "zsh"}}})
}

struct Setup {
    _dir: tempfile::TempDir,
    push: mpsc::UnboundedSender<Push>,
    reqs: mpsc::UnboundedReceiver<Value>,
    http: MockHttp,
}

/// Fake herdr with a busy shell pane, a watch of that pane, one device and the watcher.
/// Returns after the first poll saw the pane busy.
async fn start() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let config_path = config::default_path(dir.path());
    config::update(&config_path, |c| {
        c.devices.push(Device {
            id: "d1".into(),
            name: "Sam's phone".into(),
            host_id: "h_1".into(),
            public_key: None,
            expo_token: Some(TOKEN.into()),
            capabilities: vec![],
            prefs: Prefs::default(),
        })
    })
    .unwrap();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    shell_watch::add(&shell_watch::path(dir.path()), PANE, Some("d1"), now).unwrap();
    let (push, reqs, _open) = spawn_fake_snapshot(&sock, herdr_state(busy()), &[]);
    let http = MockHttp::start(json!({"data": [{"status": "ok", "id": "r1"}]})).await;
    let ctx = ServeCtx {
        core_socket: None,
        home: dir.path().into(),
        herdr_socket: sock,
        config_path,
        push_url: http.url.clone(),
        debounce: Duration::from_millis(50),
        pair_port: None,
        host_key_paths: vec![],
        exe: PathBuf::from("/usr/local/bin/herdlingd"),
    };
    let watches = shell_watch::path(dir.path());
    tokio::spawn(async move { watch(&ctx).await });
    let mut s = Setup { _dir: dir, push, reqs, http };
    s.wait_subscribed().await;
    // The first poll runs at once and saves the busy command.
    for _ in 0..100 {
        if shell_watch::list(&watches, now).unwrap().first().is_some_and(|w| w.busy.is_some()) {
            return s;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the first poll did not see the pane busy");
}

impl Setup {
    /// Waits for the lifecycle and the status subscription of the watcher.
    async fn wait_subscribed(&mut self) {
        for _ in 0..2 {
            tokio::time::timeout(Duration::from_secs(5), self.reqs.recv())
                .await
                .expect("watcher did not subscribe")
                .unwrap();
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    async fn body_within(&mut self, wait: Duration) -> Value {
        tokio::time::timeout(wait, self.http.bodies.recv()).await.expect("no push request").unwrap()
    }

    async fn assert_no_body(&mut self, wait: Duration) {
        let got = tokio::time::timeout(wait, self.http.bodies.recv()).await;
        assert!(got.is_err(), "unexpected push request: {got:?}");
    }
}

fn assert_command_push(body: &Value) {
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["title"], "proj: command finished");
    assert_eq!(body[0]["body"], "cargo build");
    assert_eq!(body[0]["data"]["kind"], "shell");
}

#[tokio::test]
async fn pane_updated_sends_the_push_before_the_poll() {
    let mut s = start().await;
    s.push.send(Push::Snapshot(herdr_state(idle()))).unwrap();
    let sent = Instant::now();
    s.push.send(Push::Event(updated_ev(PANE))).unwrap();
    // The poll comes `POLL` after the first check; the early check comes well before.
    let body = s.body_within(Duration::from_millis(1500)).await;
    assert!(sent.elapsed() < shell_watch::POLL / 2, "push took {:?}", sent.elapsed());
    assert_command_push(&body);
    // The next poll finds no watch: no second push.
    s.assert_no_body(shell_watch::POLL + Duration::from_millis(500)).await;
}

#[tokio::test]
async fn pane_updated_of_another_pane_does_not_check() {
    let mut s = start().await;
    s.push.send(Push::Snapshot(herdr_state(idle()))).unwrap();
    s.push.send(Push::Event(updated_ev("w1:p9"))).unwrap();
    s.assert_no_body(Duration::from_millis(1000)).await;
    // The poll still finds the end of the command.
    assert_command_push(&s.body_within(shell_watch::POLL).await);
}

#[tokio::test]
async fn poll_alone_sends_the_push_when_herdr_sends_no_pane_updated() {
    // An older herdr, or a shell that does not set the title.
    let mut s = start().await;
    s.push.send(Push::Snapshot(herdr_state(idle()))).unwrap();
    assert_command_push(&s.body_within(shell_watch::POLL + Duration::from_millis(1000)).await);
    s.assert_no_body(shell_watch::POLL + Duration::from_millis(500)).await;
}

#[tokio::test]
async fn one_push_after_a_reconnect() {
    let mut s = start().await;
    s.push.send(Push::Drop).unwrap();
    s.push.send(Push::Snapshot(herdr_state(idle()))).unwrap();
    s.wait_subscribed().await;
    s.push.send(Push::Event(updated_ev(PANE))).unwrap();
    assert_command_push(&s.body_within(shell_watch::POLL).await);
    s.assert_no_body(shell_watch::POLL + Duration::from_millis(500)).await;
}
