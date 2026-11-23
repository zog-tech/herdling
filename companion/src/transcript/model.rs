//! The model an agent uses now, from its transcript. The newest model signal in the log wins:
//!
//! - Claude Code: `message.model` of a main-chain assistant line, or the output of `/model`
//!   ("Set model to `Opus 5.5` …"), so a switch shows before the next reply. Sidechain lines
//!   (subagents) and synthetic values such as `<synthetic>` do not count.
//! - Codex: `payload.model` of a `turn_context` line.
//! - Pi and omp: `modelId` of a `model_change` entry, or `message.model` of an assistant message.
//! - Gemini CLI: `model` of a `gemini` message (JSON lines files only).
//! - OpenCode: `model.id` of the newest assistant row.
//!
//! The value is the id the agent wrote (`claude-opus-5-5`, `gpt-5.5`), or the display name of a
//! `/model` switch (`Opus 5.5`). The scans read backward from the end in bounded steps and stop at
//! the first signal, so a large log costs only its last lines.

use std::fs::File;
use std::path::Path;

use serde_json::Value;

use super::{opencode, Agent};
use crate::tail::read_offset_lines_before;

/// Most bytes a scan reads back before it gives up.
pub const SCAN_CAP: u64 = 4 << 20;
/// Lines read per backward step.
const STEP_LINES: usize = 64;
/// Longest model value kept, in chars.
const MODEL_CAP: usize = 80;

/// The model signal of one log line, or `None` when the line has none.
pub fn line_model(agent: Agent, line: &str) -> Option<String> {
    // Most lines have no model. Skip them before the JSON parse.
    let cheap = match agent {
        Agent::Claude => line.contains("\"model\"") || line.contains("model "),
        Agent::Pi | Agent::Omp => line.contains("\"model") || line.contains("modelId"),
        Agent::Codex | Agent::Gemini => line.contains("\"model\""),
        Agent::OpenCode => false,
    };
    if !cheap {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let t = v.get("type").and_then(Value::as_str).unwrap_or("");
    let raw = match agent {
        Agent::Claude => {
            if v.get("isSidechain").and_then(Value::as_bool) == Some(true) {
                return None;
            }
            match t {
                "assistant" => v.pointer("/message/model").and_then(Value::as_str).map(String::from),
                "user" => switch_text(v.pointer("/message/content")?).and_then(|s| switched_model(&s)),
                _ => None,
            }
        }
        Agent::Codex => (t == "turn_context").then(|| v.pointer("/payload/model")?.as_str().map(String::from)).flatten(),
        Agent::Pi | Agent::Omp => match t {
            "model_change" => v.get("modelId").and_then(Value::as_str).map(String::from),
            "message" if v.pointer("/message/role").and_then(Value::as_str) == Some("assistant") => {
                v.pointer("/message/model").and_then(Value::as_str).map(String::from)
            }
            _ => None,
        },
        Agent::Gemini => (t == "gemini").then(|| v.get("model")?.as_str().map(String::from)).flatten(),
        Agent::OpenCode => None,
    };
    clean(raw?)
}

/// A usable model value: trimmed, not empty, not a placeholder such as `<synthetic>`.
fn clean(s: String) -> Option<String> {
    let s = s.trim();
    if s.is_empty() || s.starts_with('<') {
        return None;
    }
    Some(s.chars().take(MODEL_CAP).collect())
}

/// The text of a user line that holds `/model` output.
fn switch_text(content: &Value) -> Option<String> {
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks.iter().filter_map(|b| b.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
        _ => return None,
    };
    text.trim_start().starts_with("<local-command-stdout>").then_some(text)
}

/// The model of `/model` output: "Set model to `Opus 5.5` and saved …" or "Kept model as `Opus 5.5`".
/// Older Claude Code versions print the name without backticks, sometimes with ANSI codes and the id
/// in parentheses ("Set model to Opus 4.5 (claude-opus-4-5)"). An id in parentheses wins.
pub fn switched_model(text: &str) -> Option<String> {
    let text = strip_ansi(text);
    let rest = ["Set model to ", "Kept model as "].iter().find_map(|p| text.find(p).map(|i| &text[i + p.len()..]))?;
    let rest = rest.split("</local-command-stdout>").next().unwrap_or(rest).trim();
    let name = if let Some(r) = rest.strip_prefix('`') {
        r.split('`').next().unwrap_or("")
    } else {
        let end = [" and ", "\n"].iter().filter_map(|s| rest.find(s)).min().unwrap_or(rest.len());
        &rest[..end]
    };
    let name = name.trim().trim_end_matches('.');
    if let (Some(a), Some(b)) = (name.find('('), name.rfind(')')) {
        let inner = name[a + 1..b].trim();
        if inner.starts_with("claude-") {
            return clean(inner.to_string());
        }
    }
    clean(name.to_string())
}

/// `s` without ANSI escape sequences (`ESC [ … letter`).
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for d in chars.by_ref() {
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// The newest model signal in the lines of `path` that start in `[from, to)`. Reads backward from
/// `to` and stops at the first signal, at `from`, or after [`SCAN_CAP`] bytes.
pub fn latest_between(path: &Path, agent: Agent, from: u64, to: u64) -> Option<String> {
    let mut f = File::open(path).ok()?;
    let floor = from.max(to.saturating_sub(SCAN_CAP));
    let mut cur = to;
    while cur > floor {
        let lines = read_offset_lines_before(&mut f, Some(cur), STEP_LINES).ok()?;
        let first = lines.first()?.0;
        for (off, line) in lines.iter().rev() {
            if *off < floor {
                return None;
            }
            if let Some(m) = line_model(agent, line) {
                return Some(m);
            }
        }
        if first >= cur {
            break;
        }
        cur = first;
    }
    None
}

/// The model of the session in `log`. `None` when the log shows none (yet).
pub fn current(log: &str) -> Option<String> {
    match Agent::of_log(log) {
        Agent::OpenCode => opencode_model(log),
        agent => {
            let len = std::fs::metadata(log).ok()?.len();
            latest_between(Path::new(log), agent, 0, len)
        }
    }
}

/// `model.id` of the newest assistant row of an OpenCode session.
fn opencode_model(log: &str) -> Option<String> {
    let (db, session) = opencode::parse_log_path(log)?;
    let c = opencode::open(&db).ok()?;
    let data: String = c
        .query_row(
            "SELECT data FROM session_message WHERE session_id = ?1 AND type = 'assistant' ORDER BY seq DESC LIMIT 1",
            rusqlite::params![session],
            |r| r.get(0),
        )
        .ok()?;
    let v: Value = serde_json::from_str(&data).ok()?;
    clean(v.pointer("/model/id").and_then(Value::as_str)?.to_string())
}

/// Tracks the model while `thread.follow` reads a log. `poll` reads only the bytes that the
/// follower read since the last call (OpenCode: one indexed query) and returns the model when it
/// differs from the last one it returned.
pub struct ModelWatch {
    log: String,
    agent: Agent,
    offset: u64,
    last: Option<String>,
}

impl ModelWatch {
    /// A watch from `from`, the follow start. The first signal after it is always returned.
    pub fn new(log: &str, from: u64) -> ModelWatch {
        ModelWatch { log: log.to_string(), agent: Agent::of_log(log), offset: from, last: None }
    }

    /// Call after a follower poll that read up to `offset`. Returns a new model, else `None`.
    pub fn poll(&mut self, offset: u64) -> Option<String> {
        let found = match self.agent {
            Agent::OpenCode => opencode_model(&self.log),
            agent => {
                if offset < self.offset {
                    // The log was replaced by a shorter one.
                    self.offset = offset;
                }
                let m = (offset > self.offset).then(|| latest_between(Path::new(&self.log), agent, self.offset, offset)).flatten();
                self.offset = offset;
                m
            }
        }?;
        if self.last.as_deref() == Some(found.as_str()) {
            return None;
        }
        self.last = Some(found.clone());
        Some(found)
    }
}
