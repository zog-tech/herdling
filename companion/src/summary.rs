//! `summary.make`: a short spoken summary of an agent reply, made by the Anthropic Messages API.
//!
//! The key comes from the companion config. It is sent only in the `x-api-key` header and
//! never logged or put in an error message.

use std::time::Duration;

use serde_json::{json, Value};

use crate::types::RpcError;

pub const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
pub const MODEL: &str = "claude-haiku-5-5";
pub const ANTHROPIC_VERSION: &str = "2023-06-01";
pub const MAX_TOKENS: u32 = 200;
/// Longer input keeps its end: the end of a reply says what the agent needs.
pub const MAX_INPUT_CHARS: usize = 24_000;
pub const SYSTEM: &str = "You summarize a coding agent's reply for someone listening on headphones. \
Say in 2 or 3 short sentences what the agent did and what it needs from the user. No markdown, no code, no lists.";
/// Bound for one Messages API call. The app waits a little longer.
pub const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

fn upstream(message: impl Into<String>) -> RpcError {
    RpcError { code: "upstream_error".into(), message: message.into() }
}

/// The last `MAX_INPUT_CHARS` characters of `text`.
pub fn clip(text: &str) -> &str {
    let n = text.chars().count();
    if n <= MAX_INPUT_CHARS {
        return text;
    }
    let start = text.char_indices().nth(n - MAX_INPUT_CHARS).map_or(0, |(i, _)| i);
    &text[start..]
}

/// Asks the Messages API at `url` for a summary of `text`. HTTP failure or no text in the
/// answer gives `upstream_error`.
pub async fn make(client: &reqwest::Client, url: &str, key: &str, text: &str) -> Result<String, RpcError> {
    let body = json!({
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM,
        "messages": [{ "role": "user", "content": clip(text) }],
    });
    let resp = client
        .post(url)
        .timeout(HTTP_TIMEOUT)
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&body)
        .send()
        .await
        .map_err(|e| upstream(if e.is_timeout() { "request timed out" } else { "request failed" }))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(upstream(format!("HTTP {}", status.as_u16())));
    }
    let v: Value = resp.json().await.map_err(|_| upstream("unexpected response"))?;
    let summary: String = v
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect();
    let summary = summary.trim();
    if summary.is_empty() {
        return Err(upstream("empty summary"));
    }
    Ok(summary.to_string())
}
