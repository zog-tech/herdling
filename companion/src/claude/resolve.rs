//! Find the Claude session behind a herdr pane, and list recent sessions.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};

use super::parse_line;
use crate::herdr::{Client, HerdrError};
use crate::types::{RecentSession, ThreadItem, ThreadRef};

/// A log file counts as live for the no-PID-file fallback if written within this window.
const RECENT_WINDOW: Duration = Duration::from_secs(10 * 60);
/// First-prompt scan limit in lines.
const PROMPT_SCAN_LINES: usize = 200;
const PROMPT_CHARS: usize = 120;

/// `home/.claude/projects/<cwd with every char not [A-Za-z0-9] replaced by '-'>`.
pub fn project_dir(home: &Path, cwd: &str) -> PathBuf {
    let name: String = cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    home.join(".claude").join("projects").join(name)
}

/// Resolve a pane to its Claude session. Non-Claude panes give `session: null`.
pub async fn resolve(
    socket: &Path,
    timeout: Duration,
    home: &Path,
    pane_id: &str,
) -> Result<ThreadRef, HerdrError> {
    resolve_with(socket, timeout, home, pane_id, process_table).await
}

/// Source of `(pid, ppid)` pairs. Tests inject a fixed table.
pub type ProcessTable = fn() -> Option<Vec<(u32, u32)>>;

pub async fn resolve_with(
    socket: &Path,
    timeout: Duration,
    home: &Path,
    pane_id: &str,
    table: ProcessTable,
) -> Result<ThreadRef, HerdrError> {
    let mut c = Client::connect(socket, timeout).await?;
    let got = c.call("agent.get", json!({ "target": pane_id })).await?;
    let agent = got.get("agent").unwrap_or(&got);
    let kind = agent.get("agent").and_then(Value::as_str).unwrap_or("unknown").to_string();
    let cwd = agent.get("cwd").and_then(Value::as_str).map(String::from);
    let mut out = ThreadRef { kind, session: None, log_path: None, cwd: cwd.clone() };
    let Some(cwd) = cwd.filter(|_| out.kind == "claude") else { return Ok(out) };

    // A failed process lookup is not fatal: the recent-file fallback still applies.
    let info = c.call("pane.process_info", json!({ "pane_id": pane_id })).await.unwrap_or(Value::Null);
    let (direct, roots) = pane_pids(info.get("process_info").unwrap_or(&info));
    let home = home.to_path_buf();
    let resolved = tokio::task::spawn_blocking(move || locate(&home, &cwd, &direct, &roots, table)).await.ok().flatten();
    if let Some((session, log)) = resolved {
        out.session = Some(session);
        out.log_path = Some(log.to_string_lossy().into_owned());
    }
    Ok(out)
}

/// Candidate PIDs to test directly (foreground processes first), and the roots whose
/// descendants are searched when no direct PID has a session file.
fn pane_pids(info: &Value) -> (Vec<u32>, Vec<u32>) {
    let pid = |v: Option<&Value>| v.and_then(Value::as_u64).map(|n| n as u32);
    let mut direct: Vec<u32> = info
        .get("foreground_processes")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|p| pid(p.get("pid"))).collect())
        .unwrap_or_default();
    // Claude is usually the foreground process; try the newest-looking group leader first.
    if let Some(g) = pid(info.get("foreground_process_group_id")) {
        direct.insert(0, g);
    }
    let mut roots = direct.clone();
    if let Some(s) = pid(info.get("shell_pid")) {
        direct.push(s);
        roots.insert(0, s);
    }
    (dedup(direct), dedup(roots))
}

fn dedup(v: Vec<u32>) -> Vec<u32> {
    let mut seen = HashSet::new();
    v.into_iter().filter(|p| seen.insert(*p)).collect()
}

struct SessionFile {
    id: String,
    cwd: Option<String>,
}

fn read_session_file(home: &Path, pid: u32) -> Option<SessionFile> {
    let text = std::fs::read_to_string(home.join(".claude/sessions").join(format!("{pid}.json"))).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    let id = v.get("sessionId")?.as_str()?.to_string();
    if id.is_empty() || id.contains(['/', '\\']) || id.contains("..") {
        return None;
    }
    Some(SessionFile { id, cwd: v.get("cwd").and_then(Value::as_str).map(String::from) })
}

/// Session id and log path for a pane: PID files first, then the newest recent log.
fn locate(home: &Path, cwd: &str, direct: &[u32], roots: &[u32], table: ProcessTable) -> Option<(String, PathBuf)> {
    let from_pid = |pid: u32| read_session_file(home, pid);
    let hit = direct.iter().find_map(|p| from_pid(*p)).or_else(|| {
        let table = table()?;
        descendants(&table, roots).into_iter().find_map(from_pid)
    });
    if let Some(s) = hit {
        // The log lives under the directory Claude started in. Prefer the one that exists.
        let mut dirs = vec![project_dir(home, cwd)];
        dirs.extend(s.cwd.as_deref().map(|c| project_dir(home, c)));
        let paths: Vec<PathBuf> = dirs.iter().map(|d| d.join(format!("{}.jsonl", s.id))).collect();
        let log = paths.iter().find(|p| p.exists()).unwrap_or(&paths[0]).clone();
        return Some((s.id, log));
    }
    let (path, _) = newest_jsonl(&project_dir(home, cwd), Some(RECENT_WINDOW))?;
    let id = path.file_stem()?.to_string_lossy().into_owned();
    Some((id, path))
}

/// `(pid, ppid)` pairs for every process. Works on macOS and Linux.
fn process_table() -> Option<Vec<(u32, u32)>> {
    let out = std::process::Command::new("ps").args(["-A", "-o", "pid=,ppid="]).output().ok()?;
    Some(parse_ps(&String::from_utf8_lossy(&out.stdout)))
}

pub fn parse_ps(text: &str) -> Vec<(u32, u32)> {
    text.lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
        })
        .collect()
}

/// All descendants of `roots`, breadth first, nearest first.
pub fn descendants(table: &[(u32, u32)], roots: &[u32]) -> Vec<u32> {
    let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
    for (p, pp) in table {
        kids.entry(*pp).or_default().push(*p);
    }
    let mut seen: HashSet<u32> = roots.iter().copied().collect();
    let mut queue: VecDeque<u32> = roots.iter().copied().collect();
    let mut out = Vec::new();
    while let Some(p) = queue.pop_front() {
        for k in kids.get(&p).into_iter().flatten() {
            if seen.insert(*k) {
                out.push(*k);
                queue.push_back(*k);
            }
        }
    }
    out
}

fn mtime(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).ok()?.modified().ok()
}

fn millis(t: SystemTime) -> i64 {
    t.duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// Every `.jsonl` file in `dir` with its mtime, newest first.
fn jsonl_files(dir: &Path) -> Vec<(PathBuf, SystemTime)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut v: Vec<(PathBuf, SystemTime)> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl") && p.is_file())
        .filter_map(|p| mtime(&p).map(|t| (p, t)))
        .collect();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    v
}

/// The newest `.jsonl` in `dir`, optionally only if modified within `max_age`.
pub fn newest_jsonl(dir: &Path, max_age: Option<Duration>) -> Option<(PathBuf, SystemTime)> {
    let (p, t) = jsonl_files(dir).into_iter().next()?;
    if let Some(age) = max_age {
        if SystemTime::now().duration_since(t).map_or(false, |d| d > age) {
            return None;
        }
    }
    Some((p, t))
}

/// Recent sessions for a cwd, newest first.
pub fn recent_sessions(home: &Path, cwd: &str, limit: usize) -> Vec<RecentSession> {
    jsonl_files(&project_dir(home, cwd))
        .into_iter()
        .take(limit)
        .map(|(p, t)| RecentSession {
            session: p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
            first_prompt: first_prompt(&p),
            last_activity: millis(t),
            cwd: cwd.to_string(),
        })
        .collect()
}

/// The first non-meta user text in a log, cut to 120 chars.
fn first_prompt(path: &Path) -> String {
    let Ok(f) = File::open(path) else { return String::new() };
    for line in BufReader::new(f).lines().take(PROMPT_SCAN_LINES) {
        let Ok(line) = line else { break };
        for item in parse_line(&line) {
            if let ThreadItem::User { text, .. } = item {
                if !text.trim().is_empty() {
                    return text.trim().chars().take(PROMPT_CHARS).collect();
                }
            }
        }
    }
    String::new()
}

/// Project dirs hold a `cwd` field in every line. Collect the newest cwd of each project,
/// newest project first. Project dir names decode lossily, so they are not decoded.
pub fn recent_cwds(home: &Path, cap: usize) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(home.join(".claude/projects")) else { return Vec::new() };
    let mut found: Vec<(SystemTime, String)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let (path, t) = newest_jsonl(&e.path(), None)?;
            Some((t, last_cwd(&path)?))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    let mut seen = HashSet::new();
    found.into_iter().map(|(_, c)| c).filter(|c| seen.insert(c.clone())).take(cap).collect()
}

/// The `cwd` of the newest line that has one.
fn last_cwd(path: &Path) -> Option<String> {
    let lines = crate::tail::read_offset_lines_before(File::open(path).ok()?, None, 20).ok()?;
    lines.into_iter().rev().find_map(|(_, l)| {
        let v: Value = serde_json::from_str(&l).ok()?;
        v.get("cwd")?.as_str().filter(|s| !s.is_empty()).map(String::from)
    })
}
