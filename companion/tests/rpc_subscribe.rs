//! `herdr.subscribe`: the core events in herdr 1 shapes, the event filter, the end of the stream
//! and `rpc.cancel`.

#[path = "support/fake_core.rs"]
mod fake_core;

use std::time::Duration;

use fake_core::{status_event, terminal, Ctl, FakeCore, State};
use herdlingd::rpc::{self, Ctx};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
}

impl Session {
    fn start(ctx: Ctx) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(65536);
        let (server_out, client_rx) = tokio::io::duplex(65536);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
        Session { tx: client_tx, rx: BufReader::new(client_rx).lines() }
    }
    async fn send(&mut self, line: &str) {
        self.tx.write_all(format!("{line}\n").as_bytes()).await.unwrap();
    }
    async fn recv(&mut self) -> Value {
        let line = tokio::time::timeout(Duration::from_secs(5), self.rx.next_line())
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

fn core(dir: &tempfile::TempDir) -> (Ctx, FakeCore) {
    let state = State { terminals: vec![terminal("t1", None, Some("working")), terminal("t2", None, None)], ..State::default() };
    fake_core::with_ctx(dir.path(), dir.path().into(), state)
}

#[tokio::test]
async fn subscribe_forwards_core_events_in_herdr_one_shapes() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = core(&dir);
    let mut s = Session::start(ctx);
    let stream = s.subscribe(1, "{}").await;
    assert!(stream.starts_with("herdr:"));
    c.wait_subscribes(1).await;
    c.send(Ctl::Event(status_event("t1", "done")));
    let n = s.recv().await;
    assert_eq!(n["params"]["stream"], stream.as_str());
    assert_eq!(n["params"]["data"]["event"], "pane.agent_status_changed");
    assert_eq!(n["params"]["data"]["data"]["agent_status"], "done");
    c.send(Ctl::Event(fake_core::event("created", "t3", json!({}))));
    assert_eq!(s.recv().await["params"]["data"]["event"], "pane.created");
}

#[tokio::test]
async fn subscribe_filters_by_event_name() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = core(&dir);
    let mut s = Session::start(ctx);
    s.subscribe(1, r#"{"events":["pane.closed"]}"#).await;
    c.wait_subscribes(1).await;
    c.send(Ctl::Event(status_event("t1", "done")));
    c.send(Ctl::Event(fake_core::event("finished", "t2", json!({}))));
    let n = s.recv().await;
    assert_eq!(n["params"]["data"]["event"], "pane.closed", "the status line passed the filter: {n}");
}

#[tokio::test]
async fn subscribe_reports_close_when_the_core_drops() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = core(&dir);
    let mut s = Session::start(ctx);
    let stream = s.subscribe(1, "{}").await;
    c.wait_subscribes(1).await;
    c.send(Ctl::Drop);
    let n = s.recv().await;
    assert_eq!(n["params"]["stream"], stream.as_str());
    assert_eq!(n["params"]["data"], json!({"closed": true}));
}

#[tokio::test]
async fn cancel_stops_stream() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = core(&dir);
    let mut s = Session::start(ctx);
    let stream = s.subscribe(1, "{}").await;
    c.wait_subscribes(1).await;
    s.send(&format!(r#"{{"id":2,"method":"rpc.cancel","params":{{"stream":"{stream}"}}}}"#)).await;
    let r = s.recv().await;
    assert_eq!(r["id"], 2);
    assert_eq!(r["result"]["cancelled"], true);
    // Cancel is acknowledged first, then the core sends an event: nothing may arrive.
    c.send(Ctl::Event(status_event("t1", "done")));
    let got = tokio::time::timeout(Duration::from_millis(200), s.rx.next_line()).await;
    assert!(got.is_err(), "event forwarded after cancel: {got:?}");
}

#[tokio::test]
async fn subscribe_idle_longer_than_timeout_stays_open() {
    let dir = tempfile::tempdir().unwrap();
    let (mut ctx, c) = core(&dir);
    ctx.herdr_timeout = Duration::from_millis(100);
    let mut s = Session::start(ctx);
    let stream = s.subscribe(1, "{}").await;
    c.wait_subscribes(1).await;
    tokio::time::sleep(Duration::from_millis(400)).await;
    c.send(Ctl::Event(status_event("t1", "idle")));
    let n = s.recv().await;
    assert_eq!(n["params"]["stream"], stream.as_str());
    assert_eq!(n["params"]["data"]["event"], "pane.agent_status_changed");
}

#[tokio::test]
async fn subscribe_unavailable_returns_error() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(Ctx::new(dir.path().into()));
    s.send(r#"{"id":1,"method":"herdr.subscribe","params":{}}"#).await;
    assert_eq!(s.recv().await["error"]["code"], "herdr_unavailable");
    let mut ctx = Ctx::new(dir.path().into());
    ctx.core_socket = Some(herdlingd::core::endpoint::CoreSocket::fixed(dir.path().join("missing.sock")));
    let mut s = Session::start(ctx);
    s.send(r#"{"id":2,"method":"herdr.subscribe","params":{}}"#).await;
    assert_eq!(s.recv().await["error"]["code"], "herdr_unavailable");
}

#[tokio::test]
async fn missed_events_give_a_refetch_hint() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = core(&dir);
    let mut s = Session::start(ctx);
    s.subscribe(1, "{}").await;
    c.wait_subscribes(1).await;
    c.send(Ctl::Missed(json!({"seq": 5, "terminals": []})));
    assert_eq!(s.recv().await["params"]["data"]["event"], "layout.updated");
}
