//! Process lifetime: idle watchdog, stalled stdout, oversized request lines.

use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use herdlingd::rpc::{self, Ctx, MAX_LINE};

fn ctx(dir: &tempfile::TempDir) -> Ctx {
    Ctx::new(dir.path().join("none.sock"), dir.path().into())
}

#[tokio::test]
async fn exits_when_no_request_arrives() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = ctx(&dir);
    c.idle_timeout = Duration::from_millis(200);
    let (_client_tx, server_in) = tokio::io::duplex(1024);
    let (server_out, _client_rx) = tokio::io::duplex(1024);
    let run = tokio::spawn(rpc::run(BufReader::new(server_in), server_out, c));
    let r = tokio::time::timeout(Duration::from_secs(2), run).await.expect("run did not exit when idle");
    assert!(r.unwrap().is_ok());
}

#[tokio::test]
async fn pings_keep_it_alive() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = ctx(&dir);
    c.idle_timeout = Duration::from_millis(300);
    let (mut client_tx, server_in) = tokio::io::duplex(1024);
    let (server_out, client_rx) = tokio::io::duplex(1024);
    let run = tokio::spawn(rpc::run(BufReader::new(server_in), server_out, c));
    let mut rx = BufReader::new(client_rx).lines();
    for i in 0..10 {
        client_tx.write_all(format!("{{\"id\":{i},\"method\":\"ping\",\"params\":{{}}}}\n").as_bytes()).await.unwrap();
        let line = rx.next_line().await.unwrap().unwrap();
        let v: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["id"], i);
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(!run.is_finished(), "exited while pings arrived");
}

#[tokio::test]
async fn exits_when_stdout_stalls() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = ctx(&dir);
    c.write_timeout = Duration::from_millis(200);
    let (mut client_tx, server_in) = tokio::io::duplex(1 << 16);
    // Tiny output pipe that nobody reads: writes block once it is full.
    let (server_out, _client_rx) = tokio::io::duplex(64);
    let run = tokio::spawn(rpc::run(BufReader::new(server_in), server_out, c));
    for i in 0..20 {
        client_tx.write_all(format!("{{\"id\":{i},\"method\":\"ping\",\"params\":{{}}}}\n").as_bytes()).await.unwrap();
    }
    let r = tokio::time::timeout(Duration::from_secs(3), run).await.expect("run did not exit on stalled stdout");
    assert!(r.unwrap().is_ok());
}

#[tokio::test]
async fn oversized_line_is_rejected_and_loop_continues() {
    let dir = tempfile::tempdir().unwrap();
    let (mut client_tx, server_in) = tokio::io::duplex(1 << 16);
    let (server_out, client_rx) = tokio::io::duplex(1 << 16);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx(&dir)));
    let mut rx = BufReader::new(client_rx).lines();
    let big = format!("{{\"id\":1,\"method\":\"ping\",\"params\":{{\"pad\":\"{}\"}}}}\n", "x".repeat(MAX_LINE + 10));
    client_tx.write_all(big.as_bytes()).await.unwrap();
    let v: Value = serde_json::from_str(&rx.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(v["error"]["code"], "bad_request");
    assert!(v["id"].is_null());
    client_tx.write_all(b"{\"id\":2,\"method\":\"ping\",\"params\":{}}\n").await.unwrap();
    let v: Value = serde_json::from_str(&rx.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(v["id"], 2);
    assert_eq!(v["result"], serde_json::json!({}));
}

#[tokio::test]
async fn line_at_the_limit_is_accepted() {
    let dir = tempfile::tempdir().unwrap();
    let (mut client_tx, server_in) = tokio::io::duplex(1 << 16);
    let (server_out, client_rx) = tokio::io::duplex(1 << 16);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx(&dir)));
    let mut rx = BufReader::new(client_rx).lines();
    let head = "{\"id\":3,\"method\":\"ping\",\"params\":{\"pad\":\"";
    let tail = "\"}}";
    let pad = "x".repeat(MAX_LINE - head.len() - tail.len());
    client_tx.write_all(format!("{head}{pad}{tail}\n").as_bytes()).await.unwrap();
    let v: Value = serde_json::from_str(&rx.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(v["id"], 3);
}
