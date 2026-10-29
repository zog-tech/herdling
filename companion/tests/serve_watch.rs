#[path = "support/fake_herdr_events.rs"]
mod fake_herdr_events;
#[path = "support/mock_http.rs"]
mod mock_http;

use std::path::{Path, PathBuf};
use std::time::Duration;

use fake_herdr_events::{spawn_fake_snapshot, status_ev, Push};
use mock_http::MockHttp;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use zogsshd::config::{self, Device, Prefs};
use zogsshd::serve::{watch::watch, ServeCtx};

const TOKEN: &str = "ExponentPushToken[test]";

fn snapshot() -> Value {
    json!({"snapshot": {
        "panes": [{"pane_id": "w1:p1", "workspace_id": "w1"}],
        "agents": [{"pane_id": "w1:p1", "workspace_id": "w1", "agent": "claude",
                    "agent_status": "working", "terminal_title_stripped": "api"}],
        "workspaces": [{"workspace_id": "w1", "label": "zogssh"}]
    }})
}

fn ok_reply() -> Value {
    json!({"data": [{"status": "ok", "id": "r1"}]})
}

fn write_device(path: &Path, prefs: Prefs) {
    config::update(path, |c| {
        c.devices.push(Device {
            id: "d1".into(),
            name: "Sam's phone".into(),
            host_id: "h_1".into(),
            public_key: None,
            expo_token: Some(TOKEN.into()),
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
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let config = config::default_path(dir.path());
    write_device(&config, prefs);
    let (push, reqs, _open) = spawn_fake_snapshot(&sock, snapshot(), &[]);
    let http = MockHttp::start(reply).await;
    let ctx = ServeCtx {
        home: dir.path().into(),
        herdr_socket: sock.clone(),
        config_path: config.clone(),
        push_url: http.url.clone(),
        debounce: Duration::from_millis(50),
        pair_port: None,
        host_key_paths: vec![],
        exe: PathBuf::from("/usr/local/bin/zogsshd"),
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
        json!([{"to": TOKEN, "title": "api finished", "body": "zogssh", "sound": "default",
                "data": {"hostId": "h_1", "paneId": "w1:p1"}}])
    );
    s.assert_no_body(Duration::from_millis(300)).await;
}

#[tokio::test]
async fn respects_prefs() {
    let mut s = start(Prefs { finished: true, needs_you: false }, ok_reply()).await;
    s.push.send(Push::Event(status_ev("w1:p1", "blocked"))).unwrap();
    s.assert_no_body(Duration::from_millis(300)).await;
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
    assert_eq!(body[0]["title"], "api finished");
    assert_eq!(body.as_array().unwrap().len(), 1);
    s.assert_no_body(Duration::from_millis(300)).await;
}
