#[path = "support/fake_herdr.rs"]
mod fake_herdr;

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use herdlingd::rpc::{self, Ctx};

struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
}

impl Session {
    fn start(sock: PathBuf, home: PathBuf) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(65536);
        let (server_out, client_rx) = tokio::io::duplex(65536);
        let ctx = Ctx::new(sock, home);
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
    assert_eq!(r["result"]["herdlingd"], env!("CARGO_PKG_VERSION"));
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

#[tokio::test]
async fn herdr_call_times_out_when_herdr_never_replies() {
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
    let mut ctx = Ctx::new(sock, dir.path().into());
    ctx.herdr_timeout = std::time::Duration::from_millis(100);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    let mut s = Session { tx: client_tx, rx: BufReader::new(client_rx).lines() };
    s.send(r#"{"id":6,"method":"herdr.call","params":{"method":"agent.list"}}"#).await;
    let r = s.recv().await;
    assert_eq!(r["id"], 6);
    assert_eq!(r["error"]["code"], "herdr_unavailable");
}

#[tokio::test]
async fn ping_returns_empty_object() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(dir.path().join("none.sock"), dir.path().into());
    s.send(r#"{"id":7,"method":"ping"}"#).await;
    let r = s.recv().await;
    assert_eq!(r["id"], 7);
    assert_eq!(r["result"], json!({}));
    assert!(r.get("error").is_none());
}

#[tokio::test]
async fn hello_lists_methods_and_methods_match_dispatch() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(dir.path().join("none.sock"), dir.path().into());
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
async fn herdr_call_marks_phone_input() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(fake(&dir), dir.path().into());
    s.send(r#"{"id":7,"method":"herdr.call","params":{"method":"agent.list","params":{"pane_id":"w1:p1"}}}"#).await;
    s.recv().await;
    assert_eq!(herdlingd::phone_input::last(dir.path(), "w1:p1"), None, "a read is not input");
    s.send(r#"{"id":8,"method":"herdr.call","params":{"method":"pane.send_text","params":{"pane_id":"w1:p1","text":"hi"}}}"#).await;
    s.recv().await;
    assert!(herdlingd::phone_input::last(dir.path(), "w1:p1").is_some());
}
