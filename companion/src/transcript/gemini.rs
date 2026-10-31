//! Gemini CLI sessions: `~/.gemini/tmp/<project>/chats/session-<time>-<id>.jsonl`.
//!
//! The project folder is a short name from `~/.gemini/projects.json` (`{"projects": {"<cwd>":
//! "<name>"}}`), with a `.project_root` file that holds the cwd. Older versions used the SHA-256 of
//! the cwd as the folder name.
//!
//! A file is JSON lines. The first line is the metadata (`sessionId`, `projectHash`, ...). A line
//! with an `id` is a message: a message can come again with the same `id` (the last copy wins and
//! keeps the first place). `{"$set": {...}}` changes the metadata, `{"$patch": {...}}` changes
//! messages, and `{"$rewindTo": "<id>"}` removes that message and all after it. Older files are one
//! JSON object with a `messages` array.
//!
//! Because messages change in place, pages count thread items, not bytes: `before` and the page
//! cursor are item indexes. The page `end` is the file size, which the follower starts from.
//!
//! Not read: `GEMINI_CLI_HOME` and the sandbox folder `~/.cache/.gemini`.

use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use super::{millis, mtime, short, text_result, tool_summary, CandidateSession};
use crate::claude::{cap, parse_ts};
use crate::types::{ThreadItem, ThreadPage};

/// Longest system row, in bytes.
const SYSTEM_CAP: usize = 280;
/// Larger session files are not read.
const MAX_FILE: u64 = 64 << 20;

pub fn root(home: &Path) -> PathBuf {
    home.join(".gemini")
}

pub fn tmp_root(home: &Path) -> PathBuf {
    root(home).join("tmp")
}

fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// The project folders that can hold the sessions of `cwd`: the registry name, a folder whose
/// `.project_root` names `cwd`, and the older SHA-256 folder. Only folders that exist.
pub fn project_dirs(home: &Path, cwd: &str) -> Vec<PathBuf> {
    let tmp = tmp_root(home);
    let mut out: Vec<PathBuf> = Vec::new();
    let mut add = |p: PathBuf| {
        if p.is_dir() && !out.contains(&p) {
            out.push(p);
        }
    };
    if let Ok(text) = std::fs::read_to_string(root(home).join("projects.json")) {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            if let Some(name) = v.get("projects").and_then(|p| p.get(cwd)).and_then(Value::as_str) {
                if !name.contains(['/', '\\']) && name != ".." {
                    add(tmp.join(name));
                }
            }
        }
    }
    for (dir, root) in project_roots(home) {
        if root == cwd {
            add(dir);
        }
    }
    add(tmp.join(sha256_hex(cwd)));
    out
}

/// Every project folder with a `.project_root` file, and the cwd it names.
pub fn project_roots(home: &Path) -> Vec<(PathBuf, String)> {
    let Ok(rd) = std::fs::read_dir(tmp_root(home)) else { return Vec::new() };
    rd.filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter_map(|dir| {
            let root = std::fs::read_to_string(dir.join(".project_root")).ok()?;
            let root = root.trim().to_string();
            (!root.is_empty()).then_some((dir, root))
        })
        .collect()
}

/// Session files of a project folder (`chats/*.jsonl` and older `chats/*.json`), newest first.
pub fn session_files(project: &Path) -> Vec<(PathBuf, SystemTime)> {
    let Ok(rd) = std::fs::read_dir(project.join("chats")) else { return Vec::new() };
    let mut files: Vec<(PathBuf, SystemTime)> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|x| x == "jsonl" || x == "json"))
        .filter_map(|p| mtime(&p).map(|t| (p, t)))
        .collect();
    files.sort_by_key(|e| std::cmp::Reverse(e.1));
    // A legacy `.json` file that was moved to `.jsonl` is left out.
    let names: HashSet<PathBuf> = files.iter().map(|(p, _)| p.clone()).collect();
    files.retain(|(p, _)| !(p.extension().is_some_and(|x| x == "json") && names.contains(&p.with_extension("jsonl"))));
    files
}

/// The session state after all records: the metadata and the messages in order.
#[derive(Debug, Default, Clone)]
pub struct Session {
    pub meta: Map<String, Value>,
    pub messages: Vec<Value>,
}

impl Session {
    fn pos(&self, id: &str) -> Option<usize> {
        self.messages.iter().position(|m| m.get("id").and_then(Value::as_str) == Some(id))
    }

    fn upsert(&mut self, m: Value) {
        let id = m.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        match self.pos(&id) {
            Some(i) => self.messages[i] = m,
            None => self.messages.push(m),
        }
    }

    /// Merges a patch into the message with its `id`. A tool call patch merges into the tool call
    /// with the same `id`.
    fn patch_message(&mut self, p: &Value) {
        let Some(id) = p.get("id").and_then(Value::as_str) else { return };
        let Some(i) = self.pos(id) else { return };
        let Some(msg) = self.messages[i].as_object_mut() else { return };
        for (k, v) in p.as_object().into_iter().flatten() {
            match k.as_str() {
                "id" => {}
                "toolCalls" => {
                    let calls = msg.entry("toolCalls").or_insert_with(|| Value::Array(Vec::new()));
                    let Some(calls) = calls.as_array_mut() else { continue };
                    for tp in v.as_array().into_iter().flatten() {
                        let tid = tp.get("id").and_then(Value::as_str);
                        match calls.iter_mut().find(|c| c.get("id").and_then(Value::as_str) == tid) {
                            Some(c) => {
                                if let (Some(c), Some(tp)) = (c.as_object_mut(), tp.as_object()) {
                                    for (tk, tv) in tp {
                                        c.insert(tk.clone(), tv.clone());
                                    }
                                }
                            }
                            None => calls.push(tp.clone()),
                        }
                    }
                }
                _ => {
                    msg.insert(k.clone(), v.clone());
                }
            }
        }
    }

    fn apply_patch(&mut self, p: &Value) {
        self.patch_message(p);
        for u in p.get("updates").and_then(Value::as_array).into_iter().flatten() {
            self.patch_message(u);
        }
        if let Some(ids) = p.get("removeIds").and_then(Value::as_array) {
            let ids: HashSet<&str> = ids.iter().filter_map(Value::as_str).collect();
            self.messages.retain(|m| !m.get("id").and_then(Value::as_str).is_some_and(|i| ids.contains(i)));
        }
        for id in p.get("orderIds").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
            if let Some(i) = self.pos(id) {
                let m = self.messages.remove(i);
                self.messages.push(m);
            }
        }
    }

    /// Applies one JSON line.
    pub fn apply(&mut self, v: Value) {
        if let Some(to) = v.get("$rewindTo") {
            match to.as_str().and_then(|id| self.pos(id)) {
                Some(i) => self.messages.truncate(i),
                None => self.messages.clear(),
            }
        } else if let Some(p) = v.get("$patch") {
            self.apply_patch(p);
        } else if v.get("id").is_some_and(Value::is_string) {
            self.upsert(v);
        } else if let Some(set) = v.get("$set").and_then(Value::as_object) {
            for (k, x) in set {
                if k == "messages" {
                    if let Some(a) = x.as_array() {
                        self.messages = a.clone();
                    }
                } else {
                    self.meta.insert(k.clone(), x.clone());
                }
            }
        } else if v.get("sessionId").is_some_and(Value::is_string) && v.get("projectHash").is_some_and(Value::is_string) {
            if let Some(o) = v.as_object() {
                for (k, x) in o {
                    if k != "messages" {
                        self.meta.insert(k.clone(), x.clone());
                    }
                }
                if let Some(a) = o.get("messages").and_then(Value::as_array) {
                    // An older file: one object with every message.
                    self.messages = a.clone();
                }
            }
        }
    }

    pub fn session_id(&self) -> Option<&str> {
        self.meta.get("sessionId").and_then(Value::as_str)
    }
}

/// Reads session text: JSON lines, or one JSON object (an older file). A last line that is not
/// complete yet is left out.
pub fn parse(text: &str) -> Session {
    let mut s = Session::default();
    let trimmed = text.trim_start();
    if trimmed.starts_with('{') {
        // An older file is one object that can span many lines.
        if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
            if v.get("messages").is_some() {
                s.apply(v);
                return s;
            }
        }
    }
    for line in text.lines() {
        if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
            s.apply(v);
        }
    }
    s
}

fn read(path: &Path, upto: Option<u64>) -> io::Result<(Session, u64)> {
    let meta = std::fs::metadata(path)?;
    if meta.len() > MAX_FILE {
        return Err(io::Error::other(format!("session file larger than {MAX_FILE} bytes")));
    }
    let bytes = std::fs::read(path)?;
    let len = bytes.len() as u64;
    let end = match upto {
        // Only complete lines before `upto`.
        Some(u) if u < len => bytes[..u as usize].iter().rposition(|c| *c == b'\n').map_or(0, |i| i + 1),
        _ => bytes.len(),
    };
    Ok((parse(&String::from_utf8_lossy(&bytes[..end])), len))
}

/// Text, image count, and whether the parts hold only tool responses, of a `PartListUnion`.
fn parts(v: Option<&Value>) -> (String, u32, bool) {
    let mut texts: Vec<String> = Vec::new();
    let mut images = 0;
    let mut responses = false;
    let mut part = |p: &Value| match p {
        Value::String(s) => texts.push(s.clone()),
        Value::Object(o) => {
            if let Some(t) = o.get("text").and_then(Value::as_str) {
                if o.get("thought").and_then(Value::as_bool) != Some(true) {
                    texts.push(t.to_string());
                }
            }
            for k in ["inlineData", "fileData"] {
                if o.get(k).and_then(|d| d.get("mimeType")).and_then(Value::as_str).is_some_and(|m| m.starts_with("image/")) {
                    images += 1;
                }
            }
            if o.contains_key("functionResponse") {
                responses = true;
            }
        }
        _ => {}
    };
    match v {
        Some(Value::Array(a)) => a.iter().for_each(&mut part),
        Some(p) => part(p),
        None => {}
    }
    let text = texts.join("\n");
    let only = responses && text.trim().is_empty();
    (text, images, only)
}

/// The text of a tool result: `resultDisplay` when it is text, else the function responses.
fn result_text(call: &Value) -> String {
    if let Some(s) = call.get("resultDisplay").and_then(Value::as_str) {
        return s.to_string();
    }
    let mut out = Vec::new();
    let items: Vec<&Value> = match call.get("result") {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(v) if !v.is_null() => vec![v],
        _ => Vec::new(),
    };
    for p in items {
        if let Some(r) = p.get("functionResponse").and_then(|f| f.get("response")) {
            match (r.get("output").and_then(Value::as_str), r.get("error").and_then(Value::as_str)) {
                (Some(o), _) => out.push(o.to_string()),
                (None, Some(e)) => out.push(e.to_string()),
                _ => out.push(r.to_string()),
            }
        } else if let Some(t) = p.get("text").and_then(Value::as_str) {
            out.push(t.to_string());
        } else if let Some(s) = p.as_str() {
            out.push(s.to_string());
        }
    }
    out.join("\n")
}

/// Injected context, not a prompt the user typed.
fn injected(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with("<session_context>") || t.starts_with("<hook_context>")
}

/// Thread items of one message.
fn message_items(m: &Value, out: &mut Vec<ThreadItem>) {
    let Some(id) = m.get("id").and_then(Value::as_str) else { return };
    let ts = m.get("timestamp").and_then(Value::as_str).and_then(parse_ts).unwrap_or(0);
    match m.get("type").and_then(Value::as_str) {
        Some("user") => {
            let (text, images, only_responses) = parts(m.get("displayContent").or_else(|| m.get("content")));
            if only_responses || injected(&text) || (text.trim().is_empty() && images == 0) {
                return;
            }
            out.push(ThreadItem::User { id: id.to_string(), ts, text, images: (images > 0).then_some(images) });
        }
        Some("gemini") => {
            let thoughts: Vec<String> = m
                .get("thoughts")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|t| {
                    let s = |k: &str| t.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
                    match (s("subject"), s("description")) {
                        (a, b) if a.is_empty() => b,
                        (a, b) if b.is_empty() => a,
                        (a, b) => format!("{a}\n{b}"),
                    }
                })
                .filter(|t| !t.is_empty())
                .collect();
            if !thoughts.is_empty() {
                out.push(ThreadItem::Thinking { id: format!("{id}:think"), ts, text: Some(thoughts.join("\n\n")) });
            }
            let (text, _, _) = parts(m.get("content"));
            if !text.trim().is_empty() {
                out.push(ThreadItem::Assistant { id: id.to_string(), ts, markdown: text });
            }
            for (i, c) in m.get("toolCalls").and_then(Value::as_array).into_iter().flatten().enumerate() {
                let name = c.get("name").and_then(Value::as_str).unwrap_or("tool").to_string();
                let input = c.get("args").cloned().unwrap_or(Value::Null);
                let tid = c.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| format!("{id}:tool:{i}"));
                let cts = c.get("timestamp").and_then(Value::as_str).and_then(parse_ts).unwrap_or(ts);
                let result = match c.get("status").and_then(Value::as_str) {
                    Some("success") => Some(text_result(&result_text(c), true, Some(cts))),
                    Some("error" | "cancelled") => {
                        let t = result_text(c);
                        let t = if t.trim().is_empty() && c.get("status").and_then(Value::as_str) == Some("cancelled") { "Cancelled".to_string() } else { t };
                        Some(text_result(&t, false, Some(cts)))
                    }
                    _ => None,
                };
                out.push(ThreadItem::Tool { input_summary: tool_summary(&name, &input), id: tid, ts: cts, name, input, result });
            }
        }
        Some("info" | "warning" | "error") => {
            let (text, _, _) = parts(m.get("content"));
            if !text.trim().is_empty() {
                out.push(ThreadItem::System { id: id.to_string(), ts, text: cap(&text, SYSTEM_CAP).0 });
            }
        }
        _ => {}
    }
}

/// Every thread item of a session, oldest first.
pub fn items(s: &Session) -> Vec<ThreadItem> {
    let mut out = Vec::new();
    for m in &s.messages {
        message_items(m, &mut out);
    }
    out
}

/// One page of items that ends before item index `before` (default: the newest).
pub fn thread_get(path: &Path, before: Option<u64>, limit: usize) -> io::Result<ThreadPage> {
    let (s, len) = read(path, None)?;
    let all = items(&s);
    let end = before.map_or(all.len(), |b| (b as usize).min(all.len()));
    let start = end.saturating_sub(limit.max(1));
    Ok(ThreadPage { items: all[start..end].to_vec(), cursor: (start > 0).then_some(start as u64), end: len })
}

fn item_id(i: &ThreadItem) -> &str {
    match i {
        ThreadItem::User { id, .. }
        | ThreadItem::Assistant { id, .. }
        | ThreadItem::Thinking { id, .. }
        | ThreadItem::Tool { id, .. }
        | ThreadItem::Subagent { id, .. }
        | ThreadItem::System { id, .. } => id,
    }
}

/// Follows a session file: on each change it reads the file again and sends the items that are
/// new or changed (a tool call that got its result comes again with the same id).
pub struct Follower {
    path: PathBuf,
    offset: u64,
    modified: Option<SystemTime>,
    seen: HashMap<String, String>,
}

impl Follower {
    /// `from` is the `end` of the last page: the items in the file up to there count as sent.
    pub fn new(path: &Path, from: u64) -> io::Result<Follower> {
        let (s, len) = read(path, Some(from))?;
        let seen = items(&s).iter().map(|i| (item_id(i).to_string(), serde_json::to_string(i).unwrap_or_default())).collect();
        Ok(Follower { path: path.to_path_buf(), offset: from.min(len), modified: None, seen })
    }

    pub fn offset(&self) -> u64 {
        self.offset
    }

    pub fn poll(&mut self) -> io::Result<Option<(Vec<ThreadItem>, u64)>> {
        let meta = std::fs::metadata(&self.path)?;
        let modified = meta.modified().ok();
        if meta.len() == self.offset && modified == self.modified {
            return Ok(None);
        }
        let (s, len) = read(&self.path, None)?;
        self.modified = modified;
        self.offset = len;
        let mut out = Vec::new();
        for item in items(&s) {
            let json = serde_json::to_string(&item).unwrap_or_default();
            if self.seen.get(item_id(&item)) != Some(&json) {
                self.seen.insert(item_id(&item).to_string(), json);
                out.push(item);
            }
        }
        Ok(Some((out, len)))
    }
}

/// The session id in the metadata of a file.
pub fn read_id(path: &Path) -> Option<String> {
    let (s, _) = read(path, None).ok()?;
    s.session_id().map(String::from)
}

/// The summary of a session, else its first prompt.
pub fn first_prompt(path: &Path) -> String {
    let Ok((s, _)) = read(path, None) else { return String::new() };
    if let Some(sum) = s.meta.get("summary").and_then(Value::as_str).filter(|x| !x.trim().is_empty()) {
        return short(sum);
    }
    items(&s)
        .into_iter()
        .find_map(|i| match i {
            ThreadItem::User { text, .. } if !text.trim().is_empty() && !text.trim_start().starts_with('/') => Some(short(&text)),
            _ => None,
        })
        .unwrap_or_default()
}

/// Gemini sessions of `cwd`, newest first.
pub fn sessions(home: &Path, cwd: &str) -> Vec<CandidateSession> {
    let mut files: Vec<(PathBuf, SystemTime)> = project_dirs(home, cwd).iter().flat_map(|d| session_files(d)).collect();
    files.sort_by_key(|e| std::cmp::Reverse(e.1));
    files
        .into_iter()
        .filter_map(|(p, t)| {
            let id = read_id(&p)?;
            Some(CandidateSession { id, cwd: cwd.to_string(), log_path: p.to_string_lossy().into_owned(), last_activity: millis(t) })
        })
        .collect()
}

/// The folder of each project with sessions, and the time of its newest session.
pub fn recent_cwds(home: &Path) -> Vec<(i64, String)> {
    project_roots(home)
        .into_iter()
        .filter_map(|(dir, root)| session_files(&dir).first().map(|(_, t)| (millis(*t), root)))
        .collect()
}
