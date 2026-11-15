//! "Notify me when it finishes" (`shell.watch`) on a Herdr 2 terminal: the pure probe of a
//! core record, and the core loop of `serve` that sends one push when the command ends.

#[path = "support/fake_core.rs"]
mod fake_core;
#[path = "support/mock_http.rs"]
mod mock_http;

use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use fake_core::{event, Ctl, State};
use herdlingd::config::{self, Device, Prefs};
use herdlingd::core::client::CoreError;
use herdlingd::core::endpoint::CoreSocket;
use herdlingd::serve::shells::core_probe;
use herdlingd::serve::{core_watch, ServeCtx};
use herdlingd::shell_watch::{self, Probe};
use mock_http::MockHttp;
use serde_json::{json, Value};

/// A shell terminal: the shell is pid 100; `fg` is the foreground process.
fn shell(fg: Value) -> Value {
    json!({"address": "t2", "state": "live", "cwd": "/home/sam", "pid": 100, "labels": {}, "status": null, "foreground": fg})
}

fn busy_fg() -> Value {
    json!({"pid": 77, "name": "cargo", "argv": ["cargo", "build"], "cwd": "/home/sam/proj"})
}

fn idle_fg() -> Value {
    json!({"pid": 100, "name": "zsh", "argv": ["zsh"], "cwd": "/home/sam/proj"})
}

fn remote(kind: &str) -> CoreError {
    CoreError::Remote { kind: kind.into(), message: String::new() }
}

#[test]
fn core_probe_rules() {
    assert_eq!(core_probe(Ok(shell(idle_fg()))), Probe::Idle);
    assert_eq!(
        core_probe(Ok(shell(busy_fg()))),
        Probe::Busy { command: "cargo build".into(), cwd: Some("/home/sam/proj".into()) }
    );
    let mut done = shell(busy_fg());
    done["state"] = json!("finished");
    assert_eq!(core_probe(Ok(done)), Probe::Gone);
    assert_eq!(core_probe(Err(remote("not_found"))), Probe::Gone);
    assert_eq!(core_probe(Err(remote("finished"))), Probe::Gone);
    assert_eq!(core_probe(Err(CoreError::Unavailable("down".into()))), Probe::Unknown);
    assert_eq!(core_probe(Ok(shell(Value::Null))), Probe::Unknown, "no foreground: not known");
}

#[test]
fn foreground_events_name_the_pane() {
    assert_eq!(core_watch::foreground_pane(&event("foreground", "t2", json!({}))).as_deref(), Some("hc:t2"));
    assert_eq!(core_watch::foreground_pane(&event("title", "t2", json!({}))).as_deref(), Some("hc:t2"));
    assert_eq!(core_watch::foreground_pane(&event("status", "t2", json!({}))), None);
    assert_eq!(core_watch::foreground_pane(&event("foreground", "box/t2", json!({}))), None);
}

#[tokio::test]
async fn core_watch_sends_one_push_when_the_command_ends() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = config::default_path(dir.path());
    config::update(&cfg, |c| {
        c.devices.push(Device {
            id: "d1".into(),
            name: "Sam's phone".into(),
            host_id: "h_1".into(),
            public_key: None,
            expo_token: Some("ExponentPushToken[test]".into()),
            capabilities: vec![],
            prefs: Prefs::default(),
        })
    })
    .unwrap();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    let watches = shell_watch::path(dir.path());
    shell_watch::add(&watches, "hc:t2", Some("d1"), now).unwrap();
    // A herdr 1 watch stays for the herdr 1 loop: the core loop does not touch it.
    shell_watch::add(&watches, "w1:p1", None, now).unwrap();
    let sock = dir.path().join("core.sock");
    let core = fake_core::spawn(&sock, State { terminals: vec![shell(busy_fg())], ..State::default() });
    let mut http = MockHttp::start(json!({"data": [{"status": "ok", "id": "r1"}]})).await;
    let ctx = ServeCtx {
        core_socket: Some(CoreSocket::fixed(sock)),
        home: dir.path().into(),
        herdr_socket: dir.path().join("no-herdr.sock"),
        config_path: cfg,
        push_url: http.url.clone(),
        debounce: Duration::from_millis(50),
        pair_port: None,
        host_key_paths: vec![],
        exe: PathBuf::from("/usr/local/bin/herdlingd"),
    };
    tokio::spawn(async move { core_watch::watch(&ctx).await });
    core.wait_subscribes(1).await;
    let mut seen_busy = false;
    for _ in 0..100 {
        if shell_watch::list(&watches, now).unwrap().iter().any(|w| w.pane_id == "hc:t2" && w.busy.is_some()) {
            seen_busy = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(seen_busy, "the first poll did not see the core pane busy");
    // The command ends; the foreground event makes the check run before the next poll.
    core.state.lock().unwrap().terminals[0]["foreground"] = idle_fg();
    core.send(Ctl::Event(event("foreground", "t2", idle_fg())));
    let body = tokio::time::timeout(Duration::from_secs(2), http.bodies.recv()).await.expect("no push").unwrap();
    assert_eq!(body[0]["title"], "proj: command finished");
    assert_eq!(body[0]["body"], "cargo build");
    assert_eq!(body[0]["data"]["kind"], "shell");
    let left: Vec<String> = shell_watch::list(&watches, now).unwrap().into_iter().map(|w| w.pane_id).collect();
    assert_eq!(left, ["w1:p1"]);
    let again = tokio::time::timeout(Duration::from_millis(3500), http.bodies.recv()).await;
    assert!(again.is_err(), "one push only");
}
