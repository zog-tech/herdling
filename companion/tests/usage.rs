use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use herdlingd::rpc::{self, Ctx};
use herdlingd::usage::{parse_claude, parse_codex, UsageUrls};

const CLAUDE_TOKEN: &str = "claude-test-token";
const CODEX_TOKEN: &str = "codex-test-token";

fn claude_fixture() -> Value {
    json!({
        "five_hour": { "utilization": 42.0, "resets_at": "2026-01-01T00:00:00.123456+00:00" },
        "seven_day": { "utilization": 17.5, "resets_at": "2026-01-05T12:00:00Z" },
        "seven_day_opus": null,
        "seven_day_sonnet": { "utilization": 3.0, "resets_at": "2026-01-05T12:00:00Z" },
        "extra_usage": { "is_enabled": false }
    })
}

fn codex_fixture() -> Value {
    json!({
        "plan_type": "pro",
        "rate_limit": {
            "primary_window": { "used_percent": 11, "limit_window_seconds": 18000, "reset_at": 1767225600 },
            "secondary_window": { "used_percent": 63.5, "limit_window_seconds": 604800, "reset_at": 1767830400 }
        }
    })
}

#[test]
fn parse_claude_windows() {
    let w = parse_claude(&claude_fixture());
    let got = serde_json::to_value(&w).unwrap();
    assert_eq!(
        got,
        json!([
            { "label": "5h", "used_pct": 42.0, "resets_at": 1767225600 },
            { "label": "7d", "used_pct": 17.5, "resets_at": 1767614400 },
        ])
    );
}

#[test]
fn parse_claude_opus_and_missing_reset() {
    let w = parse_claude(&json!({ "seven_day_opus": { "utilization": 9.0, "resets_at": null } }));
    assert_eq!(w.len(), 1);
    assert_eq!(w[0].label, "7d Opus");
    assert_eq!(w[0].resets_at, None);
    assert!(parse_claude(&json!({})).is_empty());
}

#[test]
fn parse_codex_windows() {
    let got = serde_json::to_value(parse_codex(&codex_fixture())).unwrap();
    assert_eq!(
        got,
        json!([
            { "label": "5h", "used_pct": 11.0, "resets_at": 1767225600 },
            { "label": "7d", "used_pct": 63.5, "resets_at": 1767830400 },
        ])
    );
    let odd = parse_codex(&json!({ "rate_limit": { "primary_window": { "used_percent": 1, "limit_window_seconds": 7200 } } }));
    assert_eq!(odd[0].label, "2h");
    assert!(parse_codex(&json!({ "rate_limit": null })).is_empty());
}

/// Records the headers of each request and answers with a fixed status and body per path.
#[derive(Clone)]
struct Mock {
    seen: Arc<Mutex<Vec<(String, HeaderMap)>>>,
    status: StatusCode,
}

async fn serve(status: StatusCode) -> (String, Mock) {
    let mock = Mock { seen: Arc::default(), status };
    async fn claude(State(m): State<Mock>, h: HeaderMap) -> (StatusCode, Json<Value>) {
        m.seen.lock().unwrap().push(("claude".into(), h));
        (m.status, Json(claude_fixture()))
    }
    async fn codex(State(m): State<Mock>, h: HeaderMap) -> (StatusCode, Json<Value>) {
        m.seen.lock().unwrap().push(("codex".into(), h));
        (m.status, Json(codex_fixture()))
    }
    let app = Router::new().route("/claude", get(claude)).route("/codex", get(codex)).with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (base, mock)
}

fn write(home: &std::path::Path, rel: &str, body: Value) {
    let p = home.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body.to_string()).unwrap();
}

fn write_credentials(home: &std::path::Path) {
    write(home, ".claude/.credentials.json", json!({ "claudeAiOauth": { "accessToken": CLAUDE_TOKEN } }));
    write(home, ".codex/auth.json", json!({ "tokens": { "access_token": CODEX_TOKEN, "account_id": "acct-1" } }));
}

async fn usage_rpc(home: &std::path::Path, base: &str) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(65536);
    let mut ctx = Ctx::new(home.join("none.sock"), home.into());
    ctx.usage_urls = UsageUrls { claude: format!("{base}/claude"), codex: format!("{base}/codex") };
    ctx.usage_keychain = false;
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    tx.write_all(b"{\"id\":1,\"method\":\"usage.get\",\"params\":{}}\n").await.unwrap();
    let line = BufReader::new(client_rx).lines().next_line().await.unwrap().unwrap();
    serde_json::from_str::<Value>(&line).unwrap()["result"].clone()
}

#[tokio::test]
async fn usage_with_mock_endpoints() {
    let dir = tempfile::tempdir().unwrap();
    write_credentials(dir.path());
    let (base, mock) = serve(StatusCode::OK).await;
    let r = usage_rpc(dir.path(), &base).await;
    let p = r["providers"].as_array().unwrap();
    assert_eq!(p.len(), 2);
    assert_eq!((p[0]["provider"].as_str(), p[0]["status"].as_str()), (Some("claude"), Some("ok")));
    assert_eq!((p[1]["provider"].as_str(), p[1]["status"].as_str()), (Some("codex"), Some("ok")));
    assert_eq!(p[0]["windows"][0], json!({ "label": "5h", "used_pct": 42.0, "resets_at": 1767225600 }));
    assert_eq!(p[1]["windows"][1]["label"], "7d");
    assert!(p[0].get("error").is_none());

    let seen = mock.seen.lock().unwrap();
    let h = |who: &str| seen.iter().find(|(w, _)| w == who).unwrap().1.clone();
    let c = h("claude");
    assert_eq!(c["authorization"], format!("Bearer {CLAUDE_TOKEN}"));
    assert_eq!(c["anthropic-beta"], "oauth-2025-04-20");
    let x = h("codex");
    assert_eq!(x["authorization"], format!("Bearer {CODEX_TOKEN}"));
    assert_eq!(x["chatgpt-account-id"], "acct-1");
}

#[tokio::test]
async fn missing_credentials_not_logged_in() {
    let dir = tempfile::tempdir().unwrap();
    let (base, mock) = serve(StatusCode::OK).await;
    let r = usage_rpc(dir.path(), &base).await;
    for (i, name) in ["claude", "codex"].iter().enumerate() {
        let p = &r["providers"][i];
        assert_eq!(p["provider"], *name);
        assert_eq!(p["status"], "not_logged_in");
        assert_eq!(p["windows"], json!([]));
    }
    assert!(mock.seen.lock().unwrap().is_empty(), "no request without a token");
}

#[tokio::test]
async fn expired_token_unavailable() {
    let dir = tempfile::tempdir().unwrap();
    write_credentials(dir.path());
    let (base, _mock) = serve(StatusCode::UNAUTHORIZED).await;
    let r = usage_rpc(dir.path(), &base).await;
    for i in 0..2 {
        assert_eq!(r["providers"][i]["status"], "unavailable");
        assert_eq!(r["providers"][i]["error"], "token expired \u{2014} open the CLI on the host");
    }
}

#[tokio::test]
async fn server_error_unavailable_and_unreachable() {
    let dir = tempfile::tempdir().unwrap();
    write_credentials(dir.path());
    let (base, _mock) = serve(StatusCode::INTERNAL_SERVER_ERROR).await;
    let r = usage_rpc(dir.path(), &base).await;
    assert_eq!(r["providers"][0]["status"], "unavailable");
    assert_eq!(r["providers"][0]["error"], "HTTP 500");
    // Nothing listens on port 1.
    let r = usage_rpc(dir.path(), "http://127.0.0.1:1").await;
    assert_eq!(r["providers"][1]["status"], "unavailable");
}
