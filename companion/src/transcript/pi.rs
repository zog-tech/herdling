//! Pi session logs: `~/.pi/agent/sessions/--<cwd>--/<ts>_<id>.jsonl`. The entries form a
//! tree by `id` and `parentId`; the thread is the current branch.
//!
//! omp (oh-my-pi, see [`super::omp`]) writes the same format with some additions: a title line
//! before the header, `activeLeafId`, the `fileMention`, `pythonExecution` and `developer` roles,
//! synthetic user messages and `redactedThinking` blocks. This parser reads them too; Pi never
//! writes them.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::jsonl::{self, LineParser, Parsed};
use super::{short, text_result, tool_summary, PROMPT_SCAN_LINES};
use crate::claude::{cap, parse_ts};
use crate::types::{ThreadItem, ThreadPage};

/// Longest summary text of a compaction or branch row, in bytes.
const SUMMARY_CAP: usize = 280;

pub fn sessions_root(home: &Path) -> PathBuf {
    home.join(".pi").join("agent").join("sessions")
}

/// `--<cwd without the leading slash, with each '/', '\' and ':' as '-'>--`.
pub fn project_dir(home: &Path, cwd: &str) -> PathBuf {
    let trimmed = cwd.strip_prefix(['/', '\\']).unwrap_or(cwd);
    let name: String = trimmed.chars().map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c }).collect();
    sessions_root(home).join(format!("--{name}--"))
}

/// Maps Pi entries to thread items.
#[derive(Default)]
pub struct Parser {
    /// Ids of the current branch. `None` accepts every entry (follow mode).
    branch: Option<HashSet<String>>,
    /// Follow mode: the id of the last entry seen.
    last_id: Option<String>,
    moved: bool,
    /// Follow mode: true while the follower reads the lines before its start.
    seeding: bool,
}

impl Parser {
    /// A parser for pages: it keeps only the entries of `branch`.
    pub fn for_branch(branch: HashSet<String>) -> Parser {
        Parser { branch: Some(branch), ..Parser::default() }
    }

    /// A parser for follow: `last_id` is the leaf when the follow starts.
    pub fn for_follow(last_id: Option<String>) -> Parser {
        Parser { last_id, seeding: true, ..Parser::default() }
    }
}

impl LineParser for Parser {
    fn parse(&mut self, _off: u64, line: &str) -> Parsed {
        let Ok(v) = serde_json::from_str::<Value>(line) else { return Parsed::default() };
        let Some(id) = v.get("id").and_then(Value::as_str).map(String::from) else { return Parsed::default() };
        if v.get("type").and_then(Value::as_str) == Some("session") {
            return Parsed::default();
        }
        match &self.branch {
            Some(b) if !b.contains(&id) => return Parsed::default(),
            Some(_) => {}
            None if self.seeding => {}
            None => {
                let parent = v.get("parentId").and_then(Value::as_str);
                if let (Some(last), Some(parent)) = (&self.last_id, parent) {
                    if last != parent {
                        // The user moved to another point of the tree.
                        self.moved = true;
                        return Parsed::default();
                    }
                }
                self.last_id = Some(id.clone());
            }
        }
        entry(&v, &id)
    }

    fn ended(&self) -> Option<&'static str> {
        self.moved.then_some("branch_changed")
    }

    fn seeded(&mut self) {
        self.seeding = false;
    }
}

fn entry(v: &Value, id: &str) -> Parsed {
    let ts = v.get("timestamp").and_then(Value::as_str).and_then(parse_ts).unwrap_or(0);
    let mut out = Parsed::default();
    let sys = |text: String| ThreadItem::System { id: id.to_string(), ts, text: cap(&text, SUMMARY_CAP).0 };
    match v.get("type").and_then(Value::as_str) {
        Some("message") => message(v.get("message").unwrap_or(&Value::Null), id, ts, &mut out),
        Some("compaction") => {
            let s = v.get("summary").and_then(Value::as_str).unwrap_or("").trim();
            out.items.push(sys(format!("Conversation compacted. {s}").trim().to_string()));
        }
        Some("branch_summary") => {
            let s = v.get("summary").and_then(Value::as_str).unwrap_or("").trim();
            out.items.push(sys(format!("Branch summary: {s}")));
        }
        Some("custom_message") if v.get("display").and_then(Value::as_bool) == Some(true) => {
            let text = content_text(v.get("content"));
            if !text.trim().is_empty() {
                out.items.push(sys(text));
            }
        }
        _ => {}
    }
    out
}

/// Text of a `string | (TextContent | ImageContent)[]` content, and its image count.
fn content_parts(c: Option<&Value>) -> (String, u32) {
    match c {
        Some(Value::String(s)) => (s.clone(), 0),
        Some(Value::Array(a)) => {
            let mut texts = Vec::new();
            let mut images = 0;
            for b in a {
                match b.get("type").and_then(Value::as_str) {
                    Some("text") => texts.push(b.get("text").and_then(Value::as_str).unwrap_or("")),
                    Some("image") => images += 1,
                    _ => {}
                }
            }
            (texts.join("\n"), images)
        }
        _ => (String::new(), 0),
    }
}

fn content_text(c: Option<&Value>) -> String {
    content_parts(c).0
}

fn message(m: &Value, id: &str, ts: i64, out: &mut Parsed) {
    let block_id = |i: usize| format!("{id}:{i}");
    match m.get("role").and_then(Value::as_str) {
        // A message that omp adds by itself, not one the user typed.
        Some("user") if m.get("synthetic").and_then(Value::as_bool) == Some(true) => {}
        Some("user") => {
            let (text, images) = content_parts(m.get("content"));
            if !text.trim().is_empty() || images > 0 {
                out.items.push(ThreadItem::User { id: id.to_string(), ts, text, images: (images > 0).then_some(images) });
            }
        }
        Some("assistant") => {
            for (i, b) in m.get("content").and_then(Value::as_array).into_iter().flatten().enumerate() {
                let s = |k: &str| b.get(k).and_then(Value::as_str).unwrap_or("").to_string();
                match b.get("type").and_then(Value::as_str) {
                    Some("text") if !s("text").trim().is_empty() => {
                        out.items.push(ThreadItem::Assistant { id: block_id(i), ts, markdown: s("text") });
                    }
                    Some("thinking") if !s("thinking").trim().is_empty() => {
                        out.items.push(ThreadItem::Thinking { id: block_id(i), ts, text: Some(s("thinking")) });
                    }
                    Some("redactedThinking") => out.items.push(ThreadItem::Thinking { id: block_id(i), ts, text: None }),
                    Some("toolCall") => {
                        let name = s("name");
                        let input = b.get("arguments").cloned().unwrap_or(Value::Null);
                        let tid = Some(s("id")).filter(|x| !x.is_empty()).unwrap_or_else(|| block_id(i));
                        out.items.push(ThreadItem::Tool { input_summary: tool_summary(&name, &input), id: tid, ts, name, input, result: None });
                    }
                    _ => {}
                }
            }
            match m.get("stopReason").and_then(Value::as_str) {
                Some("error") => {
                    let e = m.get("errorMessage").and_then(Value::as_str).unwrap_or("Request failed");
                    out.items.push(ThreadItem::System { id: format!("{id}:stop"), ts, text: cap(e, SUMMARY_CAP).0 });
                }
                Some("aborted") => out.items.push(ThreadItem::System { id: format!("{id}:stop"), ts, text: "Interrupted".into() }),
                _ => {}
            }
        }
        Some("toolResult") => {
            let Some(call) = m.get("toolCallId").and_then(Value::as_str) else { return };
            let ok = !m.get("isError").and_then(Value::as_bool).unwrap_or(false);
            out.results.push((call.to_string(), text_result(&content_text(m.get("content")), ok, Some(ts))));
        }
        Some("bashExecution") => {
            // A shell command the user ran with `!`. It shows as a finished tool call.
            let command = m.get("command").and_then(Value::as_str).unwrap_or("").to_string();
            let input = serde_json::json!({ "command": command });
            let exit = m.get("exitCode").and_then(Value::as_i64);
            let cancelled = m.get("cancelled").and_then(Value::as_bool).unwrap_or(false);
            let output = m.get("output").and_then(Value::as_str).unwrap_or("");
            let result = text_result(output, !cancelled && exit.is_none_or(|c| c == 0), Some(ts));
            let name = "bash".to_string();
            out.items.push(ThreadItem::Tool { input_summary: tool_summary(&name, &input), id: id.to_string(), ts, name, input, result: Some(result) });
        }
        Some("pythonExecution") => {
            // omp: Python code the user ran. It shows as a finished tool call, like `bashExecution`.
            let code = m.get("code").or_else(|| m.get("command")).and_then(Value::as_str).unwrap_or("").to_string();
            let input = serde_json::json!({ "command": code });
            let exit = m.get("exitCode").and_then(Value::as_i64);
            let cancelled = m.get("cancelled").and_then(Value::as_bool).unwrap_or(false);
            let output = m.get("output").and_then(Value::as_str).unwrap_or("");
            let result = text_result(output, !cancelled && exit.is_none_or(|c| c == 0), Some(ts));
            let name = "python".to_string();
            out.items.push(ThreadItem::Tool { input_summary: tool_summary(&name, &input), id: id.to_string(), ts, name, input, result: Some(result) });
        }
        Some("fileMention") => {
            // omp: files the user mentioned with `@`. The file text goes to the model, not to the thread.
            let names: Vec<&str> = m
                .get("files")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|f| f.get("path").and_then(Value::as_str))
                .collect();
            if !names.is_empty() {
                out.items.push(ThreadItem::System { id: id.to_string(), ts, text: cap(&format!("Attached {}", names.join(", ")), SUMMARY_CAP).0 });
            }
        }
        Some("branchSummary" | "compactionSummary") => {
            let s = m.get("summary").and_then(Value::as_str).unwrap_or("");
            out.items.push(ThreadItem::System { id: id.to_string(), ts, text: cap(s, SUMMARY_CAP).0 });
        }
        Some("custom") if m.get("display").and_then(Value::as_bool) == Some(true) => {
            let text = content_text(m.get("content"));
            if !text.trim().is_empty() {
                out.items.push(ThreadItem::System { id: id.to_string(), ts, text: cap(&text, SUMMARY_CAP).0 });
            }
        }
        _ => {}
    }
}

/// The ids of the current branch (the chain from the last entry to the root), and the leaf id.
/// An omp entry with `activeLeafId` names the leaf when the entry itself is off the active branch.
pub fn branch(path: &Path) -> io::Result<(HashSet<String>, Option<String>)> {
    let mut parent: HashMap<String, Option<String>> = HashMap::new();
    let mut leaf = None;
    for line in BufReader::new(File::open(path)?).lines() {
        let line = line?;
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if v.get("type").and_then(Value::as_str) == Some("session") {
            continue;
        }
        let Some(id) = v.get("id").and_then(Value::as_str) else { continue };
        parent.insert(id.to_string(), v.get("parentId").and_then(Value::as_str).map(String::from));
        leaf = Some(v.get("activeLeafId").and_then(Value::as_str).unwrap_or(id).to_string());
    }
    let mut set = HashSet::new();
    let mut cur = leaf.clone();
    while let Some(id) = cur {
        if !set.insert(id.clone()) {
            break; // A loop. The file is damaged.
        }
        cur = parent.get(&id).cloned().flatten();
    }
    Ok((set, leaf))
}

/// One page of the current branch.
pub fn thread_get(path: &Path, before: Option<u64>, limit: usize) -> io::Result<ThreadPage> {
    let (set, _) = branch(path)?;
    jsonl::page(path, before, limit, &mut Parser::for_branch(set))
}

/// Session id and cwd from the header line. An omp title line before the header is skipped.
pub fn read_meta(path: &Path) -> Option<(String, String)> {
    let mut r = BufReader::new(File::open(path).ok()?);
    for _ in 0..2 {
        let mut line = String::new();
        r.read_line(&mut line).ok()?;
        let v: Value = serde_json::from_str(&line).ok()?;
        match v.get("type").and_then(Value::as_str) {
            Some("title") => continue,
            Some("session") => return Some((v.get("id")?.as_str()?.to_string(), v.get("cwd")?.as_str()?.to_string())),
            _ => return None,
        }
    }
    None
}

/// The session name (`session_info`), else the first user prompt.
pub fn first_prompt(path: &Path) -> String {
    let Ok(f) = File::open(path) else { return String::new() };
    let mut prompt = None;
    let mut name = None;
    for line in BufReader::new(f).lines().take(PROMPT_SCAN_LINES) {
        let Ok(line) = line else { break };
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        match v.get("type").and_then(Value::as_str) {
            Some("session_info") => name = v.get("name").and_then(Value::as_str).filter(|s| !s.trim().is_empty()).map(String::from),
            // omp: the title line, or a title in the header.
            Some("title" | "session") if name.is_none() => {
                name = v.get("title").and_then(Value::as_str).filter(|s| !s.trim().is_empty()).map(String::from)
            }
            Some("message") if prompt.is_none() => {
                let m = v.get("message").unwrap_or(&Value::Null);
                if m.get("role").and_then(Value::as_str) == Some("user") {
                    let t = content_text(m.get("content"));
                    if !t.trim().is_empty() {
                        prompt = Some(t);
                    }
                }
            }
            _ => {}
        }
    }
    name.or(prompt).map(|s| short(&s)).unwrap_or_default()
}
