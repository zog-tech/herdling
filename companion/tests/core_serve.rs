//! `serve` pushes from herdr-core status events: done gives "finished", blocked gives "needs
//! you", with a fake core and no herdr 1. Also `missed` and reconnects.

#[path = "support/fake_core.rs"]
mod fake_core;
#[path = "support/mock_http.rs"]
mod mock_http;

use std::path::PathBuf;
use std::time::Duration;

use fake_core::{event, status_event, terminal, Ctl, FakeCore, State};
use herdlingd::config::{self, Device, Prefs};
use herdlingd::core::endpoint::CoreSocket;
use herdlingd::serve::{core_watch, ServeCtx};
use mock_http::MockHttp;
use serde_json::{json, Value};

const TOKEN: &str = "ExponentPushToken[test]";

struct Setup {
    _dir: tempfile::TempDir,
    core: FakeCore,
    http: MockHttp,
}

async fn start(capabilities: &[&str]) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let cfg = config::default_path(dir.path());
    config::update(&cfg, |c| {
        c.devices.push(Device {
            id: "d1".into(),
            name: "Sam's phone".into(),
            host_id: "h_1".into(),
            public_key: None,
            expo_token: Some(TOKEN.into()),
            capabilities: capabilities.iter().map(|c| c.to_string()).collect(),
            prefs: Prefs::default(),
        })
    })
    .unwrap();
    let sock = dir.path().join("core.sock");
    let core = fake_core::spawn(
        &sock,
        State {
            terminals: vec![terminal("t1", Some("api"), Some("working"))],
            screen: "Allow?\n❯ 1. Yes\n  2. No, and tell Claude what to do differently (esc)\n".into(),
            ..State::default()
        },
    );
    let http = MockHttp::start(json!({"data": [{"status": "ok", "id": "r1"}]})).await;
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
    tokio::time::sleep(Duration::from_millis(100)).await;
    Setup { _dir: dir, core, http }
}

impl Setup {
    async fn next_body(&mut self) -> Value {
        tokio::time::timeout(Duration::from_secs(3), self.http.bodies.recv()).await.expect("no push request").unwrap()
    }
    async fn assert_no_body(&mut self, wait: Duration) {
        let got = tokio::time::timeout(wait, self.http.bodies.recv()).await;
        assert!(got.is_err(), "unexpected push request: {got:?}");
    }
}

#[tokio::test]
async fn done_gives_finished() {
    let mut s = start(&[]).await;
    s.core.send(Ctl::Event(status_event("t1", "done")));
    let body = s.next_body().await;
    assert_eq!(body[0]["title"], "api finished");
    assert_eq!(body[0]["body"], "Claude Code");
    assert_eq!(body[0]["data"], json!({"hostId": "h_1", "paneId": "hc:t1"}));
    s.assert_no_body(Duration::from_millis(300)).await;
}

#[tokio::test]
async fn blocked_and_error_give_needs_you_with_choices() {
    let mut s = start(&[config::CHOICE_ACTIONS]).await;
    s.core.send(Ctl::Event(status_event("t1", "error")));
    let body = s.next_body().await;
    assert_eq!(body[0]["title"], "api needs you");
    assert_eq!(body[0]["interruptionLevel"], "time-sensitive");
    assert_eq!(body[0]["categoryId"], "herdling_choice");
    assert_eq!(body[0]["data"]["choice"]["yes"]["key"], "1");
}

#[tokio::test]
async fn a_short_status_and_a_finished_terminal_send_nothing() {
    let mut s = start(&[]).await;
    // Done, then working again within the debounce window: no push.
    s.core.send(Ctl::Event(status_event("t1", "done")));
    s.core.send(Ctl::Event(status_event("t1", "working")));
    s.assert_no_body(Duration::from_millis(300)).await;
    // Done, then the terminal ends: the pending notice goes with it.
    s.core.send(Ctl::Event(status_event("t1", "done")));
    s.core.send(Ctl::Event(event("finished", "t1", json!({"reason": "exited"}))));
    s.assert_no_body(Duration::from_millis(300)).await;
    // Other machines never push.
    s.core.send(Ctl::Event(json!({"seq": 9, "type": "status", "terminal": "box/t1", "data": {"status": {"state": "blocked"}}})));
    s.assert_no_body(Duration::from_millis(300)).await;
}

#[tokio::test]
async fn missed_reconciles_and_reconnect_takes_a_new_baseline() {
    let mut s = start(&[]).await;
    // Lost events: the missed snapshot shows t1 done, so the change gives its push.
    let mut t1 = terminal("t1", Some("api"), Some("done"));
    t1["status"]["msg"] = json!("");
    s.core.send(Ctl::Missed(json!({"seq": 7, "terminals": [t1.clone()]})));
    assert_eq!(s.next_body().await[0]["title"], "api finished");
    // A reconnect: the new snapshot is a baseline, so no push for the state it shows.
    s.core.state.lock().unwrap().terminals = vec![terminal("t1", Some("api"), Some("blocked"))];
    s.core.send(Ctl::Drop);
    s.core.wait_subscribes(2).await;
    s.assert_no_body(Duration::from_millis(400)).await;
    s.core.send(Ctl::Event(status_event("t1", "working")));
    s.core.send(Ctl::Event(status_event("t1", "done")));
    assert_eq!(s.next_body().await[0]["title"], "api finished");
}
