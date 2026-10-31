//! Codex rollout logs: `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`.

use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::{json, Value};

use super::jsonl::{LineParser, Parsed};
use super::{millis, mtime, short, text_result, tool_summary, CandidateSession, PROMPT_SCAN_LINES};
use crate::claude::parse_ts;
use crate::types::{ThreadItem, ToolResult};

/// Longest `session_meta` line read. The line holds the base instructions, so it can be large.
const META_CAP: u64 = 4 * 1024 * 1024;
/// Most log files looked at for one list.
const SCAN_CAP: usize = 2000;

pub fn sessions_root(home: &Path) -> PathBuf {
    home.join(".codex").join("sessions")
}

/// Maps rollout lines to thread items. User prompts come from `event_msg` lines: the
/// `response_item` user messages also hold injected context.
#[derive(Default)]
pub struct Parser;

impl LineParser for Parser {
    fn parse(&mut self, off: u64, line: &str) -> Parsed {
        let Ok(v) = serde_json::from_str::<Value>(line) else { return Parsed::default() };
        let ts = v.get("timestamp").and_then(Value::as_str).and_then(parse_ts).unwrap_or(0);
        let Some(p) = v.get("payload").filter(|p| p.is_object()) else { return Parsed::default() };
        let ptype = p.get("type").and_then(Value::as_str).unwrap_or("");
        let line_id = format!("cx:{off}");
        let id_or = |key: &str| p.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map_or(line_id.clone(), String::from);
        let mut out = Parsed::default();
        match (v.get("type").and_then(Value::as_str).unwrap_or(""), ptype) {
            ("event_msg", "user_message") => {
                let text = p.get("message").and_then(Value::as_str).unwrap_or("").to_string();
                let count = |k: &str| p.get(k).and_then(Value::as_array).map_or(0, |a| a.len() as u32);
                push_user(&mut out, line_id, ts, text, count("images") + count("local_images"));
            }
            ("event_msg", "item_completed") => {
                let Some(item) = p.get("item") else { return out };
                if item.get("type").and_then(Value::as_str) != Some("UserMessage") {
                    return out;
                }
                let mut texts = Vec::new();
                let mut images = 0;
                for c in item.get("content").and_then(Value::as_array).into_iter().flatten() {
                    match c.get("type").and_then(Value::as_str) {
                        Some("text") => texts.push(c.get("text").and_then(Value::as_str).unwrap_or("")),
                        Some(t) if t.contains("image") => images += 1,
                        _ => {}
                    }
                }
                let id = item.get("id").and_then(Value::as_str).map_or(line_id, String::from);
                push_user(&mut out, id, ts, texts.join("\n"), images);
            }
            ("event_msg", "context_compacted") => out.items.push(system(line_id, ts, "Conversation compacted")),
            ("event_msg", "turn_aborted") => out.items.push(system(line_id, ts, "Interrupted")),
            ("event_msg", "thread_rolled_back") => {
                let n = p.get("num_turns").and_then(Value::as_u64).unwrap_or(1);
                let text = if n == 1 { "Rolled back 1 turn".to_string() } else { format!("Rolled back {n} turns") };
                out.items.push(system(line_id, ts, &text));
            }
            ("response_item", "message") if p.get("role").and_then(Value::as_str) == Some("assistant") => {
                let markdown = blocks_text(p.get("content"), "output_text");
                if !markdown.trim().is_empty() {
                    out.items.push(ThreadItem::Assistant { id: id_or("id"), ts, markdown });
                }
            }
            ("response_item", "reasoning") => {
                let text = blocks_text(p.get("summary"), "summary_text");
                if !text.trim().is_empty() {
                    out.items.push(ThreadItem::Thinking { id: id_or("id"), ts, text: Some(text) });
                }
            }
            ("response_item", "function_call") => {
                let args = p.get("arguments").and_then(Value::as_str).unwrap_or("");
                let input = serde_json::from_str::<Value>(args).unwrap_or_else(|_| json!({ "input": args }));
                out.items.push(tool(id_or("call_id"), ts, str_of(p, "name"), input));
            }
            ("response_item", "custom_tool_call") => {
                let input = json!({ "input": str_of(p, "input") });
                out.items.push(tool(id_or("call_id"), ts, str_of(p, "name"), input));
            }
            ("response_item", "local_shell_call") => {
                let input = p.get("action").cloned().unwrap_or(Value::Null);
                out.items.push(tool(id_or("call_id"), ts, "shell".into(), input));
            }
            ("response_item", "web_search_call") => {
                let input = p.get("action").cloned().unwrap_or(Value::Null);
                let id = id_or("id");
                out.items.push(tool(id.clone(), ts, "web_search".into(), input));
                let ok = p.get("status").and_then(Value::as_str) != Some("failed");
                out.results.push((id, ToolResult { ok, text: String::new(), truncated: false, ts: Some(ts) }));
            }
            ("response_item", "function_call_output" | "custom_tool_call_output") => {
                let Some(call) = p.get("call_id").and_then(Value::as_str) else { return out };
                out.results.push((call.to_string(), output_result(p.get("output"), ts)));
            }
            _ => {}
        }
        out
    }
}

fn str_of(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

fn push_user(out: &mut Parsed, id: String, ts: i64, text: String, images: u32) {
    if text.trim().is_empty() && images == 0 {
        return;
    }
    out.items.push(ThreadItem::User { id, ts, text, images: (images > 0).then_some(images) });
}

fn system(id: String, ts: i64, text: &str) -> ThreadItem {
    ThreadItem::System { id, ts, text: text.to_string() }
}

fn tool(id: String, ts: i64, name: String, input: Value) -> ThreadItem {
    ThreadItem::Tool { input_summary: tool_summary(&name, &input), id, ts, name, input, result: None }
}

/// The text of the blocks of type `kind` in a content array, joined by blank lines.
fn blocks_text(c: Option<&Value>, kind: &str) -> String {
    c.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some(kind))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// A tool output is a string, a list of text blocks, or an object with `content` and `success`.
fn output_result(o: Option<&Value>, ts: i64) -> ToolResult {
    let (text, success) = match o {
        Some(Value::String(s)) => (s.clone(), None),
        Some(Value::Array(_)) => (blocks_text(o, "input_text"), None),
        Some(Value::Object(m)) => {
            let text = m.get("content").or_else(|| m.get("output")).and_then(Value::as_str).unwrap_or("").to_string();
            (text, m.get("success").and_then(Value::as_bool))
        }
        _ => (String::new(), None),
    };
    let ok = success.unwrap_or_else(|| !exit_failed(&text));
    text_result(&text, ok, Some(ts))
}

/// True when the first lines of a command output report a non-zero exit code.
fn exit_failed(text: &str) -> bool {
    text.lines().take(8).any(|l| {
        let rest = l.strip_prefix("Exit code: ").or_else(|| l.strip_prefix("Process exited with code "));
        rest.and_then(|r| r.trim().parse::<i64>().ok()).is_some_and(|c| c != 0)
    })
}

/// Session id and cwd from the first line of a rollout log.
pub fn read_meta(path: &Path) -> Option<(String, String)> {
    let f = File::open(path).ok()?;
    let mut line = String::new();
    BufReader::new(f.take(META_CAP)).read_line(&mut line).ok()?;
    let v: Value = serde_json::from_str(&line).ok()?;
    if v.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    let p = v.get("payload")?;
    let id = p.get("id").or_else(|| p.get("session_id")).and_then(Value::as_str)?.to_string();
    Some((id, p.get("cwd").and_then(Value::as_str)?.to_string()))
}

/// Every rollout log with its mtime, newest first. At most [`SCAN_CAP`] files.
pub fn logs(home: &Path) -> Vec<(PathBuf, SystemTime)> {
    let sorted_dirs = |p: &Path| -> Vec<PathBuf> {
        let Ok(rd) = std::fs::read_dir(p) else { return Vec::new() };
        let mut v: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect();
        v.sort();
        v.reverse();
        v
    };
    let mut out = Vec::new();
    // Day folders are walked newest first, so the scan can stop early.
    'walk: for y in sorted_dirs(&sessions_root(home)) {
        for m in sorted_dirs(&y) {
            for d in sorted_dirs(&m) {
                let Ok(rd) = std::fs::read_dir(&d) else { continue };
                for p in rd.filter_map(|e| e.ok()).map(|e| e.path()) {
                    if p.extension().is_some_and(|x| x == "jsonl") {
                        if let Some(t) = mtime(&p) {
                            out.push((p, t));
                        }
                    }
                }
                if out.len() >= SCAN_CAP {
                    break 'walk;
                }
            }
        }
    }
    out.sort_by_key(|e| std::cmp::Reverse(e.1));
    out
}

/// Sessions of all folders, newest first.
pub fn candidates(home: &Path) -> Vec<CandidateSession> {
    logs(home)
        .into_iter()
        .filter_map(|(path, t)| {
            let (id, cwd) = read_meta(&path)?;
            Some(CandidateSession { id, cwd, log_path: path.to_string_lossy().into_owned(), last_activity: millis(t) })
        })
        .collect()
}

/// The first user prompt of a log.
pub fn first_prompt(path: &Path) -> String {
    let Ok(f) = File::open(path) else { return String::new() };
    let mut p = Parser;
    let mut off = 0u64;
    for line in BufReader::new(f).lines().take(PROMPT_SCAN_LINES) {
        let Ok(line) = line else { break };
        let len = line.len() as u64 + 1;
        for item in p.parse(off, &line).items {
            if let ThreadItem::User { text, .. } = item {
                if !text.trim().is_empty() {
                    return short(&text);
                }
            }
        }
        off += len;
    }
    String::new()
}
