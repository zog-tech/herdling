use std::path::PathBuf;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::mpsc;
use zogsshd::rpc::{self, Ctx};

/// Commands the test sends to the fake herdr.
enum Push {
    /// Delivered to every subscription connection with a matching subscription.
    Event(Value),
    /// Closes the first subscription connection (the lifecycle one).
    Drop,
}

fn event_name(v: &Value) -> String {
    v["event"].as_str().unwrap_or("").replace('.', "_")
}

/// Fake herdr: accepts many connections. `session.snapshot` returns `panes`;
/// `events.subscribe` is acknowledged, its params are sent to the returned receiver,
/// and pushed events reach the connections whose subscriptions match, like herdr does
/// (a subscription with a `pane_id` only matches events of that pane).
fn spawn_fake_with_panes(
    path: &PathBuf,
    panes: &[&str],
) -> (mpsc::UnboundedSender<Push>, mpsc::UnboundedReceiver<Value>) {
    let listener = UnixListener::bind(path).unwrap();
    let (push_tx, mut push_rx) = mpsc::unbounded_channel::<Push>();
    let (req_tx, req_rx) = mpsc::unbounded_channel::<Value>();
    let (bus, _) = tokio::sync::broadcast::channel::<Option<Value>>(64);
    let snapshot = json!({"snapshot": {"panes": panes.iter().map(|p| json!({"pane_id": p})).collect::<Vec<_>>()}});
    let bus2 = bus.clone();
    tokio::spawn(async move {
        while let Some(p) = push_rx.recv().await {
            match p {
                Push::Event(v) => {
                    let _ = bus2.send(Some(v));
                }
                Push::Drop => {
                    let _ = bus2.send(None);
                }
            }
        }
    });
    tokio::spawn(async move {
        let mut first = true;
        loop {
            let Ok((stream, _)) = listener.accept().await else { return };
            let req_tx = req_tx.clone();
            let snapshot = snapshot.clone();
            let mut bus_rx = bus.subscribe();
            let is_first = std::mem::replace(&mut first, false);
            tokio::spawn(async move {
                let (r, mut w) = stream.into_split();
                let mut lines = BufReader::new(r).lines();
                let mut subs: Vec<Value> = vec![];
                let mut main = false;
                loop {
                    tokio::select! {
                        line = lines.next_line() => {
                            let Ok(Some(line)) = line else { return };
                            let req: Value = serde_json::from_str(&line).unwrap();
                            let result = match req["method"].as_str().unwrap() {
                                "session.snapshot" => snapshot.clone(),
                                "events.subscribe" => {
                                    subs = req["params"]["subscriptions"].as_array().unwrap().clone();
                                    main = is_first;
                                    req_tx.send(req.clone()).unwrap();
                                    json!({"type": "subscription_started"})
                                }
                                _ => json!({}),
                            };
                            let ack = json!({"id": req["id"], "result": result});
                            if w.write_all(format!("{ack}\n").as_bytes()).await.is_err() { return; }
                        }
                        ev = bus_rx.recv() => {
                            match ev {
                                Ok(Some(v)) => {
                                    let name = event_name(&v);
                                    let pane = v["data"]["pane_id"].as_str();
                                    let hit = subs.iter().any(|s| {
                                        s["type"].as_str().unwrap_or("").replace('.', "_") == name
                                            && s["pane_id"].as_str().map_or(true, |p| Some(p) == pane)
                                    });
                                    if hit && w.write_all(format!("{v}\n").as_bytes()).await.is_err() { return; }
                                }
                                Ok(None) => { if main { return; } }
                                Err(_) => return,
                            }
                        }
                    }
                }
            });
        }
    });
    (push_tx, req_rx)
}

fn spawn_fake(path: &PathBuf) -> (mpsc::UnboundedSender<Push>, mpsc::UnboundedReceiver<Value>) {
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

fn status_ev(pane: &str, status: &str) -> Value {
    json!({"event": "pane.agent_status_changed",
           "data": {"type": "pane_agent_status_changed", "pane_id": pane, "workspace_id": "w1", "agent_status": status}})
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
