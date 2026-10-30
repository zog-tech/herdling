//! `summary.make` against a local mock of the Messages API. No test touches the real network.

use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use zogsshd::rpc::{self, Ctx};

/// Records each request and answers with a fixed status and body.
#[derive(Clone)]
struct Mock {
    seen: Arc<Mutex<Vec<(HeaderMap, Value)>>>,
    status: StatusCode,
    reply: Value,
}

async fn serve(status: StatusCode, reply: Value) -> (String, Mock) {
    let mock = Mock { seen: Arc::default(), status, reply };
    async fn messages(State(m): State<Mock>, h: HeaderMap, Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
        m.seen.lock().unwrap().push((h, body));
        (m.status, Json(m.reply.clone()))
    }
    let app = Router::new().route("/v1/messages", post(messages)).with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1/messages", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (url, mock)
}

fn ok_reply() -> Value {
    json!({ "content": [{ "type": "text", "text": "Did X. Needs Y." }] })
}

/// Runs one `summary.make` request and returns the whole response line.
async fn summary_rpc(home: &std::path::Path, url: &str, key: Option<&str>, text: &str) -> Value {
    if let Some(k) = key {
        let path = zogsshd::config::default_path(home);
        zogsshd::config::update(&path, |c| c.anthropic_key = Some(k.into())).unwrap();
    }
    let (mut tx, server_in) = tokio::io::duplex(1 << 20);
    let (server_out, client_rx) = tokio::io::duplex(1 << 20);
    let mut ctx = Ctx::new(home.join("none.sock"), home.into());
    ctx.anthropic_url = url.into();
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    let req = json!({ "id": 1, "method": "summary.make", "params": { "text": text } });
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    let line = BufReader::new(client_rx).lines().next_line().await.unwrap().unwrap();
    serde_json::from_str(&line).unwrap()
}

#[test]
fn default_url_is_the_messages_api() {
    let ctx = Ctx::new("/x.sock".into(), "/home/sam".into());
    assert_eq!(ctx.anthropic_url, "https://api.anthropic.com/v1/messages");
}

#[tokio::test]
async fn summary_calls_anthropic() {
    let dir = tempfile::tempdir().unwrap();
    let (url, mock) = serve(StatusCode::OK, ok_reply()).await;
    let r = summary_rpc(dir.path(), &url, Some("test-key"), "The agent edited main.rs.").await;
    assert_eq!(r["result"], json!({ "summary": "Did X. Needs Y." }));

    let seen = mock.seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    let (h, body) = &seen[0];
    assert_eq!(h["x-api-key"], "test-key");
    assert_eq!(h["anthropic-version"], "2023-06-01");
    assert_eq!(body["model"], "claude-haiku-5-5");
    assert_eq!(body["max_tokens"], 200);
    assert_eq!(body["system"], zogsshd::summary::SYSTEM);
    assert_eq!(body["messages"], json!([{ "role": "user", "content": "The agent edited main.rs." }]));
}

#[tokio::test]
async fn summary_joins_text_blocks_only() {
    let dir = tempfile::tempdir().unwrap();
    let reply = json!({ "content": [
        { "type": "thinking", "thinking": "" },
        { "type": "text", "text": "Did X." },
        { "type": "text", "text": " Needs Y." },
    ] });
    let (url, _mock) = serve(StatusCode::OK, reply).await;
    let r = summary_rpc(dir.path(), &url, Some("test-key"), "hi").await;
    assert_eq!(r["result"]["summary"], "Did X. Needs Y.");
}

#[tokio::test]
async fn summary_without_key() {
    let dir = tempfile::tempdir().unwrap();
    let (url, mock) = serve(StatusCode::OK, ok_reply()).await;
    let r = summary_rpc(dir.path(), &url, None, "hi").await;
    assert_eq!(r["error"]["code"], "no_key");
    // An empty key counts as no key.
    let r = summary_rpc(dir.path(), &url, Some(""), "hi").await;
    assert_eq!(r["error"]["code"], "no_key");
    assert!(mock.seen.lock().unwrap().is_empty(), "no request without a key");
}

#[tokio::test]
async fn summary_upstream_error() {
    let dir = tempfile::tempdir().unwrap();
    let (url, _mock) = serve(StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": "boom" })).await;
    let r = summary_rpc(dir.path(), &url, Some("test-key"), "hi").await;
    assert_eq!(r["error"]["code"], "upstream_error");
    assert!(!r["error"]["message"].as_str().unwrap().contains("test-key"));

    // A 200 with no text is an upstream error too.
    let (url, _mock) = serve(StatusCode::OK, json!({ "content": [] })).await;
    let r = summary_rpc(dir.path(), &url, Some("test-key"), "hi").await;
    assert_eq!(r["error"]["code"], "upstream_error");

    // Nothing listens on port 1.
    let r = summary_rpc(dir.path(), "http://127.0.0.1:1/v1/messages", Some("test-key"), "hi").await;
    assert_eq!(r["error"]["code"], "upstream_error");
}

#[tokio::test]
async fn summary_requires_text() {
    let dir = tempfile::tempdir().unwrap();
    let (url, mock) = serve(StatusCode::OK, ok_reply()).await;
    let path = zogsshd::config::default_path(dir.path());
    zogsshd::config::update(&path, |c| c.anthropic_key = Some("test-key".into())).unwrap();
    let (mut tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(65536);
    let mut ctx = Ctx::new(dir.path().join("none.sock"), dir.path().into());
    ctx.anthropic_url = url;
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    tx.write_all(b"{\"id\":1,\"method\":\"summary.make\",\"params\":{}}\n").await.unwrap();
    let line = BufReader::new(client_rx).lines().next_line().await.unwrap().unwrap();
    let r: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(r["error"]["code"], "bad_request");
    assert!(mock.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn long_input_keeps_end() {
    let dir = tempfile::tempdir().unwrap();
    let (url, mock) = serve(StatusCode::OK, ok_reply()).await;
    let text = format!("{}END", "a".repeat(29_997));
    assert_eq!(text.len(), 30_000);
    let r = summary_rpc(dir.path(), &url, Some("test-key"), &text).await;
    assert_eq!(r["result"]["summary"], "Did X. Needs Y.");
    let seen = mock.seen.lock().unwrap();
    let sent = seen[0].1["messages"][0]["content"].as_str().unwrap();
    assert_eq!(sent.chars().count(), 24_000);
    assert!(sent.ends_with("END"));
}

#[test]
fn clip_counts_characters() {
    let text = "é".repeat(24_001);
    let clipped = zogsshd::summary::clip(&text);
    assert_eq!(clipped.chars().count(), 24_000);
    assert_eq!(zogsshd::summary::clip("short"), "short");
}
