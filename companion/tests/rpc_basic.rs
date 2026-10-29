#[path = "support/fake_herdr.rs"]
mod fake_herdr;

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use zogsshd::rpc::{self, Ctx};

struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
}

impl Session {
    fn start(sock: PathBuf, home: PathBuf) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(65536);
        let (server_out, client_rx) = tokio::io::duplex(65536);
        let ctx = Ctx { herdr_socket: sock, home };
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

fn fake(dir: &tempfile::TempDir) -> PathBuf {
    let sock = dir.path().join("herdr.sock");
    let mut m = HashMap::new();
    m.insert(
        "session.snapshot".to_string(),
        json!({"type":"session_snapshot","snapshot":{"version":"9.9.9","protocol":22}}),
    );
    m.insert("agent.list".to_string(), json!({"type":"agent_list","agents":[]}));
    fake_herdr::spawn(&sock, m);
    sock
}

#[tokio::test]
async fn hello_reports_herdr_ok() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(fake(&dir), dir.path().into());
    s.send(r#"{"id":1,"method":"hello"}"#).await;
    let r = s.recv().await;
    assert_eq!(r["id"], 1);
    assert_eq!(r["result"]["herdr_ok"], true);
    assert_eq!(r["result"]["zogsshd"], env!("CARGO_PKG_VERSION"));
    assert_eq!(r["result"]["herdr_version"], "9.9.9");
    assert_eq!(r["result"]["herdr_protocol"], 22);
}

#[tokio::test]
async fn hello_without_herdr() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(dir.path().join("none.sock"), dir.path().into());
    s.send(r#"{"id":1,"method":"hello"}"#).await;
    let r = s.recv().await;
    assert_eq!(r["result"]["herdr_ok"], false);
    assert!(r["result"].get("herdr_version").is_none());
}

#[tokio::test]
async fn herdr_call_passthrough() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(fake(&dir), dir.path().into());
    s.send(r#"{"id":2,"method":"herdr.call","params":{"method":"agent.list","params":{}}}"#).await;
    let r = s.recv().await;
    assert_eq!(r["id"], 2);
    assert_eq!(r["result"], json!({"type":"agent_list","agents":[]}));
}

#[tokio::test]
async fn herdr_call_unavailable() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(dir.path().join("none.sock"), dir.path().into());
    s.send(r#"{"id":3,"method":"herdr.call","params":{"method":"agent.list"}}"#).await;
    let r = s.recv().await;
    assert_eq!(r["error"]["code"], "herdr_unavailable");
}

#[tokio::test]
async fn bad_json_line_does_not_kill_loop() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(dir.path().join("none.sock"), dir.path().into());
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
    let mut s = Session::start(dir.path().join("none.sock"), dir.path().into());
    s.send(r#"{"id":5,"method":"nope"}"#).await;
    assert_eq!(s.recv().await["error"]["code"], "unknown_method");
}
