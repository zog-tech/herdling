use std::path::PathBuf;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::mpsc;
use zogsshd::rpc::{self, Ctx};

/// Commands the test sends to the fake herdr's subscription connection.
enum Push {
    Event(Value),
    Drop,
}

/// Fake herdr that answers `events.subscribe` with `subscription_started`,
/// records the request params, then pushes whatever the test sends.
fn spawn_fake(
    path: &PathBuf,
) -> (mpsc::UnboundedSender<Push>, mpsc::UnboundedReceiver<Value>) {
    let listener = UnixListener::bind(path).unwrap();
    let (push_tx, mut push_rx) = mpsc::unbounded_channel::<Push>();
    let (req_tx, req_rx) = mpsc::unbounded_channel::<Value>();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (r, mut w) = stream.into_split();
        let mut lines = BufReader::new(r).lines();
        let req: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        let ack = json!({"id": req["id"], "result": {"type": "subscription_started"}});
        w.write_all(format!("{ack}\n").as_bytes()).await.unwrap();
        req_tx.send(req).unwrap();
        while let Some(p) = push_rx.recv().await {
            match p {
                Push::Event(v) => {
                    let _ = w.write_all(format!("{v}\n").as_bytes()).await;
                }
                Push::Drop => return,
            }
        }
    });
    (push_tx, req_rx)
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
