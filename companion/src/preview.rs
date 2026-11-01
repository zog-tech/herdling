//! `agents.preview`: one short line per agent for the app's Agent Board.
//!
//! Panes of agents with a transcript adapter are read from the end of their session log
//! (activity, last reply,
//! pending permission). Other agents fall back to the last useful line of the screen.
//! Claude Code panes also report the background shells and subagents that still run.

use std::collections::{HashMap, HashSet};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tokio::task::JoinSet;

use crate::claude;
use crate::claude::background::ClaudeFeed;
use crate::herdr::{self, HerdrError};
use crate::tail::read_offset_lines_before;
use crate::transcript::background::BackgroundLog;
use crate::types::{AgentPreview, BackgroundInfo, ThreadItem};

/// Bytes read from the end of a Claude log.
pub const TAIL_BYTES: u64 = 256 * 1024;
/// Most lines parsed from that tail.
const TAIL_LINES: usize = 400;
/// Longest preview line in chars.
pub const LINE_CAP: usize = 140;
/// Chars of a Bash command shown in "Running <cmd>".
const CMD_CAP: usize = 40;
/// Bound for one pane's work. A pane that takes longer is left out of the result.
pub const PANE_TIMEOUT: Duration = Duration::from_millis(1200);
/// How long a resolved log path is reused before `thread.resolve` runs again.
const RESOLVE_TTL: Duration = Duration::from_secs(15);

/// The last status of a pane and when it began (unix s), if known.
type StatusStart = (String, Option<i64>);
/// A resolved Claude log (None: the pane has none) and when it was resolved.
type ResolvedLog = (Option<PathBuf>, Instant);
/// The start of a pane's agent process (Unix ms, None: unknown) and when it was looked up.
type AgentStart = (Option<i64>, Instant);

/// State kept by one rpc process between `agents.preview` calls.
#[derive(Clone, Default)]
pub struct PreviewState {
    /// Per pane: the last status seen and when it began (unix s), if known.
    since: Arc<Mutex<HashMap<String, StatusStart>>>,
    /// Per pane: the resolved Claude log (None: not a Claude log) and when it was resolved.
    logs: Arc<Mutex<HashMap<String, ResolvedLog>>>,
    /// Per pane: the background tasks of its Claude log, read step by step.
    background: Arc<Mutex<HashMap<String, BackgroundLog<ClaudeFeed>>>>,
    /// Per pane: the start of its agent process, looked up only while background tasks run.
    starts: Arc<Mutex<HashMap<String, AgentStart>>>,
}

fn now_s() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

impl PreviewState {
    /// Records a `pane.agent_status_changed` event line: the status began now.
    /// Other event lines are ignored, except `pane_closed`, which forgets the pane.
    pub fn observe_event(&self, ev: &Value) {
        if let Some(pane) = crate::events::closed_pane_id(ev) {
            self.since.lock().unwrap().remove(pane);
            self.logs.lock().unwrap().remove(pane);
            self.background.lock().unwrap().remove(pane);
            self.starts.lock().unwrap().remove(pane);
            return;
        }
        if crate::events::event_name(ev).as_deref() != Some("pane_agent_status_changed") {
            return;
        }
        let Some(data) = ev.get("data") else { return };
        let (Some(pane), Some(status)) =
            (data.get("pane_id").and_then(Value::as_str), data.get("agent_status").and_then(Value::as_str))
        else {
            return;
        };
        self.observe_status(pane, status, Some(now_s()));
    }

    /// Records `status` for `pane`. A change sets the start to `at`; the same status keeps
    /// the start it has.
    fn observe_status(&self, pane: &str, status: &str, at: Option<i64>) {
        let mut g = self.since.lock().unwrap();
        match g.get_mut(pane) {
            Some((s, _)) if s == status => {}
            Some(entry) => *entry = (status.to_string(), at),
            None => {
                g.insert(pane.to_string(), (status.to_string(), at));
            }
        }
    }

    /// Start of the status seen in a snapshot. The first sighting of a pane has no known
    /// start; a change since the last call (an event was missed) starts now.
    pub fn status_since(&self, pane: &str, status: &str) -> Option<i64> {
        let known = self.since.lock().unwrap().contains_key(pane);
        self.observe_status(pane, status, known.then(now_s));
        self.since.lock().unwrap().get(pane).and_then(|(_, at)| *at)
    }

    fn cached_log(&self, pane: &str) -> Option<Option<PathBuf>> {
        let g = self.logs.lock().unwrap();
        g.get(pane).filter(|(_, at)| at.elapsed() < RESOLVE_TTL).map(|(p, _)| p.clone())
    }

    fn cache_log(&self, pane: &str, log: Option<PathBuf>) {
        self.logs.lock().unwrap().insert(pane.to_string(), (log, Instant::now()));
    }

    fn cached_start(&self, pane: &str) -> Option<Option<i64>> {
        let g = self.starts.lock().unwrap();
        g.get(pane).filter(|(_, at)| at.elapsed() < RESOLVE_TTL).map(|(s, _)| *s)
    }

    fn cache_start(&self, pane: &str, start: Option<i64>) {
        self.starts.lock().unwrap().insert(pane.to_string(), (start, Instant::now()));
    }

    /// Reads the new lines of the pane's log and returns its background state. A new log
    /// path (a new session) starts with no tasks. Blocks.
    fn update_background(&self, pane: &str, path: &Path) -> BackgroundLog<ClaudeFeed> {
        let old = self.background.lock().unwrap().remove(pane);
        let mut log = old.filter(|l| l.path() == path).unwrap_or_else(|| BackgroundLog::new(path));
        let _ = log.update();
        log
    }
}

/// What a Claude log says about the agent right now.
#[derive(Debug, Default, PartialEq)]
pub struct LogPreview {
    /// The tool call or thinking in progress, as a short phrase.
    pub activity: Option<String>,
    /// The last assistant text, one line.
    pub last_reply: Option<String>,
    /// The pending tool call phrased as a permission question.
    pub question: Option<String>,
}

/// Reads the last [`TAIL_BYTES`] of a Claude log and summarizes them.
pub fn read_log(path: &Path) -> io::Result<LogPreview> {
    let mut f = std::fs::File::open(path)?;
    let len = f.seek(SeekFrom::End(0))?;
    let start = len.saturating_sub(TAIL_BYTES);
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    f.take(TAIL_BYTES).read_to_end(&mut buf)?;
    if start > 0 {
        // The first line is cut off. Drop it.
        match buf.iter().position(|c| *c == b'\n') {
            Some(i) => {
                buf.drain(..=i);
            }
            None => return Ok(LogPreview::default()),
        }
    }
    let lines = read_offset_lines_before(io::Cursor::new(buf), None, TAIL_LINES)?;
    Ok(log_preview(lines.iter().map(|(_, l)| l.as_str())))
}

/// Items read from the end of a non-Claude log for a preview.
const PREVIEW_ITEMS: usize = 80;

/// A preview of any agent log. Claude logs use [`read_log`]; other logs use their last items.
pub fn read_any_log(path: &Path) -> io::Result<LogPreview> {
    let log = path.to_string_lossy();
    if crate::transcript::Agent::of_log(&log) == crate::transcript::Agent::Claude {
        return read_log(path);
    }
    let page = crate::transcript::thread_get(&log, None, PREVIEW_ITEMS)?;
    Ok(items_preview(&page.items))
}

/// Summarizes assembled items (oldest first). A tool item with no result is pending.
pub fn items_preview(items: &[ThreadItem]) -> LogPreview {
    let done: HashSet<String> = items
        .iter()
        .filter_map(|i| match i {
            ThreadItem::Tool { id, result: Some(_), .. } => Some(id.clone()),
            _ => None,
        })
        .collect();
    summarize(items.to_vec(), &done)
}

/// Summarizes log lines (oldest first). A line still being written is not valid JSON
/// and gives nothing.
pub fn log_preview<'a>(lines: impl IntoIterator<Item = &'a str>) -> LogPreview {
    let mut items: Vec<ThreadItem> = Vec::new();
    let mut done: HashSet<String> = HashSet::new();
    for line in lines {
        done.extend(claude::parse_results(line).into_iter().map(|(id, _)| id));
        items.extend(claude::parse_line(line));
    }
    summarize(items, &done)
}

fn summarize(items: Vec<ThreadItem>, done: &HashSet<String>) -> LogPreview {
    let last_reply = items.iter().rev().find_map(|i| match i {
        ThreadItem::Assistant { markdown, .. } => Some(one_line(&strip_markdown(markdown))),
        _ => None,
    });
    let last_reply = last_reply.filter(|s| !s.is_empty());

    // The current turn: items after the last user prompt.
    let turn_start = items.iter().rposition(|i| matches!(i, ThreadItem::User { .. })).map_or(0, |i| i + 1);
    let turn = &items[turn_start..];
    let pending: Vec<&ThreadItem> = turn
        .iter()
        .filter(|i| match i {
            ThreadItem::Tool { id, .. } | ThreadItem::Subagent { id, .. } => !done.contains(id),
            _ => false,
        })
        .collect();
    let (activity, question) = match pending.last() {
        Some(last) => (Some(activity_of(last, &pending)), question_of(last)),
        None => match turn.last() {
            Some(ThreadItem::Thinking { .. }) => (Some("Thinking".to_string()), None),
            _ => (None, None),
        },
    };
    LogPreview { activity, last_reply, question }
}

fn input_str<'a>(input: &'a Value, key: &str) -> &'a str {
    input.get(key).and_then(Value::as_str).unwrap_or("")
}

fn basename(path: &str) -> &str {
    path.rsplit('/').find(|s| !s.is_empty()).unwrap_or(path)
}

/// Short name of a tool: `mcp__server__do_thing` becomes `do_thing`.
fn tool_label(name: &str) -> &str {
    if name.starts_with("mcp__") {
        name.rsplit("__").next().unwrap_or(name)
    } else {
        name
    }
}

/// "Running pnpm test", "Editing auth.ts", "Reading 3 files", …
fn activity_of(item: &ThreadItem, pending: &[&ThreadItem]) -> String {
    let ThreadItem::Tool { name, input, .. } = item else { return "Running a subagent".into() };
    let s = match name.as_str() {
        "Bash" => format!("Running {}", cap_chars(&one_line(input_str(input, "command")), CMD_CAP)),
        // Lower-case names: Codex, Pi, omp, OpenCode and Gemini CLI.
        "bash" | "shell" | "exec_command" | "exec" | "python" | "run_shell_command" => {
            format!("Running {}", cap_chars(&one_line(&crate::transcript::tool_summary(name, input)), CMD_CAP))
        }
        "edit" | "write" | "apply_patch" | "multiedit" | "replace" | "write_file" => {
            format!("Editing {}", basename(&crate::transcript::tool_summary(name, input)))
        }
        "read" | "read_file" => format!("Reading {}", basename(&crate::transcript::tool_summary(name, input))),
        "read_many_files" => "Reading files".into(),
        "grep" | "glob" | "find" | "ls" | "search_file_content" | "list_directory" => "Searching".into(),
        "webfetch" | "websearch" | "web_search" | "web_fetch" | "google_web_search" => "Browsing".into(),
        "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => {
            let path = [input_str(input, "file_path"), input_str(input, "notebook_path")].into_iter().find(|p| !p.is_empty());
            format!("Editing {}", basename(path.unwrap_or("")))
        }
        "Read" => {
            let reads = pending.iter().filter(|i| matches!(i, ThreadItem::Tool { name, .. } if name == "Read")).count();
            if reads > 1 {
                format!("Reading {reads} files")
            } else {
                format!("Reading {}", basename(input_str(input, "file_path")))
            }
        }
        "Grep" | "Glob" => "Searching".into(),
        "WebFetch" | "WebSearch" => "Browsing".into(),
        other => format!("Using {}", tool_label(other)),
    };
    cap_chars(s.trim(), LINE_CAP)
}

/// The pending call as the question Claude asks before running it.
fn question_of(item: &ThreadItem) -> Option<String> {
    let ThreadItem::Tool { name, input, .. } = item else { return None };
    let q = match name.as_str() {
        "Bash" => format!("Allow {}?", cap_chars(&one_line(input_str(input, "command")), LINE_CAP - 7)),
        "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => {
            let path = [input_str(input, "file_path"), input_str(input, "notebook_path")].into_iter().find(|p| !p.is_empty());
            format!("Allow edit to {}?", basename(path.unwrap_or("")))
        }
        "WebFetch" => format!("Allow fetch of {}?", input_str(input, "url")),
        "bash" | "shell" | "exec_command" | "exec" | "run_shell_command" => {
            format!("Allow {}?", cap_chars(&one_line(&crate::transcript::tool_summary(name, input)), LINE_CAP - 7))
        }
        "edit" | "write" | "apply_patch" | "replace" | "write_file" => {
            format!("Allow edit to {}?", basename(&crate::transcript::tool_summary(name, input)))
        }
        other => format!("Allow {}?", tool_label(other)),
    };
    Some(cap_chars(&q, LINE_CAP))
}

/// Markdown reduced to its text: no fences, headings, quotes, list markers, emphasis or link targets.
pub fn strip_markdown(md: &str) -> String {
    let mut out = Vec::new();
    let mut in_fence = false;
    for line in md.lines() {
        let t = line.trim();
        // Code blocks say little in one line: drop them whole.
        if t.starts_with("```") || t.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        if t.chars().all(|c| matches!(c, '-' | '*' | '_' | '|' | ':' | ' ')) && t.len() >= 3 {
            continue;
        }
        let t = t.trim_start_matches('#').trim_start_matches('>').trim_start();
        let t = strip_list_marker(t);
        out.push(strip_inline(t));
    }
    out.join("\n")
}

fn strip_list_marker(t: &str) -> &str {
    for m in ["- [ ] ", "- [x] ", "- ", "* ", "+ "] {
        if let Some(rest) = t.strip_prefix(m) {
            return rest;
        }
    }
    let digits = t.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 {
        if let Some(rest) = t[digits..].strip_prefix(". ").or_else(|| t[digits..].strip_prefix(") ")) {
            return rest;
        }
    }
    t
}

/// Inline markdown to text: `[text](url)` keeps the text; `**`, `__`, `*`, `` ` `` and `~~` go.
fn strip_inline(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '!' if chars.get(i + 1) == Some(&'[') => i += 1,
            '[' => {
                // A link: keep the text, skip the target.
                if let Some(close) = chars[i..].iter().position(|&x| x == ']').map(|p| p + i) {
                    if chars.get(close + 1) == Some(&'(') {
                        if let Some(end) = chars[close..].iter().position(|&x| x == ')').map(|p| p + close) {
                            out.extend(&chars[i + 1..close]);
                            i = end + 1;
                            continue;
                        }
                    }
                }
                out.push(c);
                i += 1;
            }
            '*' | '`' => i += 1,
            '_' if chars.get(i + 1) == Some(&'_') => i += 2,
            '~' if chars.get(i + 1) == Some(&'~') => i += 2,
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

/// All whitespace runs as one space, trimmed, capped at [`LINE_CAP`] chars.
pub fn one_line(s: &str) -> String {
    let joined = s.split_whitespace().collect::<Vec<_>>().join(" ");
    cap_chars(&joined, LINE_CAP)
}

/// `s` cut to at most `max` chars; a cut line ends with "…" (counted in `max`).
fn cap_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut t: String = s.chars().take(max.saturating_sub(1)).collect();
    t.truncate(t.trim_end().len());
    t.push('…');
    t
}

/// Last line of agent output on a screen. The input box at the bottom (a block framed by
/// box drawing, or a bare prompt line) and everything below it are cut off; footer hints,
/// spinners, echoed prompts and lines without a letter or digit are skipped.
pub fn screen_line(text: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    let end = input_box_start(&lines);
    lines[..end].iter().rev().find_map(|l| output_line(l))
}

/// For a blocked agent: the last line that asks something (ends with "?") among the last
/// [`QUESTION_SCAN`] useful lines, else the last useful line. The bottom box is kept: a
/// permission dialog is drawn there.
pub fn screen_question(text: &str) -> Option<String> {
    let useful: Vec<String> = text.lines().rev().filter_map(output_line).take(QUESTION_SCAN).collect();
    useful.iter().find(|l| l.ends_with('?')).or(useful.first()).cloned()
}

/// Useful lines looked at for a question.
const QUESTION_SCAN: usize = 15;
/// Lines at the bottom of a screen searched for the input box.
const INPUT_REGION: usize = 12;
/// Footer and status hints of agent TUIs, lowercase. A line that contains one is chrome.
const FOOTER_HINTS: &[&str] = &[
    "⏎", "⌃", "for shortcuts", "esc to interrupt", "esc to cancel", "ctrl+", "context left",
    "shift+tab", "accept edits", "bypass permissions", "plan mode", "auto-accept", "to cycle",
    "enter to send", "for newline",
];
/// Markers that start an input line (or an echoed user prompt).
const PROMPT_MARKERS: &[&str] = &["❯", "›", ">", "$", "%"];
/// Markers that start an agent output line; removed from the result.
const OUTPUT_MARKERS: &[&str] = &["•", "⏺", "●", "✦", "⎿", "◆", "✻"];

/// Text of a line with box drawing, block and spinner characters blanked, trimmed.
fn strip_chrome(raw: &str) -> String {
    raw.chars().map(|c| if is_chrome(c) { ' ' } else { c }).collect::<String>().trim().to_string()
}

/// A full-width rule: many box-drawing dashes and no text.
fn is_rule(raw: &str) -> bool {
    raw.chars().filter(|c| matches!(c, '─' | '━' | '═')).count() >= 8 && !raw.chars().any(char::is_alphanumeric)
}

fn starts_with_prompt(t: &str) -> bool {
    PROMPT_MARKERS.iter().any(|p| t.starts_with(p))
}

/// Index where the input box at the bottom starts, or `lines.len()` when there is none.
/// The box is the last rounded box (`╭`), the upper of two close rules, or a bare prompt line.
fn input_box_start(lines: &[&str]) -> usize {
    let region = lines.len().saturating_sub(INPUT_REGION);
    let mut start = lines.len();
    if let Some(i) = (region..lines.len()).rev().find(|&i| lines[i].trim_start().starts_with('╭')) {
        start = start.min(i);
    }
    let rules: Vec<usize> = (region..lines.len()).filter(|&i| is_rule(lines[i])).collect();
    if let [.., upper, lower] = rules[..] {
        if lower - upper <= 5 {
            start = start.min(upper);
        }
    }
    // A bare prompt line with only blank lines or hints below it.
    for i in (region..start).rev() {
        let t = strip_chrome(lines[i]);
        if starts_with_prompt(&t) {
            start = i;
            break;
        }
        if output_line(lines[i]).is_some() {
            break;
        }
    }
    start
}

/// The text of one line of agent output, or None for chrome.
fn output_line(raw: &str) -> Option<String> {
    let t = strip_chrome(raw);
    if starts_with_prompt(&t) {
        return None;
    }
    let lower = t.to_lowercase();
    if FOOTER_HINTS.iter().any(|h| lower.contains(h)) || lower.starts_with("using:") {
        return None;
    }
    let mut t = t.as_str();
    for m in OUTPUT_MARKERS {
        t = t.strip_prefix(m).unwrap_or(t).trim_start();
    }
    if !t.chars().any(char::is_alphanumeric) {
        return None;
    }
    Some(one_line(t))
}

/// Box drawing, block elements and braille spinner characters.
fn is_chrome(c: char) -> bool {
    matches!(c as u32, 0x2500..=0x259F | 0x2800..=0x28FF)
}

/// One agent of `session.snapshot`.
struct Agent {
    pane_id: String,
    kind: String,
    status: String,
}

fn snapshot_agents(snap: &Value) -> Vec<Agent> {
    let s = snap.get("snapshot").unwrap_or(snap);
    let Some(list) = s.get("agents").and_then(Value::as_array) else { return vec![] };
    list.iter()
        .filter_map(|a| {
            Some(Agent {
                pane_id: a.get("pane_id")?.as_str()?.to_string(),
                kind: a.get("agent").and_then(Value::as_str).unwrap_or("unknown").to_string(),
                status: a.get("agent_status").and_then(Value::as_str).unwrap_or("unknown").to_string(),
            })
        })
        .collect()
}

/// Previews of the agents in herdr's snapshot (only `pane_ids` when given). Panes whose
/// work fails or takes longer than `pane_timeout` are left out. Only a failed snapshot is an error.
pub async fn previews(
    socket: &Path,
    timeout: Duration,
    home: &Path,
    state: &PreviewState,
    pane_ids: Option<Vec<String>>,
    pane_timeout: Duration,
) -> Result<Vec<AgentPreview>, HerdrError> {
    let snap = herdr::Client::connect(socket, timeout).await?.call("session.snapshot", json!({})).await?;
    let wanted: Option<HashSet<String>> = pane_ids.map(|v| v.into_iter().collect());
    let agents: Vec<Agent> =
        snapshot_agents(&snap).into_iter().filter(|a| wanted.as_ref().is_none_or(|w| w.contains(&a.pane_id))).collect();

    let mut set = JoinSet::new();
    for (order, a) in agents.into_iter().enumerate() {
        let since = state.status_since(&a.pane_id, &a.status);
        let (socket, home, state) = (socket.to_path_buf(), home.to_path_buf(), state.clone());
        set.spawn(async move {
            let work = one_pane(&socket, timeout, &home, &state, &a);
            let got = tokio::time::timeout(pane_timeout, work).await.ok().flatten();
            got.map(|mut p| {
                p.status_since = since;
                (order, p)
            })
        });
    }
    let mut out = Vec::new();
    while let Some(r) = set.join_next().await {
        if let Ok(Some(p)) = r {
            out.push(p);
        }
    }
    out.sort_by_key(|(order, _)| *order);
    Ok(out.into_iter().map(|(_, p)| p).collect())
}

/// One pane's preview: from its Claude log when there is one, else from its screen.
async fn one_pane(socket: &Path, timeout: Duration, home: &Path, state: &PreviewState, a: &Agent) -> Option<AgentPreview> {
    let mut p = AgentPreview {
        pane_id: a.pane_id.clone(),
        activity: None,
        last_reply: None,
        question: None,
        status_since: None,
        source: "screen".into(),
        background: None,
    };
    if crate::transcript::Agent::from_kind(&a.kind).is_some() {
        let log = match state.cached_log(&a.pane_id) {
            Some(l) => l,
            None => {
                let r = crate::transcript::resolve(socket, timeout, home, &a.pane_id).await.ok()?;
                let l = r.log_path.map(PathBuf::from);
                state.cache_log(&a.pane_id, l.clone());
                l
            }
        };
        if let Some(path) = log {
            if crate::transcript::Agent::of_log(&path.to_string_lossy()) == crate::transcript::Agent::Claude {
                p.background = claude_background(socket, timeout, state, &a.pane_id, &path).await;
            }
            if let Ok(Ok(lp)) = tokio::task::spawn_blocking(move || read_any_log(&path)).await {
                p.source = "log".into();
                p.last_reply = lp.last_reply;
                match a.status.as_str() {
                    "working" => p.activity = lp.activity,
                    "blocked" => p.question = lp.question,
                    _ => {}
                }
                // A blocked agent whose log shows no pending call: ask the screen.
                if a.status == "blocked" && p.question.is_none() {
                    p.question = read_screen_line(socket, timeout, &a.pane_id, true).await;
                }
                return Some(p);
            }
        }
    }
    let line = read_screen_line(socket, timeout, &a.pane_id, a.status == "blocked").await?;
    match a.status.as_str() {
        "working" => p.activity = Some(line),
        "blocked" => p.question = Some(line),
        _ => p.last_reply = Some(line),
    }
    Some(p)
}

/// The background shells and subagents of a Claude log that still run. When some are
/// recorded, the start of the agent process is checked: tasks from before a restart have ended.
async fn claude_background(socket: &Path, timeout: Duration, state: &PreviewState, pane: &str, path: &Path) -> Option<BackgroundInfo> {
    let (st, pane_id, log_path) = (state.clone(), pane.to_string(), path.to_path_buf());
    // The state goes back into the map in the blocking task, so a pane timeout does not lose it.
    let tracker = tokio::task::spawn_blocking(move || {
        let log = st.update_background(&pane_id, &log_path);
        let tracker = log.tracker.clone();
        st.background.lock().unwrap().insert(pane_id, log);
        tracker
    })
    .await
    .ok()?;
    if tracker.is_empty() {
        return None;
    }
    let start = match state.cached_start(pane) {
        Some(s) => s,
        None => {
            let s = agent_start_ms(socket, timeout, pane).await;
            state.cache_start(pane, s);
            s
        }
    };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
    tracker.info(now, start)
}

/// Start of the Claude process in the pane, in Unix ms. None when herdr or the process list
/// does not tell.
async fn agent_start_ms(socket: &Path, timeout: Duration, pane: &str) -> Option<i64> {
    let mut c = herdr::Client::connect(socket, timeout).await.ok()?;
    let info = c.call("pane.process_info", json!({ "pane_id": pane })).await.ok()?;
    let (fg, shell) = crate::transcript::procs::pane_pids(info.get("process_info").unwrap_or(&info));
    if fg.is_empty() && shell.is_none() {
        return None;
    }
    let bins = crate::transcript::Agent::Claude.bins();
    let start = tokio::task::spawn_blocking(move || {
        crate::transcript::procs::agent_start(&crate::transcript::host_procs(), &fg, shell, bins)
    })
    .await
    .ok()??;
    Some(start.duration_since(UNIX_EPOCH).ok()?.as_millis() as i64)
}

async fn read_screen_line(socket: &Path, timeout: Duration, pane: &str, blocked: bool) -> Option<String> {
    let mut c = herdr::Client::connect(socket, timeout).await.ok()?;
    let r = c
        .call("pane.read", json!({ "pane_id": pane, "source": "visible", "format": "text", "strip_ansi": true }))
        .await
        .ok()?;
    let text = r.get("read").and_then(|x| x.get("text")).and_then(Value::as_str)?;
    if blocked {
        screen_question(text)
    } else {
        screen_line(text)
    }
}
