#[path = "support/fake_core.rs"]
mod fake_core;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use herdlingd::rpc::{self, Ctx};

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
        serde_json::from_str(&self.rx.next_line().await.unwrap().unwrap()).unwrap()
    }
}

/// A fake core with one agent terminal `t1`.
fn fake(dir: &tempfile::TempDir) -> (Ctx, fake_core::FakeCore) {
    let state = fake_core::State { terminals: vec![fake_core::terminal("t1", None, Some("idle"))], screen: "$ ".into(), ..Default::default() };
    fake_core::with_ctx(dir.path(), dir.path().into(), state)
}

fn bare(dir: &tempfile::TempDir) -> Ctx {
    Ctx::new(dir.path().into())
}

#[tokio::test]
async fn hello_reports_the_core_as_herdr() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, _c) = fake(&dir);
    let mut s = Session::start(ctx);
    s.send(r#"{"id":1,"method":"hello"}"#).await;
    let r = s.recv().await;
    assert_eq!(r["id"], 1);
    assert_eq!(r["result"]["herdr_ok"], true);
    assert_eq!(r["result"]["herdlingd"], env!("CARGO_PKG_VERSION"));
    // Old apps show this as the herdr version.
    assert_eq!(r["result"]["herdr_version"], "0.1.19");
    assert!(r["result"].get("herdr_protocol").is_none());
    let backends: Vec<&String> = r["result"]["backends"].as_object().unwrap().keys().collect();
    assert_eq!(backends, ["core"]);
    assert_eq!(r["result"]["backends"]["core"], json!({"version": "0.1.19", "generation": 1}));
}

#[tokio::test]
async fn hello_without_core() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(bare(&dir));
    s.send(r#"{"id":1,"method":"hello"}"#).await;
    let r = s.recv().await;
    assert_eq!(r["result"]["herdr_ok"], false);
    assert!(r["result"].get("herdr_version").is_none());
    assert!(r["result"].get("backends").is_none());
}

#[tokio::test]
async fn herdr_call_goes_to_the_core() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = fake(&dir);
    let mut s = Session::start(ctx);
    s.send(r#"{"id":2,"method":"herdr.call","params":{"method":"pane.read","params":{"pane_id":"hc:t1","source":"visible"}}}"#).await;
    let r = s.recv().await;
    assert_eq!(r["id"], 2);
    assert_eq!(r["result"]["read"]["text"], "$ ");
    assert_eq!(c.calls_of("terminal.read").len(), 1);
}

#[tokio::test]
async fn no_core_gives_herdr_unavailable() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(bare(&dir));
    s.send(r#"{"id":3,"method":"herdr.call","params":{"method":"pane.read","params":{"pane_id":"hc:t1"}}}"#).await;
    assert_eq!(s.recv().await["error"]["code"], "herdr_unavailable");
    s.send(r#"{"id":4,"method":"herdr.call","params":{"method":"session.snapshot","params":{}}}"#).await;
    assert_eq!(s.recv().await["error"]["code"], "herdr_unavailable");
    // A socket path with no core behind it.
    let mut ctx = bare(&dir);
    ctx.core_socket = Some(herdlingd::core::endpoint::CoreSocket::fixed(dir.path().join("missing.sock")));
    let mut s = Session::start(ctx);
    s.send(r#"{"id":5,"method":"herdr.call","params":{"method":"session.snapshot","params":{}}}"#).await;
    assert_eq!(s.recv().await["error"]["code"], "herdr_unavailable");
    s.send(r#"{"id":6,"method":"herdr.call","params":{"method":"pane.read","params":{"pane_id":"hc:t1"}}}"#).await;
    assert_eq!(s.recv().await["error"]["code"], "herdr_unavailable");
}

#[tokio::test]
async fn bad_json_line_does_not_kill_loop() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(bare(&dir));
    s.send("not json").await;
    let bad = s.recv().await;
    assert!(bad["id"].is_null());
    assert_eq!(bad["error"]["code"], "bad_request");
    s.send(r#"{"id":4,"method":"hello"}"#).await;
    assert_eq!(s.recv().await["id"], 4);
}

#[tokio::test]
async fn unknown_method() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(bare(&dir));
    s.send(r#"{"id":5,"method":"nope"}"#).await;
    assert_eq!(s.recv().await["error"]["code"], "unknown_method");
}

#[tokio::test]
async fn herdr_call_times_out_when_the_core_never_replies() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("silent.sock");
    let listener = tokio::net::UnixListener::bind(&sock).unwrap();
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((stream, _)) = listener.accept().await {
            held.push(stream); // accept, never reply
        }
    });
    let (client_tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(65536);
    let mut ctx = Ctx::new(dir.path().into());
    ctx.core_socket = Some(herdlingd::core::endpoint::CoreSocket::fixed(sock));
    ctx.herdr_timeout = std::time::Duration::from_millis(100);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    let mut s = Session { tx: client_tx, rx: BufReader::new(client_rx).lines() };
    s.send(r#"{"id":6,"method":"herdr.call","params":{"method":"pane.read","params":{"pane_id":"hc:t1"}}}"#).await;
    let r = s.recv().await;
    assert_eq!(r["id"], 6);
    assert_eq!(r["error"]["code"], "herdr_unavailable");
}

#[tokio::test]
async fn ping_returns_empty_object() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(bare(&dir));
    s.send(r#"{"id":7,"method":"ping"}"#).await;
    let r = s.recv().await;
    assert_eq!(r["id"], 7);
    assert_eq!(r["result"], json!({}));
    assert!(r.get("error").is_none());
}

#[tokio::test]
async fn hello_lists_methods_and_methods_match_dispatch() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(bare(&dir));
    s.send(r#"{"id":1,"method":"hello"}"#).await;
    let r = s.recv().await;
    let listed: Vec<&str> = r["result"]["methods"].as_array().unwrap().iter().map(|m| m.as_str().unwrap()).collect();
    assert_eq!(listed, rpc::METHODS);

    // Bad params may give `bad_request`; only `unknown_method` is a failure here.
    for (i, m) in rpc::METHODS.iter().enumerate() {
        let id = 100 + i;
        s.send(&format!(r#"{{"id":{id},"method":"{m}","params":{{}}}}"#)).await;
        let r = loop {
            let r = s.recv().await;
            if r["id"] == id {
                break r;
            }
        };
        assert_ne!(r["error"]["code"], "unknown_method", "{m} is listed but dispatch does not accept it");
    }

    s.send(r#"{"id":999,"method":"not.a.method","params":{}}"#).await;
    let r = loop {
        let r = s.recv().await;
        if r["id"] == 999 {
            break r;
        }
    };
    assert_eq!(r["error"]["code"], "unknown_method");
}

#[tokio::test]
async fn shell_watch_adds_lists_and_removes_a_watch() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(bare(&dir));
    s.send(r#"{"id":1,"method":"shell.watch","params":{"pane_id":"w1:p2","device_id":"d_1"}}"#).await;
    let r = s.recv().await;
    assert_eq!(r["result"]["pane_id"], "w1:p2");
    assert_eq!(r["result"]["busy"], false);
    let since = r["result"]["since"].as_u64().unwrap();
    assert_eq!(r["result"]["expires_at"].as_u64().unwrap(), since + 24 * 3600);
    assert!(herdlingd::shell_watch::path(dir.path()).exists());

    s.send(r#"{"id":2,"method":"shell.watches"}"#).await;
    let r = s.recv().await;
    assert_eq!(r["result"]["watches"].as_array().unwrap().len(), 1);

    s.send(r#"{"id":3,"method":"shell.unwatch","params":{"pane_id":"w1:p2"}}"#).await;
    assert_eq!(s.recv().await["result"], json!({"removed": true}));
    s.send(r#"{"id":4,"method":"shell.unwatch","params":{"pane_id":"w1:p2"}}"#).await;
    assert_eq!(s.recv().await["result"], json!({"removed": false}));

    s.send(r#"{"id":5,"method":"shell.watch","params":{"pane_id":""}}"#).await;
    assert_eq!(s.recv().await["error"]["code"], "bad_request");
    s.send(r#"{"id":6,"method":"shell.watch","params":{"pane_id":"p","device_id":7}}"#).await;
    assert_eq!(s.recv().await["error"]["code"], "bad_request");
}
