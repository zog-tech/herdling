//! Map Claude Code JSONL lines to [`ThreadItem`]s.

use std::collections::HashMap;

use serde_json::Value;

use crate::types::{ThreadItem, ToolResult};

/// Tool result text cap in bytes.
pub const RESULT_CAP: usize = 4096;
const SUMMARY_CAP: usize = 80;
const COMPACT_CAP: usize = 280;

/// Turn one log line into items, one per content block. Unknown or invalid lines give none.
pub fn parse_line(line: &str) -> Vec<ThreadItem> {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return Vec::new() };
    let uuid = str_of(&v, "uuid");
    let ts = v.get("timestamp").and_then(Value::as_str).and_then(parse_ts).unwrap_or(0);
    match v.get("type").and_then(Value::as_str) {
        Some("user") => parse_user(&v, &uuid, ts),
        Some("assistant") => parse_assistant(&v, &uuid, ts),
        Some("system") => parse_system(&v, &uuid, ts),
        _ => Vec::new(),
    }
}

/// A tool result plus subagent details from the line's `toolUseResult` object.
#[derive(Debug, Clone)]
pub struct ResultInfo {
    pub result: ToolResult,
    pub agent_id: Option<String>,
    pub status: Option<String>,
}

/// Tool results found on one line, keyed by `tool_use_id`.
pub fn parse_results(line: &str) -> Vec<(String, ResultInfo)> {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return Vec::new() };
    if v.get("type").and_then(Value::as_str) != Some("user") {
        return Vec::new();
    }
    let Some(blocks) = v.pointer("/message/content").and_then(Value::as_array) else { return Vec::new() };
    let ts = v.get("timestamp").and_then(Value::as_str).and_then(parse_ts);
    let blocks: Vec<&Value> =
        blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_result")).collect();
    // `toolUseResult` describes one call. Use it only when the line holds one result.
    let extra = if blocks.len() == 1 { v.get("toolUseResult") } else { None };
    let agent_id = extra.and_then(|t| t.get("agentId")).and_then(Value::as_str).map(String::from);
    let status = extra.and_then(|t| t.get("status")).and_then(Value::as_str).map(String::from);
    blocks
        .into_iter()
        .filter_map(|b| {
            let id = b.get("tool_use_id")?.as_str()?.to_string();
            let ok = !b.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            let (text, truncated) = cap(&result_text(b.get("content")), RESULT_CAP);
            let result = ToolResult { ok, text, truncated, ts };
            Some((id, ResultInfo { result, agent_id: agent_id.clone(), status: status.clone() }))
        })
        .collect()
}

/// Merge tool results into the tool and subagent items with the same id.
pub fn assemble(mut items: Vec<ThreadItem>, mut results: HashMap<String, ResultInfo>) -> Vec<ThreadItem> {
    for item in &mut items {
        match item {
            ThreadItem::Tool { id, result, .. } => {
                if let Some(r) = results.remove(id.as_str()) {
                    *result = Some(r.result);
                }
            }
            ThreadItem::Subagent { id, agent_id, status, result_summary, .. } => {
                if let Some(r) = results.remove(id.as_str()) {
                    *status = r.status.unwrap_or_else(|| if r.result.ok { "done" } else { "error" }.into());
                    if let Some(a) = r.agent_id {
                        *agent_id = a;
                    }
                    *result_summary = Some(cap(&r.result.text, 500).0);
                }
            }
            _ => {}
        }
    }
    items
}

fn str_of(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

fn flag(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn block_id(uuid: &str, i: usize) -> String {
    format!("{uuid}:{i}")
}

fn parse_user(v: &Value, uuid: &str, ts: i64) -> Vec<ThreadItem> {
    if flag(v, "isCompactSummary") {
        let text = v.pointer("/message/content").map(|c| result_text(Some(c))).unwrap_or_default();
        let head = format!("Conversation compacted. {}", text.trim());
        return vec![ThreadItem::System { id: block_id(uuid, 0), ts, text: cap(&head, COMPACT_CAP).0 }];
    }
    if flag(v, "isMeta") {
        return Vec::new();
    }
    let content = v.pointer("/message/content");
    let (text, images, first) = match content {
        Some(Value::String(s)) => (s.clone(), 0u32, 0usize),
        Some(Value::Array(blocks)) => {
            let mut texts = Vec::new();
            let mut images = 0u32;
            let mut first = None;
            for (i, b) in blocks.iter().enumerate() {
                match b.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        first.get_or_insert(i);
                        texts.push(str_of(b, "text"));
                    }
                    Some("image") => {
                        first.get_or_insert(i);
                        images += 1;
                    }
                    _ => {}
                }
            }
            (texts.join("\n"), images, first.unwrap_or(0))
        }
        _ => return Vec::new(),
    };
    if text.trim().is_empty() && images == 0 {
        return Vec::new();
    }
    let id = block_id(uuid, first);
    if text.starts_with("[Request interrupted by user") {
        return vec![ThreadItem::System { id, ts, text }];
    }
    let images = (images > 0).then_some(images);
    match classify_user_text(&text) {
        UserText::Prompt(text) => vec![ThreadItem::User { id, ts, text, images }],
        UserText::System(text) => vec![ThreadItem::System { id, ts, text }],
        UserText::Drop if images.is_some() => vec![ThreadItem::User { id, ts, text: String::new(), images }],
        UserText::Drop => Vec::new(),
    }
}

/// What a user-role text line really is. Claude Code writes harness messages (task
/// notifications, slash commands, reminders) as user lines, often without `isMeta`.
#[derive(Debug, PartialEq)]
enum UserText {
    Prompt(String),
    System(String),
    Drop,
}

fn classify_user_text(text: &str) -> UserText {
    let t = text.trim_start();
    if t.starts_with("<task-notification>") {
        let status = tag_text(t, "status").filter(|s| !s.is_empty());
        let summary = tag_text(t, "summary").filter(|s| !s.is_empty());
        let line = match (status, summary) {
            (Some(st), Some(su)) => format!("Background task {st}: {su}"),
            (None, Some(su)) => format!("Background task: {su}"),
            _ => "Background task update".to_string(),
        };
        return UserText::System(cap(&line, COMPACT_CAP).0);
    }
    if t.starts_with("<command-") {
        return match tag_text(t, "command-name").filter(|n| !n.is_empty()) {
            Some(name) => {
                let args = tag_text(t, "command-args").unwrap_or("");
                UserText::Prompt(if args.is_empty() { name.to_string() } else { format!("{name} {args}") })
            }
            None => UserText::Drop,
        };
    }
    if t.starts_with("<local-command-stdout>") {
        let out = tag_text(t, "local-command-stdout").unwrap_or("");
        return if out.is_empty() { UserText::Drop } else { UserText::System(cap(out, RESULT_CAP).0) };
    }
    if t.starts_with("<local-command-caveat>") {
        return UserText::Drop;
    }
    if t.starts_with("<system-reminder>") {
        let rest = strip_tag_blocks(t, "system-reminder");
        let rest = rest.trim();
        return if rest.is_empty() { UserText::Drop } else { UserText::Prompt(rest.to_string()) };
    }
    UserText::Prompt(text.to_string())
}

/// Trimmed text between the first `<name>` and the next `</name>`.
fn tag_text<'a>(s: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let start = s.find(&open)? + open.len();
    let end = s[start..].find(&close).map_or(s.len(), |e| start + e);
    Some(s[start..end].trim())
}

/// `s` with every `<name>…</name>` block removed.
fn strip_tag_blocks(s: &str, name: &str) -> String {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find(&open) {
        out.push_str(&rest[..i]);
        match rest[i..].find(&close) {
            Some(j) => rest = &rest[i + j + close.len()..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

fn parse_assistant(v: &Value, uuid: &str, ts: i64) -> Vec<ThreadItem> {
    let Some(blocks) = v.pointer("/message/content").and_then(Value::as_array) else { return Vec::new() };
    let mut out = Vec::new();
    for (i, b) in blocks.iter().enumerate() {
        match b.get("type").and_then(Value::as_str) {
            Some("text") => {
                let markdown = str_of(b, "text");
                if !markdown.trim().is_empty() {
                    out.push(ThreadItem::Assistant { id: block_id(uuid, i), ts, markdown });
                }
            }
            Some("thinking") => {
                let t = str_of(b, "thinking");
                out.push(ThreadItem::Thinking {
                    id: block_id(uuid, i),
                    ts,
                    text: (!t.trim().is_empty()).then_some(t),
                });
            }
            Some("tool_use") => out.push(tool_item(b, uuid, i, ts)),
            _ => {}
        }
    }
    out
}

fn tool_item(b: &Value, uuid: &str, i: usize, ts: i64) -> ThreadItem {
    let name = str_of(b, "name");
    let input = b.get("input").cloned().unwrap_or(Value::Null);
    let id = match b.get("id").and_then(Value::as_str) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => block_id(uuid, i),
    };
    if name == "Task" || name == "Agent" {
        let description = input
            .get("description")
            .or_else(|| input.get("prompt"))
            .and_then(Value::as_str)
            .map(|s| cap(s, 200).0)
            .unwrap_or_default();
        return ThreadItem::Subagent {
            agent_id: String::new(),
            id,
            ts,
            description,
            status: "running".into(),
            result_summary: None,
        };
    }
    ThreadItem::Tool { input_summary: summarize(&name, &input), id, ts, name, input, result: None }
}

fn summarize(name: &str, input: &Value) -> String {
    let key = match name {
        "Bash" => Some("command"),
        "Read" | "Edit" | "Write" => Some("file_path"),
        "Grep" | "Glob" => Some("pattern"),
        _ => None,
    };
    let s = key
        .and_then(|k| input.get(k).and_then(Value::as_str))
        .or_else(|| input.as_object().and_then(|o| o.values().find_map(Value::as_str)))
        .unwrap_or("");
    cap(s, SUMMARY_CAP).0
}

fn parse_system(v: &Value, uuid: &str, ts: i64) -> Vec<ThreadItem> {
    let subtype = v.get("subtype").and_then(Value::as_str).unwrap_or("");
    let content = v.get("content").and_then(Value::as_str).unwrap_or("").trim();
    // Bookkeeping lines such as turn_duration carry no message for the reader.
    let text = match (content.is_empty(), subtype) {
        (false, _) => content.to_string(),
        (true, "compact_boundary") => "Conversation compacted".into(),
        _ => return Vec::new(),
    };
    vec![ThreadItem::System { id: block_id(uuid, 0), ts, text: cap(&text, COMPACT_CAP).0 }]
}

/// Tool result `content` is a string or a list of text blocks.
fn result_text(c: Option<&Value>) -> String {
    match c {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Cut `s` to at most `max` bytes on a char boundary.
fn cap(s: &str, max: usize) -> (String, bool) {
    if s.len() <= max {
        return (s.to_string(), false);
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    (s[..end].to_string(), true)
}

/// ISO 8601 UTC (`2026-10-10T23:20:46.566Z`) to epoch milliseconds.
fn parse_ts(s: &str) -> Option<i64> {
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-');
    let (y, m, day): (i64, i64, i64) = (d.next()?.parse().ok()?, d.next()?.parse().ok()?, d.next()?.parse().ok()?);
    let time = time.trim_end_matches('Z');
    let time = time.split(['+', '-']).next()?;
    let mut t = time.split(':');
    let (h, mi): (i64, i64) = (t.next()?.parse().ok()?, t.next()?.parse().ok()?);
    let sec: f64 = t.next().unwrap_or("0").parse().ok()?;
    // Days from civil (Howard Hinnant).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(((days * 86400 + h * 3600 + mi * 60) as f64 * 1000.0 + (sec * 1000.0).round()) as i64)
}
