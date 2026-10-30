//! `usage.get`: plan usage of the Claude and Codex CLIs on this host.
//!
//! Reads the CLI's own OAuth token and asks the provider's usage endpoint. Never
//! refreshes or writes a token, never logs one.

use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use crate::types::{ProviderUsage, Usage, UsageStatus, UsageWindow};

pub const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
pub const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
const KEYCHAIN_TIMEOUT: Duration = Duration::from_secs(5);
const EXPIRED: &str = "token expired \u{2014} open the CLI on the host";

/// Where each provider is asked. Tests point these at a local server.
#[derive(Debug, Clone)]
pub struct UsageUrls {
    pub claude: String,
    pub codex: String,
}

impl Default for UsageUrls {
    fn default() -> Self {
        UsageUrls { claude: CLAUDE_USAGE_URL.into(), codex: CODEX_USAGE_URL.into() }
    }
}

/// Fetches both providers. `use_keychain` allows the macOS keychain lookup for the Claude token.
pub async fn get(home: &Path, urls: &UsageUrls, use_keychain: bool) -> Usage {
    let client = reqwest::Client::builder().timeout(HTTP_TIMEOUT).build().unwrap_or_default();
    let (claude, codex) = tokio::join!(claude(&client, home, &urls.claude, use_keychain), codex(&client, home, &urls.codex));
    Usage { providers: vec![claude, codex] }
}

fn result(provider: &str, status: UsageStatus, error: Option<String>, windows: Vec<UsageWindow>) -> ProviderUsage {
    ProviderUsage { provider: provider.into(), status, error, windows }
}

fn not_logged_in(provider: &str, error: Option<String>) -> ProviderUsage {
    result(provider, UsageStatus::NotLoggedIn, error, vec![])
}

fn unavailable(provider: &str, error: impl Into<String>) -> ProviderUsage {
    result(provider, UsageStatus::Unavailable, Some(error.into()), vec![])
}

/// GETs `url` with the given headers and parses the JSON body, mapping failures to a provider result.
async fn fetch(
    client: &reqwest::Client,
    provider: &str,
    url: &str,
    headers: &[(&str, &str)],
    parse: fn(&Value) -> Vec<UsageWindow>,
) -> ProviderUsage {
    let mut req = client.get(url).timeout(HTTP_TIMEOUT);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(_) => return unavailable(provider, "request failed"),
    };
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return unavailable(provider, EXPIRED);
    }
    if !status.is_success() {
        return unavailable(provider, format!("HTTP {}", status.as_u16()));
    }
    match resp.json::<Value>().await {
        Ok(v) => result(provider, UsageStatus::Ok, None, parse(&v)),
        Err(_) => unavailable(provider, "unexpected response"),
    }
}

async fn claude(client: &reqwest::Client, home: &Path, url: &str, use_keychain: bool) -> ProviderUsage {
    let token = match claude_token(home, use_keychain).await {
        Ok(Some(t)) => t,
        Ok(None) => return not_logged_in("claude", None),
        Err(e) => return not_logged_in("claude", Some(e)),
    };
    let bearer = format!("Bearer {token}");
    fetch(client, "claude", url, &[("Authorization", &bearer), ("anthropic-beta", "oauth-2025-04-20")], parse_claude).await
}

async fn codex(client: &reqwest::Client, home: &Path, url: &str) -> ProviderUsage {
    let Some((token, account)) = codex_credentials(home) else {
        return not_logged_in("codex", None);
    };
    let bearer = format!("Bearer {token}");
    fetch(client, "codex", url, &[("Authorization", &bearer), ("ChatGPT-Account-Id", &account)], parse_codex).await
}

/// Token from the macOS keychain (when allowed), else `~/.claude/.credentials.json`.
/// `Err` carries a reason when the keychain failed and no file token exists.
async fn claude_token(home: &Path, use_keychain: bool) -> Result<Option<String>, String> {
    let mut keychain_error = None;
    if use_keychain && cfg!(target_os = "macos") {
        match keychain_blob().await {
            Ok(Some(blob)) => {
                if let Some(t) = claude_token_from(&blob) {
                    return Ok(Some(t));
                }
            }
            Ok(None) => {}
            Err(e) => keychain_error = Some(e),
        }
    }
    let file = std::fs::read_to_string(home.join(".claude/.credentials.json")).ok();
    match file.as_deref().and_then(claude_token_from) {
        Some(t) => Ok(Some(t)),
        None => keychain_error.map_or(Ok(None), Err),
    }
}

/// `claudeAiOauth.accessToken` of a credentials JSON text.
fn claude_token_from(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(text).ok()?;
    let t = v.get("claudeAiOauth")?.get("accessToken")?.as_str()?;
    (!t.is_empty()).then(|| t.to_string())
}

/// Reads the keychain item. `Ok(None)` when the item does not exist. Bounded by `KEYCHAIN_TIMEOUT`.
async fn keychain_blob() -> Result<Option<String>, String> {
    let child = tokio::process::Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(KEYCHAIN_TIMEOUT, child).await {
        Err(_) => Err("keychain locked".into()),
        Ok(Err(_)) => Err("keychain unavailable".into()),
        Ok(Ok(o)) if o.status.success() => Ok(Some(String::from_utf8_lossy(&o.stdout).trim().to_string())),
        // 44: the item was not found.
        Ok(Ok(o)) if o.status.code() == Some(44) => Ok(None),
        Ok(Ok(_)) => Err("keychain locked".into()),
    }
}

fn codex_credentials(home: &Path) -> Option<(String, String)> {
    let text = std::fs::read_to_string(home.join(".codex/auth.json")).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    let t = v.get("tokens")?;
    let token = t.get("access_token")?.as_str().filter(|s| !s.is_empty())?;
    let account = t.get("account_id")?.as_str().filter(|s| !s.is_empty())?;
    Some((token.into(), account.into()))
}

/// Windows of the Claude usage response: `five_hour`, `seven_day`, `seven_day_opus`. Null or malformed ones are skipped.
pub fn parse_claude(v: &Value) -> Vec<UsageWindow> {
    [("five_hour", "5h"), ("seven_day", "7d"), ("seven_day_opus", "7d Opus")]
        .iter()
        .filter_map(|(key, label)| {
            let w = v.get(key)?;
            Some(UsageWindow {
                label: (*label).into(),
                used_pct: w.get("utilization")?.as_f64()?,
                resets_at: w.get("resets_at").and_then(Value::as_str).and_then(parse_iso),
            })
        })
        .collect()
}

/// Windows of the Codex usage response: `rate_limit.primary_window` and `secondary_window`.
pub fn parse_codex(v: &Value) -> Vec<UsageWindow> {
    ["primary_window", "secondary_window"]
        .iter()
        .filter_map(|key| {
            let w = v.get("rate_limit")?.get(key)?;
            let secs = w.get("limit_window_seconds").and_then(Value::as_u64);
            Some(UsageWindow {
                label: match secs {
                    Some(18000) => "5h".into(),
                    Some(604800) => "7d".into(),
                    Some(s) => format!("{}h", s.div_ceil(3600)),
                    None => key.trim_end_matches("_window").into(),
                },
                used_pct: w.get("used_percent")?.as_f64()?,
                resets_at: w.get("reset_at").and_then(Value::as_i64),
            })
        })
        .collect()
}

/// RFC 3339 to unix seconds: `2026-01-01T00:00:00Z`, with optional fraction and `+HH:MM` offset.
pub fn parse_iso(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    let num = |from: usize, len: usize| -> Option<i64> {
        let part = s.get(from..from + len)?;
        part.bytes().all(|c| c.is_ascii_digit()).then(|| part.parse().ok())?
    };
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || !(b[10] == b'T' || b[10] == b't' || b[10] == b' ') || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (y, mo, d, h, mi, sec) = (num(0, 4)?, num(5, 2)?, num(8, 2)?, num(11, 2)?, num(14, 2)?, num(17, 2)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    let mut i = 19;
    if b[i] == b'.' {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == start {
            return None;
        }
    }
    let offset = match b.get(i)? {
        b'Z' | b'z' if i + 1 == b.len() => 0,
        sign @ (b'+' | b'-') if b.len() == i + 6 && b[i + 3] == b':' => {
            let secs = num(i + 1, 2)? * 3600 + num(i + 4, 2)? * 60;
            if *sign == b'+' {
                secs
            } else {
                -secs
            }
        }
        _ => return None,
    };
    // Days from civil date (Howard Hinnant's algorithm).
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days * 86400 + h * 3600 + mi * 60 + sec - offset)
}

#[cfg(test)]
mod tests {
    use super::parse_iso;

    #[test]
    fn iso_parses() {
        assert_eq!(parse_iso("2026-01-01T00:00:00Z"), Some(1767225600));
        assert_eq!(parse_iso("2026-01-01T00:00:00.939097+00:00"), Some(1767225600));
        assert_eq!(parse_iso("2026-01-01T02:00:00+02:00"), Some(1767225600));
        assert_eq!(parse_iso("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso("nonsense"), None);
        assert_eq!(parse_iso("2026-13-01T00:00:00Z"), None);
    }
}
