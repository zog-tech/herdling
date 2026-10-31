use std::io::Write;
use std::path::Path;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use herdlingd::claude::Follower;
use herdlingd::rpc::{self, Ctx};
use herdlingd::types::ThreadItem;

fn append(path: &Path, text: &str) {
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
    f.write_all(text.as_bytes()).unwrap();
}

fn user_line(uuid: &str, text: &str) -> String {
    format!("{}\n", json!({"type":"user","uuid":uuid,"message":{"role":"user","content":text}}))
}

fn tool_use_line() -> String {
    format!(
        "{}\n",
        json!({"type":"assistant","uuid":"a1","message":{"role":"assistant","content":[
            {"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}})
    )
}

fn tool_result_line() -> String {
    format!(
        "{}\n",
        json!({"type":"user","uuid":"u9","message":{"role":"user","content":[
            {"type":"tool_result","tool_use_id":"toolu_1","content":"file.txt"}]}})
    )
}

#[test]
fn follow_emits_only_complete_lines() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("s.jsonl");
    append(&log, &user_line("u0", "old"));
    let from = std::fs::metadata(&log).unwrap().len();
    let mut f = Follower::new(&log, from);
    assert!(f.poll().unwrap().is_none());

    let line = user_line("u1", "hello");
    let (head, tail) = line.split_at(20);
    append(&log, head);
    assert!(f.poll().unwrap().is_none());
    append(&log, tail);
    let (items, offset) = f.poll().unwrap().unwrap();
    assert_eq!(items.len(), 1);
    assert!(matches!(&items[0], ThreadItem::User { text, id, .. } if text == "hello" && id == "u1:0"));
    assert_eq!(offset, std::fs::metadata(&log).unwrap().len());
    assert!(f.poll().unwrap().is_none());
}

#[test]
fn follow_updates_tool_with_result() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("s.jsonl");
    std::fs::write(&log, "").unwrap();
    let mut f = Follower::new(&log, 0);
    append(&log, &tool_use_line());
    let (items, _) = f.poll().unwrap().unwrap();
    assert!(matches!(&items[0], ThreadItem::Tool { id, result: None, .. } if id == "toolu_1"));

    append(&log, &tool_result_line());
    let (items, _) = f.poll().unwrap().unwrap();
    assert_eq!(items.len(), 1);
    match &items[0] {
        ThreadItem::Tool { id, result: Some(r), .. } => {
            assert_eq!(id, "toolu_1");
            assert_eq!(r.text, "file.txt");
        }
        other => panic!("unexpected {other:?}"),
    }
    // The update is emitted once.
    append(&log, &user_line("u2", "next"));
    let (items, _) = f.poll().unwrap().unwrap();
    assert_eq!(items.len(), 1);
}

#[test]
fn follow_call_and_result_in_one_read() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("s.jsonl");
    append(&log, &(tool_use_line() + &tool_result_line()));
    let mut f = Follower::new(&log, 0);
    let (items, _) = f.poll().unwrap().unwrap();
    assert_eq!(items.len(), 1);
    assert!(matches!(&items[0], ThreadItem::Tool { result: Some(_), .. }));
}

#[tokio::test]
async fn follow_stream_over_rpc() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("s.jsonl");
    append(&log, &user_line("u0", "old"));
    let from = std::fs::metadata(&log).unwrap().len();

    let (mut tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(65536);
    let ctx = Ctx::new(dir.path().join("none.sock"), dir.path().into());
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    let mut rx = BufReader::new(client_rx).lines();

    let req = json!({"id":1,"method":"thread.follow","params":{"log_path":log,"from":from}});
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    let resp: Value = serde_json::from_str(&rx.next_line().await.unwrap().unwrap()).unwrap();
    let stream = resp["result"]["stream"].as_str().unwrap().to_string();
    assert!(stream.starts_with("thread:"));

    append(&log, &user_line("u1", "fresh"));
    let line = tokio::time::timeout(std::time::Duration::from_secs(3), rx.next_line())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let ev: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(ev["params"]["stream"], stream.as_str());
    assert_eq!(ev["params"]["data"]["items"][0]["text"], "fresh");
    assert_eq!(ev["params"]["data"]["offset"], std::fs::metadata(&log).unwrap().len());
}

#[test]
fn follow_seeds_pending_from_before_offset() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("s.jsonl");
    append(&log, &tool_use_line());
    let from = std::fs::metadata(&log).unwrap().len();
    let mut f = Follower::new(&log, from);
    append(&log, &tool_result_line());
    let (items, _) = f.poll().unwrap().unwrap();
    assert_eq!(items.len(), 1);
    assert!(matches!(&items[0], ThreadItem::Tool { id, result: Some(r), .. } if id == "toolu_1" && r.text == "file.txt"));
}

#[tokio::test]
async fn follow_stream_ends_when_file_vanishes() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("s.jsonl");
    append(&log, &user_line("u0", "old"));
    let (mut tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(65536);
    let ctx = Ctx::new(dir.path().join("none.sock"), dir.path().into());
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    let mut rx = BufReader::new(client_rx).lines();
    let req = json!({"id":1,"method":"thread.follow","params":{"log_path":log,"from":0}});
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    let _ = rx.next_line().await.unwrap().unwrap();
    // Drain the first batch of items.
    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), rx.next_line()).await.unwrap();
    std::fs::remove_file(&log).unwrap();
    let line = tokio::time::timeout(std::time::Duration::from_secs(10), rx.next_line())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let ev: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(ev["params"]["data"]["error"], "not_found");
}
