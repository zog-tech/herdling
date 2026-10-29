#[path = "support/fake_herdr_events.rs"]
mod fake_herdr_events;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use fake_herdr_events::{spawn_fake_opts, status_ev, Push};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use zogsshd::rpc::{self, Ctx};

/// Fake herdr: accepts many connections. `session.snapshot` returns `panes`;
/// `events.subscribe` is acknowledged, its params are sent to the returned receiver,
/// and pushed events reach the connections whose subscriptions match, like herdr does
/// (a subscription with a `pane_id` only matches events of that pane).
fn spawn_fake_with_panes(
    path: &Path,
    panes: &[&str],
) -> (mpsc::UnboundedSender<Push>, mpsc::UnboundedReceiver<Value>) {
    let (push, reqs, _open) = spawn_fake_opts(path, panes, &[]);
    (push, reqs)
}

fn spawn_fake(path: &Path) -> (mpsc::UnboundedSender<Push>, mpsc::UnboundedReceiver<Value>) {
    spawn_fake_with_panes(path, &[])
}

struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
}

impl Session {
    fn start(sock: PathBuf, home: PathBuf) -> Session {
        Session::start_with(Ctx::new(sock, home))
    }
    fn start_with(ctx: Ctx) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(65536);
        let (server_out, client_rx) = tokio::io::duplex(65536);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
        Session { tx: client_tx, rx: BufReader::new(client_rx).lines() }
    }
    async fn send(&mut self, line: &str) {
        self.tx.write_all(format!("{line}\n").as_bytes()).await.unwrap();
    }
    async fn recv(&mut self) -> Value {
        let line = tokio::time::timeout(std::time::Duration::from_secs(5), self.rx.next_line())
            .await
            .expect("timed out waiting for output")
            .unwrap()
            .unwrap();
        serde_json::from_str(&line).unwrap()
    }
    async fn subscribe(&mut self, id: u64, params: &str) -> String {
        self.send(&format!(r#"{{"id":{id},"method":"herdr.subscribe","params":{params}}}"#)).await;
        let r = self.recv().await;
        assert_eq!(r["id"], id);
        r["result"]["stream"].as_str().unwrap_or_else(|| panic!("no stream: {r}")).to_string()
    }
}

fn ev(kind: &str, ws: &str) -> Value {
    json!({"event": kind, "data": {"type": kind, "workspace_id": ws}})
}

#[tokio::test]
async fn subscribe_forwards_events() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let (push, mut reqs) = spawn_fake(&sock);
    let mut s = Session::start(sock, dir.path().into());
    let stream = s.subscribe(1, r#"{"events":["workspace.created","workspace.closed"]}"#).await;
    assert!(stream.starts_with("herdr:"));
    let req = reqs.recv().await.unwrap();
    assert_eq!(req["method"], "events.subscribe");
    assert_eq!(
        req["params"],
        json!({"subscriptions": [{"type": "workspace.created"}, {"type": "workspace.closed"}]})
    );
    push.send(Push::Event(ev("workspace_created", "w1"))).unwrap();
    push.send(Push::Event(ev("workspace_closed", "w1"))).unwrap();
    for kind in ["workspace_created", "workspace_closed"] {
        let n = s.recv().await;
        assert_eq!(n["method"], "event");
        assert_eq!(n["params"]["stream"], stream.as_str());
        assert_eq!(n["params"]["data"]["event"], kind);
    }
}

#[tokio::test]
async fn subscribe_defaults_to_lifecycle_events() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let (_push, mut reqs) = spawn_fake(&sock);
    let mut s = Session::start(sock, dir.path().into());
    s.subscribe(1, "{}").await;
    let subs = reqs.recv().await.unwrap()["params"]["subscriptions"].clone();
    let types: Vec<&str> = subs.as_array().unwrap().iter().map(|v| v["type"].as_str().unwrap()).collect();
    assert!(types.contains(&"workspace.created") && types.contains(&"pane.exited"));
    assert!(!types.contains(&"pane.output_matched"));
}

#[tokio::test]
async fn subscribe_reports_close() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let (push, _reqs) = spawn_fake(&sock);
    let mut s = Session::start(sock, dir.path().into());
    let stream = s.subscribe(1, "{}").await;
    push.send(Push::Drop).unwrap();
    let n = s.recv().await;
    assert_eq!(n["params"]["stream"], stream.as_str());
    assert_eq!(n["params"]["data"], json!({"closed": true}));
}

#[tokio::test]
async fn cancel_stops_stream() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let (push, _reqs) = spawn_fake(&sock);
    let mut s = Session::start(sock, dir.path().into());
    let stream = s.subscribe(1, "{}").await;
    s.send(&format!(r#"{{"id":2,"method":"rpc.cancel","params":{{"stream":"{stream}"}}}}"#)).await;
    let r = s.recv().await;
    assert_eq!(r["id"], 2);
    assert_eq!(r["result"]["cancelled"], true);
    // Cancel is acknowledged first, then herdr emits an event: nothing may arrive.
    let _ = push.send(Push::Event(ev("workspace_created", "w2")));
    let got = tokio::time::timeout(std::time::Duration::from_millis(200), s.rx.next_line()).await;
    assert!(got.is_err(), "event forwarded after cancel: {got:?}");
}

#[tokio::test]
async fn subscribe_idle_longer_than_timeout_stays_open() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let (push, _reqs) = spawn_fake(&sock);
    let mut ctx = Ctx::new(sock, dir.path().into());
    ctx.herdr_timeout = std::time::Duration::from_millis(100);
    let mut s = Session::start_with(ctx);
    let stream = s.subscribe(1, "{}").await;
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    push.send(Push::Event(ev("workspace_created", "w3"))).unwrap();
    let n = s.recv().await;
    assert_eq!(n["params"]["stream"], stream.as_str());
    assert_eq!(n["params"]["data"]["event"], "workspace_created");
}

#[tokio::test]
async fn subscribe_unavailable_returns_error() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(dir.path().join("none.sock"), dir.path().into());
    s.send(r#"{"id":1,"method":"herdr.subscribe","params":{}}"#).await;
    assert_eq!(s.recv().await["error"]["code"], "herdr_unavailable");
}

#[tokio::test]
async fn default_subscribe_forwards_status_of_snapshot_panes() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let (push, mut reqs) = spawn_fake_with_panes(&sock, &["w1:p1", "w1:p2"]);
    let mut s = Session::start(sock, dir.path().into());
    let stream = s.subscribe(1, "{}").await;
    let _lifecycle = reqs.recv().await.unwrap();
    let status = reqs.recv().await.unwrap();
    assert_eq!(
        status["params"]["subscriptions"],
        json!([
            {"type": "pane.agent_status_changed", "pane_id": "w1:p1"},
            {"type": "pane.agent_status_changed", "pane_id": "w1:p2"}
        ])
    );
    push.send(Push::Event(status_ev("w1:p2", "blocked"))).unwrap();
    let n = s.recv().await;
    assert_eq!(n["params"]["stream"], stream.as_str());
    assert_eq!(n["params"]["data"]["data"]["agent_status"], "blocked");
}

#[tokio::test]
async fn new_pane_gets_status_subscription() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let (push, mut reqs) = spawn_fake_with_panes(&sock, &[]);
    let mut s = Session::start(sock, dir.path().into());
    s.subscribe(1, "{}").await;
    let _lifecycle = reqs.recv().await.unwrap();
    push.send(Push::Event(json!({"event": "pane.created", "data": {"pane": {"pane_id": "w1:p9"}}}))).unwrap();
    let created = s.recv().await;
    assert_eq!(created["params"]["data"]["event"], "pane.created");
    let status = reqs.recv().await.unwrap();
    assert_eq!(status["params"]["subscriptions"], json!([{"type": "pane.agent_status_changed", "pane_id": "w1:p9"}]));
    push.send(Push::Event(status_ev("w1:p9", "working"))).unwrap();
    let n = s.recv().await;
    assert_eq!(n["params"]["data"]["data"]["pane_id"], "w1:p9");
}

#[tokio::test]
async fn cancel_stops_status_connections_too() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let (push, _reqs) = spawn_fake_with_panes(&sock, &["w1:p1"]);
    let mut s = Session::start(sock, dir.path().into());
    let stream = s.subscribe(1, "{}").await;
    s.send(&format!(r#"{{"id":2,"method":"rpc.cancel","params":{{"stream":"{stream}"}}}}"#)).await;
    assert_eq!(s.recv().await["result"]["cancelled"], true);
    let _ = push.send(Push::Event(status_ev("w1:p1", "idle")));
    let got = tokio::time::timeout(std::time::Duration::from_millis(200), s.rx.next_line()).await;
    assert!(got.is_err(), "event forwarded after cancel: {got:?}");
}

/// Waits until `open` equals `want`, failing after 2 s.
async fn wait_open(open: &AtomicUsize, want: usize) {
    for _ in 0..200 {
        if open.load(Ordering::SeqCst) == want {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("open connections: {} (want {want})", open.load(Ordering::SeqCst));
}

#[tokio::test]
async fn status_falls_back_to_one_connection_per_pane() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let (push, mut reqs, open) = spawn_fake_opts(&sock, &["w1:p1", "w1:p2", "w1:p3"], &["w1:p2"]);
    let mut s = Session::start(sock, dir.path().into());
    let stream = s.subscribe(1, "{}").await;
    // Lifecycle, rejected batch, then one request per pane.
    let mut single: Vec<String> = vec![];
    for _ in 0..5 {
        let r = tokio::time::timeout(Duration::from_secs(2), reqs.recv()).await.expect("missing subscribe request").unwrap();
        let subs = r["params"]["subscriptions"].as_array().unwrap().clone();
        if subs.len() == 1 && subs[0]["pane_id"].is_string() {
            single.push(subs[0]["pane_id"].as_str().unwrap().to_string());
        }
    }
    single.sort();
    assert_eq!(single, ["w1:p1", "w1:p2", "w1:p3"]);
    // Lifecycle plus the two accepted per-pane connections stay open.
    wait_open(&open, 3).await;
    push.send(Push::Event(status_ev("w1:p1", "working"))).unwrap();
    push.send(Push::Event(status_ev("w1:p3", "blocked"))).unwrap();
    let mut got: Vec<String> = vec![];
    for _ in 0..2 {
        let n = s.recv().await;
        assert_eq!(n["params"]["stream"], stream.as_str());
        got.push(n["params"]["data"]["data"]["pane_id"].as_str().unwrap().to_string());
    }
    got.sort();
    assert_eq!(got, ["w1:p1", "w1:p3"]);
}

fn closed_ev(pane: &str) -> Value {
    json!({"event": "pane.closed", "data": {"type": "pane_closed", "pane_id": pane, "workspace_id": "w1"}})
}

#[tokio::test]
async fn closed_pane_drops_its_status_connection() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let (push, _reqs, open) = spawn_fake_opts(&sock, &["w1:p1", "w1:p2"], &[]);
    let mut s = Session::start(sock, dir.path().into());
    s.subscribe(1, "{}").await;
    wait_open(&open, 2).await; // lifecycle + batch status
    push.send(Push::Event(json!({"event": "pane.created", "data": {"pane": {"pane_id": "w1:p9"}}}))).unwrap();
    s.recv().await;
    wait_open(&open, 3).await;
    push.send(Push::Event(closed_ev("w1:p9"))).unwrap();
    assert_eq!(s.recv().await["params"]["data"]["event"], "pane.closed");
    wait_open(&open, 2).await;
    // The batch connection stays while one of its panes is open.
    push.send(Push::Event(closed_ev("w1:p1"))).unwrap();
    s.recv().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(open.load(Ordering::SeqCst), 2);
    push.send(Push::Event(closed_ev("w1:p2"))).unwrap();
    s.recv().await;
    wait_open(&open, 1).await;
}

#[tokio::test]
async fn idle_exit_closes_every_herdr_connection() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let (push, _reqs, open) = spawn_fake_opts(&sock, &["w1:p1"], &[]);
    let mut ctx = Ctx::new(sock, dir.path().into());
    ctx.idle_timeout = Duration::from_millis(300);
    let mut s = Session::start_with(ctx);
    s.subscribe(1, "{}").await;
    push.send(Push::Event(json!({"event": "pane.created", "data": {"pane": {"pane_id": "w1:p2"}}}))).unwrap();
    s.recv().await;
    wait_open(&open, 3).await; // lifecycle, snapshot-pane status, new-pane status
    // No more requests: the watchdog fires and every connection closes.
    wait_open(&open, 0).await;
    let eof = tokio::time::timeout(Duration::from_secs(2), s.rx.next_line()).await.unwrap().unwrap();
    assert!(eof.is_none(), "output still open: {eof:?}");
}
