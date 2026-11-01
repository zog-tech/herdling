//! Background shells and subagents in a Claude Code log.
//!
//! Signals, as Claude Code writes them:
//! - Start of a shell: the result of a `Bash` call has `toolUseResult.backgroundTaskId`. The
//!   result text says "Command running in background with ID: <id>" (`run_in_background`), or that
//!   the command "was moved to the background" (a timeout, the user, or a queued message).
//! - Start of a subagent: the result of an `Agent` call has `toolUseResult.status` "async_launched"
//!   and `toolUseResult.agentId`.
//! - End of either: a `<task-notification>` with `<task-id>` (status completed, failed, killed or
//!   stopped). It comes in a `queue-operation` line, a `queued_command` attachment, or a user line.
//! - End of a stopped shell: a successful `TaskStop` (older: `KillShell`, `KillBash`) result.
//!   A stopped shell often gets no notification.

use serde_json::Value;

use super::parse_ts;
use crate::transcript::background::{LineFeed, Pending, Task, TaskKind, Tracker};

/// Calls kept while they wait for their results.
const PENDING_CAP: usize = 256;

/// Tool names that stop a background task, and the input key with the task id.
const STOP_TOOLS: &[(&str, &str)] = &[("TaskStop", "task_id"), ("KillShell", "shell_id"), ("KillBash", "shell_id")];

/// Line state of one Claude log.
pub struct ClaudeFeed {
    /// `Bash` calls with no result yet: call id → command.
    commands: Pending<String>,
    /// `Agent` calls with no result yet: call id → description.
    agents: Pending<String>,
    /// Stop calls with no result yet: call id → task id.
    stops: Pending<String>,
}

impl Default for ClaudeFeed {
    fn default() -> Self {
        ClaudeFeed { commands: Pending::new(PENDING_CAP), agents: Pending::new(PENDING_CAP), stops: Pending::new(PENDING_CAP) }
    }
}

impl LineFeed for ClaudeFeed {
    fn feed(&mut self, tracker: &mut Tracker, line: &str) {
        // Most lines say nothing about background work. Skip them before the JSON parse.
        let interesting = line.contains("<task-notification>")
            || line.contains("\"tool_use\"")
            || line.contains("backgroundTaskId")
            || line.contains("async_launched")
            || (!self.stops.is_empty() && line.contains("\"tool_result\""))
            || (line.contains("\"tool_result\"") && line.contains("background"));
        if !interesting {
            return;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { return };
        for id in notified_ids(&v) {
            tracker.end(&id);
        }
        match v.get("type").and_then(Value::as_str) {
            Some("assistant") => self.calls(&v),
            Some("user") => self.results(&v, tracker),
            _ => {}
        }
    }
}

impl ClaudeFeed {
    fn calls(&mut self, v: &Value) {
        let Some(blocks) = v.pointer("/message/content").and_then(Value::as_array) else { return };
        for b in blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use")) {
            let (Some(id), Some(name)) = (b.get("id").and_then(Value::as_str), b.get("name").and_then(Value::as_str)) else {
                continue;
            };
            let input = b.get("input").unwrap_or(&Value::Null);
            let text = |k: &str| input.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            match name {
                "Bash" => self.commands.insert(id.to_string(), text("command")),
                "Agent" | "Task" => self.agents.insert(id.to_string(), text("description")),
                _ => {
                    if let Some((_, key)) = STOP_TOOLS.iter().find(|(n, _)| *n == name) {
                        let target = text(key);
                        if !target.is_empty() {
                            self.stops.insert(id.to_string(), target);
                        }
                    }
                }
            }
        }
    }

    fn results(&mut self, v: &Value, tracker: &mut Tracker) {
        let Some(blocks) = v.pointer("/message/content").and_then(Value::as_array) else { return };
        let blocks: Vec<&Value> =
            blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_result")).collect();
        let started = v.get("timestamp").and_then(Value::as_str).and_then(parse_ts);
        // `toolUseResult` describes one call. Use it only when the line holds one result.
        let extra = if blocks.len() == 1 { v.get("toolUseResult").filter(|t| t.is_object()) } else { None };
        for b in blocks {
            let Some(call) = b.get("tool_use_id").and_then(Value::as_str) else { continue };
            let failed = b.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            let command = self.commands.take(call);
            let description = self.agents.take(call);
            if let Some(target) = self.stops.take(call) {
                if !failed {
                    tracker.end(&target);
                }
                continue;
            }
            let field = |k: &str| extra.and_then(|t| t.get(k)).and_then(Value::as_str).filter(|s| !s.is_empty());
            if let Some(task) = field("backgroundTaskId") {
                tracker.start(Task { id: task.to_string(), kind: TaskKind::Shell, command, started });
                continue;
            }
            if field("status") == Some("async_launched") {
                if let Some(agent) = field("agentId") {
                    tracker.start(Task { id: agent.to_string(), kind: TaskKind::Subagent, command: description, started });
                }
                continue;
            }
            // No `toolUseResult` (several results on one line): read the id from the text.
            if extra.is_none() && command.is_some() && !failed {
                if let Some(task) = background_id(&result_text(b.get("content"))) {
                    tracker.start(Task { id: task, kind: TaskKind::Shell, command, started });
                }
            }
        }
    }
}

/// The text of a tool result: a string, or the text blocks of an array.
fn result_text(c: Option<&Value>) -> String {
    match c {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a.iter().filter_map(|b| b.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
        _ => String::new(),
    }
}

/// The task id in a background result text: "Command running in background with ID: <id>."
/// or "Command was moved to the background (ID: <id>) …". Only the first lines count: the
/// output of an ordinary command can hold the same words.
pub fn background_id(text: &str) -> Option<String> {
    let line = text.lines().take(3).find(|l| l.starts_with("Command ") && l.contains("background"))?;
    let i = line.find("ID: ")? + 4;
    let id: String = line[i..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    (!id.is_empty()).then_some(id)
}

/// The task ids of every `<task-notification>` in a line: in a `queue-operation` content, a
/// `queued_command` attachment prompt, or the text of a user line.
fn notified_ids(v: &Value) -> Vec<String> {
    let mut texts: Vec<&str> = Vec::new();
    match v.get("type").and_then(Value::as_str) {
        Some("queue-operation") => texts.extend(v.get("content").and_then(Value::as_str)),
        Some("attachment") => texts.extend(v.pointer("/attachment/prompt").and_then(Value::as_str)),
        Some("user") => match v.pointer("/message/content") {
            Some(Value::String(s)) => texts.push(s),
            Some(Value::Array(a)) => texts.extend(
                a.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("text")).filter_map(|b| b.get("text").and_then(Value::as_str)),
            ),
            _ => {}
        },
        _ => {}
    }
    let mut out = Vec::new();
    for t in texts {
        let mut rest = t;
        while let Some(i) = rest.find("<task-notification>") {
            rest = &rest[i + "<task-notification>".len()..];
            let end = rest.find("</task-notification>").unwrap_or(rest.len());
            let body = &rest[..end];
            if let Some(id) = tag(body, "task-id") {
                out.push(id.to_string());
            }
            rest = &rest[end..];
        }
    }
    out
}

fn tag<'a>(s: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let start = s.find(&open)? + open.len();
    let end = s[start..].find(&format!("</{name}>"))? + start;
    Some(s[start..end].trim()).filter(|t| !t.is_empty())
}
