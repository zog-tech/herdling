#[path = "support/fake_herdr_events.rs"]
mod fake_herdr_events;
#[path = "support/mock_http.rs"]
mod mock_http;

use std::path::{Path, PathBuf};
use std::time::Duration;

use fake_herdr_events::{spawn_fake_flaky, spawn_fake_snapshot, status_ev, Push};
use mock_http::MockHttp;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use herdlingd::config::{self, Device, Prefs};
use herdlingd::serve::{watch::watch, ServeCtx};

const TOKEN: &str = "ExponentPushToken[test]";

fn snapshot() -> Value {
    json!({"snapshot": {
        "panes": [{"pane_id": "w1:p1", "workspace_id": "w1"}],
        "agents": [{"pane_id": "w1:p1", "workspace_id": "w1", "agent": "claude",
                    "agent_status": "working", "terminal_title_stripped": "api"}],
        "workspaces": [{"workspace_id": "w1", "label": "herdling"}]
    }})
}

fn ok_reply() -> Value {
    json!({"data": [{"status": "ok", "id": "r1"}]})
}

fn write_device(path: &Path, prefs: Prefs, capabilities: &[&str]) {
    config::update(path, |c| {
        c.devices.push(Device {
            id: "d1".into(),
            name: "Sam's phone".into(),
            host_id: "h_1".into(),
            public_key: None,
            expo_token: Some(TOKEN.into()),
            capabilities: capabilities.iter().map(|c| c.to_string()).collect(),
            prefs,
        })
    })
    .unwrap();
}

struct Setup {
    _dir: tempfile::TempDir,
    sock: PathBuf,
    config: PathBuf,
    push: mpsc::UnboundedSender<Push>,
    reqs: mpsc::UnboundedReceiver<Value>,
    http: MockHttp,
}

/// Fake herdr, mock push server and config with one device, then the watcher.
async fn start(prefs: Prefs, reply: Value) -> Setup {
    start_with(prefs, reply, snapshot(), &[]).await
}

/// Like [`start`], with the herdr snapshot (and screen) and the device capabilities.
async fn start_with(prefs: Prefs, reply: Value, snap: Value, capabilities: &[&str]) -> Setup {
    start_flaky(prefs, reply, snap, capabilities, &[]).await
}

/// Like [`start_with`], and the `session.snapshot` calls numbered in `fail_snapshots` fail.
async fn start_flaky(prefs: Prefs, reply: Value, snap: Value, capabilities: &[&str], fail_snapshots: &[usize]) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let config = config::default_path(dir.path());
    write_device(&config, prefs, capabilities);
    let (push, reqs, _open) = spawn_fake_flaky(&sock, snap, &[], fail_snapshots);
    let http = MockHttp::start(reply).await;
    let ctx = ServeCtx {
        home: dir.path().into(),
        herdr_socket: sock.clone(),
        config_path: config.clone(),
        push_url: http.url.clone(),
        debounce: Duration::from_millis(50),
        pair_port: None,
        host_key_paths: vec![],
        exe: PathBuf::from("/usr/local/bin/herdlingd"),
    };
    tokio::spawn(async move { watch(&ctx).await });
    let mut s = Setup { _dir: dir, sock, config, push, reqs, http };
    s.wait_subscribed().await;
    s
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
        // Let the watcher read its seed snapshot.
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    async fn next_body(&mut self) -> Value {
        tokio::time::timeout(Duration::from_secs(3), self.http.bodies.recv())
            .await
            .expect("no push request")
            .unwrap()
    }

    async fn assert_no_body(&mut self, wait: Duration) {
        let got = tokio::time::timeout(wait, self.http.bodies.recv()).await;
        assert!(got.is_err(), "unexpected push request: {got:?}");
    }
}

#[tokio::test]
async fn pushes_finished_to_expo() {
    let mut s = start(Prefs::default(), ok_reply()).await;
    s.push.send(Push::Event(status_ev("w1:p1", "idle"))).unwrap();
    let body = s.next_body().await;
    assert_eq!(
        body,
        // Title: the workspace label, as herdr shows it. Body: agent kind · terminal title.
        json!([{"to": TOKEN, "title": "herdling finished", "body": "claude · api", "interruptionLevel": "passive",
                "collapseId": "herdling:h_1:w1:p1", "tag": "herdling:h_1:w1:p1", "threadId": "herdling:h_1",
                "data": {"hostId": "h_1", "paneId": "w1:p1"}}])
    );
    s.assert_no_body(Duration::from_millis(300)).await;
}

#[tokio::test]
async fn respects_prefs() {
    let mut s = start(Prefs { needs_you: false, ..Prefs::default() }, ok_reply()).await;
    s.push.send(Push::Event(status_ev("w1:p1", "blocked"))).unwrap();
    s.assert_no_body(Duration::from_millis(300)).await;
}

fn focus_ev(pane: &str) -> Value {
    json!({"event": "pane.focused", "data": {"type": "pane_focused", "pane_id": pane, "workspace_id": "w1"}})
}

#[tokio::test]
async fn quiet_while_at_desk() {
    let mut s = start(Prefs::default(), ok_reply()).await;
    s.push.send(Push::Event(focus_ev("w1:p1"))).unwrap();
    s.push.send(Push::Event(status_ev("w1:p1", "idle"))).unwrap();
    s.assert_no_body(Duration::from_millis(300)).await;
}

#[tokio::test]
async fn pushes_at_desk_when_pref_is_off() {
    let mut s = start(Prefs { quiet_at_desk: false, ..Prefs::default() }, ok_reply()).await;
    s.push.send(Push::Event(focus_ev("w1:p1"))).unwrap();
    s.push.send(Push::Event(status_ev("w1:p1", "idle"))).unwrap();
    assert_eq!(s.next_body().await[0]["title"], "herdling finished");
}

#[tokio::test]
async fn clears_unregistered_token() {
    let reply = json!({"data": [{"status": "error", "message": "not registered", "details": {"error": "DeviceNotRegistered"}}]});
    let mut s = start(Prefs::default(), reply).await;
    s.push.send(Push::Event(status_ev("w1:p1", "idle"))).unwrap();
    s.next_body().await;
    for _ in 0..100 {
        if config::load(&s.config).unwrap().devices[0].expo_token.is_none() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("token not cleared");
}

#[tokio::test]
async fn reconnects_after_herdr_restart() {
    let mut s = start(Prefs::default(), ok_reply()).await;
    s.push.send(Push::Drop).unwrap();
    // herdr restarts: a new process binds the same socket path.
    tokio::time::sleep(Duration::from_millis(100)).await;
    std::fs::remove_file(&s.sock).unwrap();
    let (push, reqs, _open) = spawn_fake_snapshot(&s.sock, snapshot(), &[]);
    s.push = push;
    s.reqs = reqs;
    s.wait_subscribed().await;
    s.push.send(Push::Event(status_ev("w1:p1", "idle"))).unwrap();
    let body = s.next_body().await;
    assert_eq!(body[0]["title"], "herdling finished");
    assert_eq!(body.as_array().unwrap().len(), 1);
    s.assert_no_body(Duration::from_millis(300)).await;
}

#[tokio::test]
async fn failed_seed_snapshot_does_not_lose_the_first_push() {
    // Call 1 is the pane list of the subscription, call 2 the seed of the statuses.
    let mut s = start_flaky(Prefs::default(), ok_reply(), snapshot(), &[], &[2]).await;
    tokio::time::sleep(Duration::from_millis(600)).await;
    // The snapshot says "working", so this is the end of the work.
    s.push.send(Push::Event(status_ev("w1:p1", "idle"))).unwrap();
    assert_eq!(s.next_body().await[0]["title"], "herdling finished");
}

fn pane_ev(kind: &str, pane: &str) -> Value {
    let data = match kind {
        "pane.created" => json!({"type": "pane_created", "pane": {"pane_id": pane}, "workspace_id": "w1"}),
        _ => json!({"type": "pane_closed", "pane_id": pane, "workspace_id": "w1"}),
    };
    json!({"event": kind, "data": data})
}

#[tokio::test]
async fn closed_focused_pane_is_not_focused_any_more() {
    let mut snap = snapshot();
    snap["snapshot"]["focused_pane_id"] = json!("w1:p1");
    let mut s = start_with(Prefs::default(), ok_reply(), snap, &[]).await;
    s.push.send(Push::Event(pane_ev("pane.closed", "w1:p1"))).unwrap();
    // herdr gives the same pane id to a new pane that nobody focused.
    s.push.send(Push::Event(pane_ev("pane.created", "w1:p1"))).unwrap();
    tokio::time::timeout(Duration::from_secs(5), s.reqs.recv()).await.expect("new pane not subscribed").unwrap();
    for status in ["idle", "working", "done"] {
        s.push.send(Push::Event(status_ev("w1:p1", status))).unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // Work that starts in a pane without focus is no desk activity, so the push goes out.
    assert_eq!(s.next_body().await[0]["title"], "herdling finished");
}

const MENU: &str ="Bash command\n  git status\nDo you want to proceed?\n❯ 1. Yes\n  2. Yes, and don't ask again for git status commands\n  3. No, and tell Claude what to do differently (esc)";

fn snapshot_with_screen(screen: &str) -> Value {
    let mut s = snapshot();
    s["screen"] = json!(screen);
    s
}

#[tokio::test]
async fn needs_you_push_has_choice_buttons_for_a_capable_device() {
    let mut s = start_with(Prefs::default(), ok_reply(), snapshot_with_screen(MENU), &["choice_actions"]).await;
    s.push.send(Push::Event(status_ev("w1:p1", "blocked"))).unwrap();
    let body = s.next_body().await;
    assert_eq!(
        body,
        json!([{"to": TOKEN, "title": "herdling needs you",
                "body": "claude · api\nYes · No, and tell Claude what to do differently (esc)",
                "sound": "default", "categoryId": "herdling_choice", "interruptionLevel": "time-sensitive",
                "collapseId": "herdling:h_1:w1:p1", "tag": "herdling:h_1:w1:p1", "threadId": "herdling:h_1",
                "data": {"hostId": "h_1", "paneId": "w1:p1",
                         "choice": {"yes": {"key": "1", "label": "Yes"},
                                    "no": {"key": "3", "label": "No, and tell Claude what to do differently (esc)"},
                                    "revision": 3}}}])
    );
    // The question text never leaves the computer.
    assert!(!body.to_string().contains("proceed"));
}

#[tokio::test]
async fn needs_you_push_has_no_buttons_for_an_older_app() {
    let mut s = start_with(Prefs::default(), ok_reply(), snapshot_with_screen(MENU), &[]).await;
    s.push.send(Push::Event(status_ev("w1:p1", "blocked"))).unwrap();
    assert_eq!(
        s.next_body().await,
        json!([{"to": TOKEN, "title": "herdling needs you", "body": "claude · api", "sound": "default",
                "interruptionLevel": "time-sensitive",
                "collapseId": "herdling:h_1:w1:p1", "tag": "herdling:h_1:w1:p1", "threadId": "herdling:h_1",
                "data": {"hostId": "h_1", "paneId": "w1:p1"}}])
    );
}

#[tokio::test]
async fn needs_you_push_has_no_buttons_without_a_yes_no_menu() {
    let menu = "❯ 1. Allow\n  2. Deny";
    let mut s = start_with(Prefs::default(), ok_reply(), snapshot_with_screen(menu), &["choice_actions"]).await;
    s.push.send(Push::Event(status_ev("w1:p1", "blocked"))).unwrap();
    let body = s.next_body().await;
    assert_eq!(body[0]["body"], "claude · api");
    assert!(body[0].get("categoryId").is_none());
    assert!(body[0]["data"].get("choice").is_none());
}
