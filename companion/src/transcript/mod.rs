//! Agent-neutral session transcripts. Find the session of a pane, read pages of thread items,
//! follow new items, and list recent sessions and folders, for every agent with an adapter.
//!
//! The agent kind routes `resolve` and the lists. The form of `log_path` routes pages and
//! follow: a Codex or Pi log path is a file under its sessions folder, an OpenCode log path
//! starts with [`opencode::SCHEME`], and every other path is a Claude log.

pub mod codex;
pub mod jsonl;
pub mod opencode;
pub mod pi;
pub mod procs;

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};

use crate::claude::{self, cap};
use crate::herdr::{Client, HerdrError};
use crate::types::{RecentSession, ThreadItem, ThreadPage, ThreadRef, ToolResult};

pub use procs::{host_procs, Proc, ProcList};

/// Agents with a transcript adapter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Agent {
    Claude,
    Codex,
    Pi,
    OpenCode,
}

/// herdr kinds of the agents with chat support. `hello` sends this list.
pub const KINDS: &[&str] = &["claude", "codex", "pi", "opencode"];

impl Agent {
    pub fn from_kind(kind: &str) -> Option<Agent> {
        match kind {
            "claude" => Some(Agent::Claude),
            "codex" => Some(Agent::Codex),
            "pi" => Some(Agent::Pi),
            "opencode" => Some(Agent::OpenCode),
            _ => None,
        }
    }

    /// Program names of the agent process.
    fn bins(self) -> &'static [&'static str] {
        match self {
            Agent::Claude => &["claude"],
            Agent::Codex => &["codex"],
            Agent::Pi => &["pi"],
            Agent::OpenCode => &["opencode"],
        }
    }

    /// The agent that wrote a log, from the form of its path.
    pub fn of_log(log: &str) -> Agent {
        if log.starts_with(opencode::SCHEME) {
            return Agent::OpenCode;
        }
        let p = log.replace('\\', "/");
        if p.contains("/.codex/sessions/") {
            Agent::Codex
        } else if p.contains("/.pi/agent/sessions/") {
            Agent::Pi
        } else {
            Agent::Claude
        }
    }
}

/// A session found in an agent store.
#[derive(Debug, Clone)]
pub struct CandidateSession {
    pub id: String,
    pub cwd: String,
    pub log_path: String,
    /// Unix ms.
    pub last_activity: i64,
}

/// Default page size in thread items.
pub const DEFAULT_LIMIT: usize = claude::DEFAULT_LIMIT;
/// Lines read to find the first prompt of a log.
pub(crate) const PROMPT_SCAN_LINES: usize = 200;
const PROMPT_CHARS: usize = 120;
const SUMMARY_CAP: usize = 80;
/// Without a known process start, a session counts as the pane's only with activity in this window.
const RECENT_WINDOW: Duration = Duration::from_secs(10 * 60);
/// A session written this long before the agent process start can still be its own.
const START_SLACK: Duration = Duration::from_secs(5);

pub(crate) fn mtime(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).ok()?.modified().ok()
}

pub(crate) fn millis(t: SystemTime) -> i64 {
    t.duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// Trimmed text cut to 120 chars, for a session list.
pub(crate) fn short(s: &str) -> String {
    s.trim().chars().take(PROMPT_CHARS).collect()
}

/// A tool result with its text capped at [`claude::RESULT_CAP`].
pub(crate) fn text_result(text: &str, ok: bool, ts: Option<i64>) -> ToolResult {
    let (text, truncated) = cap(text, claude::RESULT_CAP);
    ToolResult { ok, text, truncated, ts }
}

/// One-line summary of a tool call: the command, file, pattern, query or URL it works on.
pub fn tool_summary(name: &str, input: &Value) -> String {
    const KEYS: &[&str] = &[
        "command", "cmd", "file_path", "filePath", "path", "pattern", "query", "url", "description", "prompt",
    ];
    let first_line = |s: &str| s.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
    let found = KEYS.iter().find_map(|k| match input.get(*k) {
        Some(Value::String(s)) if !s.trim().is_empty() => Some(first_line(s)),
        // A command as argv: the last word holds the script (`bash -lc "<script>"`).
        Some(Value::Array(a)) => a.last().and_then(Value::as_str).map(first_line),
        _ => None,
    });
    let s = found.or_else(|| match input.get("input").and_then(Value::as_str) {
        Some(text) => Some(free_text_summary(name, text)),
        None => input.as_object().and_then(|o| o.values().find_map(Value::as_str)).map(first_line),
    });
    cap(&s.unwrap_or_default(), SUMMARY_CAP).0
}

/// Summary of a free-text tool input: the file of a patch, the command of a code-mode call,
/// else the first line.
fn free_text_summary(name: &str, text: &str) -> String {
    for prefix in ["*** Update File: ", "*** Add File: ", "*** Delete File: "] {
        if let Some(line) = text.lines().find_map(|l| l.strip_prefix(prefix)) {
            return line.trim().to_string();
        }
    }
    if name == "exec" {
        for key in ["\"cmd\":\"", "cmd:\"", "\"cmd\": \""] {
            if let Some(i) = text.find(key) {
                let rest = &text[i + key.len()..];
                let mut out = String::new();
                let mut esc = false;
                for c in rest.chars() {
                    match (esc, c) {
                        (true, 'n') => out.push(' '),
                        (true, c) => out.push(c),
                        (false, '\\') => {
                            esc = true;
                            continue;
                        }
                        (false, '"') => break,
                        (false, c) => out.push(c),
                    }
                    esc = false;
                }
                return out;
            }
        }
    }
    text.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string()
}

/// Read one page of items. `before` and the returned cursor are byte offsets, except for
/// OpenCode, where they are message `seq` values.
pub fn thread_get(log: &str, before: Option<u64>, limit: usize) -> io::Result<ThreadPage> {
    match Agent::of_log(log) {
        Agent::Claude => claude::thread_get(Path::new(log), before, limit),
        Agent::Codex => jsonl::page(Path::new(log), before, limit, &mut codex::Parser),
        Agent::Pi => pi::thread_get(Path::new(log), before, limit),
        Agent::OpenCode => opencode::thread_get(log, before, limit),
    }
}

/// A follower for any log.
pub enum Follower {
    Claude(claude::Follower),
    Codex(jsonl::Follower<codex::Parser>),
    Pi(jsonl::Follower<pi::Parser>),
    OpenCode(opencode::Follower),
}

impl Follower {
    /// A follower from `from` (the `end` of the last page). Fails when the log is missing.
    pub fn new(log: &str, from: u64) -> io::Result<Follower> {
        let agent = Agent::of_log(log);
        if agent != Agent::OpenCode && !Path::new(log).is_file() {
            return Err(io::Error::new(io::ErrorKind::NotFound, format!("no such log: {log}")));
        }
        Ok(match agent {
            Agent::Claude => Follower::Claude(claude::Follower::new(Path::new(log), from)),
            Agent::Codex => Follower::Codex(jsonl::Follower::new(Path::new(log), from, codex::Parser)),
            Agent::Pi => {
                // The leaf when the page was read: the last entry before `from`.
                let leaf = pi_leaf_before(Path::new(log), from);
                Follower::Pi(jsonl::Follower::new(Path::new(log), from, pi::Parser::for_follow(leaf)))
            }
            Agent::OpenCode => Follower::OpenCode(opencode::Follower::new(log, from)?),
        })
    }

    pub fn poll(&mut self) -> io::Result<Option<(Vec<ThreadItem>, u64)>> {
        match self {
            Follower::Claude(f) => f.poll(),
            Follower::Codex(f) => f.poll(),
            Follower::Pi(f) => f.poll(),
            Follower::OpenCode(f) => f.poll(),
        }
    }

    pub fn offset(&self) -> u64 {
        match self {
            Follower::Claude(f) => f.offset(),
            Follower::Codex(f) => f.offset(),
            Follower::Pi(f) => f.offset(),
            Follower::OpenCode(f) => f.offset(),
        }
    }

    /// A reason to end the stream, sent to the app as the follow error.
    pub fn ended(&self) -> Option<&'static str> {
        match self {
            Follower::Pi(f) => f.ended(),
            _ => None,
        }
    }
}

/// Id of the last tree entry that starts before byte `end`.
fn pi_leaf_before(path: &Path, end: u64) -> Option<String> {
    let f = std::fs::File::open(path).ok()?;
    let lines = crate::tail::read_offset_lines_before(f, Some(end), 50).ok()?;
    lines.into_iter().rev().find_map(|(_, l)| {
        let v: Value = serde_json::from_str(&l).ok()?;
        if v.get("type").and_then(Value::as_str) == Some("session") {
            return None;
        }
        v.get("id")?.as_str().map(String::from)
    })
}

/// Resolve a pane to its session. Agents without an adapter give `session: null`.
pub async fn resolve(socket: &Path, timeout: Duration, home: &Path, pane_id: &str) -> Result<ThreadRef, HerdrError> {
    resolve_with(socket, timeout, home, pane_id, host_procs).await
}

pub async fn resolve_with(
    socket: &Path,
    timeout: Duration,
    home: &Path,
    pane_id: &str,
    procs: ProcList,
) -> Result<ThreadRef, HerdrError> {
    // Claude panes resolve as before. For other kinds this call only reads the kind and cwd.
    let mut out = claude::resolve(socket, timeout, home, pane_id).await?;
    let agent = match Agent::from_kind(&out.kind) {
        Some(Agent::Claude) | None => return Ok(out),
        Some(a) => a,
    };
    let Some(cwd) = out.cwd.clone() else { return Ok(out) };
    // A failed process lookup is not fatal: the recent-activity rule applies.
    let info = match Client::connect(socket, timeout).await {
        Ok(mut c) => c.call("pane.process_info", json!({ "pane_id": pane_id })).await.unwrap_or(Value::Null),
        Err(_) => Value::Null,
    };
    let (fg, shell) = procs::pane_pids(info.get("process_info").unwrap_or(&info));
    let home = home.to_path_buf();
    let found = tokio::task::spawn_blocking(move || {
        let start = if fg.is_empty() && shell.is_none() { None } else { procs::agent_start(&procs(), &fg, shell, agent.bins()) };
        locate(&home, agent, &cwd, start, SystemTime::now())
    })
    .await
    .ok()
    .flatten();
    if let Some(s) = found {
        out.session = Some(s.id);
        out.log_path = Some(s.log_path);
    }
    Ok(out)
}

/// The session of an agent that runs in `cwd` and started at `start`: the most recent session
/// of that folder with activity since the start. With no start, activity in the last
/// [`RECENT_WINDOW`] counts.
pub fn locate(home: &Path, agent: Agent, cwd: &str, start: Option<SystemTime>, now: SystemTime) -> Option<CandidateSession> {
    let since = match start {
        Some(t) => t.checked_sub(START_SLACK).unwrap_or(t),
        None => now.checked_sub(RECENT_WINDOW).unwrap_or(now),
    };
    let since = millis(since);
    match agent {
        Agent::Claude => None,
        Agent::Codex => codex::logs(home).into_iter().take_while(|(_, t)| millis(*t) >= since).find_map(|(p, t)| {
            let (id, c) = codex::read_meta(&p)?;
            (c == cwd).then(|| CandidateSession { id, cwd: c, log_path: p.to_string_lossy().into_owned(), last_activity: millis(t) })
        }),
        Agent::Pi => pi_sessions(home, cwd).into_iter().find(|s| s.last_activity >= since),
        Agent::OpenCode => opencode::candidates(&opencode::db_path(home), Some(cwd), 1)
            .ok()?
            .into_iter()
            .find(|s| s.last_activity >= since),
    }
}

/// Pi sessions of `cwd`, newest first. A file whose header names another folder is left out.
fn pi_sessions(home: &Path, cwd: &str) -> Vec<CandidateSession> {
    let Ok(rd) = std::fs::read_dir(pi::project_dir(home, cwd)) else { return Vec::new() };
    let mut files: Vec<(PathBuf, SystemTime)> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|p| mtime(&p).map(|t| (p, t)))
        .collect();
    files.sort_by_key(|e| std::cmp::Reverse(e.1));
    files
        .into_iter()
        .filter_map(|(p, t)| {
            let (id, c) = pi::read_meta(&p)?;
            (c == cwd).then(|| CandidateSession { id, cwd: c, log_path: p.to_string_lossy().into_owned(), last_activity: millis(t) })
        })
        .collect()
}

/// Recent sessions of `kind` in `cwd`, newest first. The `session` field is what the agent's
/// resume flag takes.
pub fn recent_sessions(home: &Path, kind: &str, cwd: &str, limit: usize) -> Vec<RecentSession> {
    let to_recent = |s: CandidateSession, first_prompt: String| RecentSession {
        session: s.id,
        first_prompt,
        last_activity: s.last_activity,
        cwd: s.cwd,
    };
    match Agent::from_kind(kind) {
        Some(Agent::Claude) => claude::recent_sessions(home, cwd, limit),
        Some(Agent::Codex) => {
            let mut out = Vec::new();
            for (p, t) in codex::logs(home) {
                if out.len() >= limit {
                    break;
                }
                let Some((id, c)) = codex::read_meta(&p) else { continue };
                if c == cwd {
                    let s = CandidateSession { id, cwd: c, log_path: String::new(), last_activity: millis(t) };
                    out.push(to_recent(s, codex::first_prompt(&p)));
                }
            }
            out
        }
        Some(Agent::Pi) => pi_sessions(home, cwd)
            .into_iter()
            .take(limit)
            .map(|s| {
                let prompt = pi::first_prompt(Path::new(&s.log_path));
                to_recent(s, prompt)
            })
            .collect(),
        Some(Agent::OpenCode) => {
            let db = opencode::db_path(home);
            opencode::candidates(&db, Some(cwd), limit)
                .unwrap_or_default()
                .into_iter()
                .map(|s| {
                    let prompt = opencode::first_prompt(&db, &s.id);
                    to_recent(s, prompt)
                })
                .collect()
        }
        None => Vec::new(),
    }
}

/// Codex logs read for the folder list.
const CWD_SCAN: usize = 300;

/// The folders of recent sessions of every agent, newest first, without repeats.
pub fn recent_cwds(home: &Path, cap: usize) -> Vec<String> {
    let mut found: Vec<(i64, String)> =
        claude::recent_cwds_timed(home, cap).into_iter().map(|(t, c)| (millis(t), c)).collect();
    found.extend(codex::logs(home).into_iter().take(CWD_SCAN).filter_map(|(p, t)| Some((millis(t), codex::read_meta(&p)?.1))));
    if let Ok(rd) = std::fs::read_dir(pi::sessions_root(home)) {
        for dir in rd.filter_map(|e| e.ok()).map(|e| e.path()) {
            let newest = std::fs::read_dir(&dir)
                .into_iter()
                .flatten()
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
                .filter_map(|p| mtime(&p).map(|t| (p, t)))
                .max_by_key(|e| e.1);
            if let Some((p, t)) = newest {
                if let Some((_, c)) = pi::read_meta(&p) {
                    found.push((millis(t), c));
                }
            }
        }
    }
    let db = opencode::db_path(home);
    if db.is_file() {
        found.extend(opencode::candidates(&db, None, cap * 4).unwrap_or_default().into_iter().map(|s| (s.last_activity, s.cwd)));
    }
    found.sort_by_key(|e| std::cmp::Reverse(e.0));
    let mut seen = HashSet::new();
    found.into_iter().map(|(_, c)| c).filter(|c| !c.is_empty() && seen.insert(c.clone())).take(cap).collect()
}
