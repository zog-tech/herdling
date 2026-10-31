//! Live state of subagents, from the files Claude Code keeps next to the parent log:
//! `<session>/subagents/agent-<id>.meta.json` (written at launch, `finished` set at the end)
//! and `agent-<id>.jsonl` (the subagent transcript).

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;

use super::parse::{cap, parse_line, parse_ts};
use super::subagent_path;
use crate::types::ThreadItem;

/// Time between checks of running subagents in a follow.
pub const AGENT_POLL: Duration = Duration::from_secs(2);
/// A subagent with no `finished` flag and no write for this long counts as stopped.
pub const STALE: Duration = Duration::from_secs(30 * 60);
/// Max chars of an activity line.
pub const ACTIVITY_CAP: usize = 80;
const SUMMARY_CAP: usize = 500;

/// The `subagents` folder of a parent log.
pub fn subagents_dir(log: &Path) -> PathBuf {
    log.with_extension("").join("subagents")
}

/// One `agent-<id>.meta.json`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AgentMeta {
    pub agent_id: String,
    pub tool_use_id: Option<String>,
    /// `Some(true)` when the subagent stopped. Missing while it runs, and in files of older versions.
    pub finished: Option<bool>,
    pub model: Option<String>,
    pub agent_type: Option<String>,
}

fn parse_meta(agent_id: &str, text: &str) -> Option<AgentMeta> {
    let v: Value = serde_json::from_str(text).ok()?;
    let s = |k: &str| v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from);
    Some(AgentMeta {
        agent_id: agent_id.to_string(),
        tool_use_id: s("toolUseId"),
        finished: v.get("finished").and_then(Value::as_bool),
        model: s("model"),
        agent_type: s("agentType"),
    })
}

/// The meta file of a transcript `agent-<id>.jsonl`.
fn meta_path(transcript: &Path) -> PathBuf {
    transcript.with_extension("meta.json")
}

fn agent_id_of(transcript: &Path) -> Option<&str> {
    transcript.file_name()?.to_str()?.strip_prefix("agent-")?.strip_suffix(".jsonl")
}

/// The meta of one subagent of `log`.
pub fn read_meta(log: &Path, agent_id: &str) -> Option<AgentMeta> {
    let p = meta_path(&subagent_path(log, agent_id)?);
    parse_meta(agent_id, &fs::read_to_string(p).ok()?)
}

/// All metas of `log`, keyed by the id of the Task/Agent call that launched them.
pub fn read_metas(log: &Path) -> HashMap<String, AgentMeta> {
    let mut out = HashMap::new();
    let Ok(dir) = fs::read_dir(subagents_dir(log)) else { return out };
    for e in dir.flatten() {
        let name = e.file_name();
        let Some(id) = name.to_str().and_then(|n| n.strip_prefix("agent-")?.strip_suffix(".meta.json")) else {
            continue;
        };
        let Some(m) = fs::read_to_string(e.path()).ok().and_then(|t| parse_meta(id, &t)) else { continue };
        if let Some(t) = m.tool_use_id.clone() {
            out.insert(t, m);
        }
    }
    out
}

/// For a subagent transcript: true while the subagent runs, false when it stopped.
/// `None` when there is no meta file.
pub fn transcript_running(transcript: &Path, now: SystemTime) -> Option<bool> {
    let id = agent_id_of(transcript)?;
    let meta = parse_meta(id, &fs::read_to_string(meta_path(transcript)).ok()?)?;
    if meta.finished == Some(true) {
        return Some(false);
    }
    let idle = fs::metadata(transcript).ok().and_then(|m| m.modified().ok()).and_then(|t| now.duration_since(t).ok());
    Some(!idle.is_some_and(|d| d > STALE))
}

/// What a subagent transcript shows so far. `update` reads only the lines added since the last call.
#[derive(Debug, Clone, Default)]
pub struct Scan {
    offset: u64,
    /// Modification time of the transcript. `None` when the file is missing.
    pub mtime: Option<SystemTime>,
    pub started_at: Option<i64>,
    /// Unix ms of the last assistant line.
    pub last_ts: Option<i64>,
    pub tool_count: u32,
    pub activity: Option<String>,
    /// The last assistant text, capped.
    pub last_text: Option<String>,
}

impl Scan {
    /// Read the new complete lines of `path`. Returns true when the file changed.
    pub fn update(&mut self, path: &Path) -> bool {
        let Ok(meta) = fs::metadata(path) else {
            self.mtime = None;
            return false;
        };
        let len = meta.len();
        self.mtime = meta.modified().ok();
        if len < self.offset {
            // The file was replaced by a shorter one. Read it again.
            *self = Scan { mtime: self.mtime, ..Scan::default() };
        }
        if len == self.offset {
            return false;
        }
        let Ok(mut f) = File::open(path) else { return false };
        if f.seek(SeekFrom::Start(self.offset)).is_err() {
            return false;
        }
        let mut buf = Vec::with_capacity((len - self.offset) as usize);
        if f.take(len - self.offset).read_to_end(&mut buf).is_err() {
            return false;
        }
        // A line still being written stays for the next read.
        let Some(i) = buf.iter().rposition(|c| *c == b'\n') else { return false };
        buf.truncate(i + 1);
        self.offset += buf.len() as u64;
        for line in String::from_utf8_lossy(&buf).lines() {
            self.line(line);
        }
        true
    }

    fn line(&mut self, line: &str) {
        if self.started_at.is_none() {
            self.started_at = serde_json::from_str::<Value>(line)
                .ok()
                .and_then(|v| v.get("timestamp").and_then(Value::as_str).and_then(parse_ts));
        }
        // Only assistant lines hold steps. Skip the large tool result lines without a parse.
        if !line.contains(r#""type":"assistant""#) {
            return;
        }
        for item in parse_line(line) {
            match item {
                ThreadItem::Tool { ts, name, input, input_summary, .. } => {
                    self.tool_count += 1;
                    self.activity = Some(tool_activity(&name, &input, &input_summary));
                    self.last_ts = Some(ts).filter(|t| *t > 0).or(self.last_ts);
                }
                ThreadItem::Subagent { ts, description, .. } => {
                    self.tool_count += 1;
                    self.activity = Some(clip(&format!("Agent {description}")));
                    self.last_ts = Some(ts).filter(|t| *t > 0).or(self.last_ts);
                }
                ThreadItem::Assistant { ts, markdown, .. } => {
                    if let Some(l) = first_line(&markdown) {
                        self.activity = Some(clip(l));
                    }
                    self.last_text = Some(cap(markdown.trim(), SUMMARY_CAP).0);
                    self.last_ts = Some(ts).filter(|t| *t > 0).or(self.last_ts);
                }
                _ => {}
            }
        }
    }
}

/// Short text of one tool step: the tool name and a short target.
pub fn tool_activity(name: &str, input: &Value, summary: &str) -> String {
    let get = |k: &str| input.get(k).and_then(Value::as_str);
    let target = match name {
        "Read" | "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => get("file_path")
            .or_else(|| get("notebook_path"))
            .map(|p| p.rsplit('/').next().unwrap_or(p).to_string()),
        "Bash" => get("command").and_then(first_line).map(String::from),
        _ => None,
    }
    .unwrap_or_else(|| first_line(summary).unwrap_or("").to_string());
    clip(format!("{name} {target}").trim())
}

fn first_line(s: &str) -> Option<&str> {
    s.lines().map(|l| l.trim().trim_start_matches(['#', '*', '>']).trim()).find(|l| !l.is_empty())
}

/// `s` cut to `ACTIVITY_CAP` chars, with "…" when cut.
fn clip(s: &str) -> String {
    if s.chars().count() <= ACTIVITY_CAP {
        return s.to_string();
    }
    let mut out: String = s.chars().take(ACTIVITY_CAP - 1).collect();
    out.push('…');
    out
}

fn ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// True while a subagent item has no final result.
pub fn is_live(item: &ThreadItem) -> bool {
    matches!(item, ThreadItem::Subagent { status, result_summary: None, .. } if status == "running")
}

/// Fill the live fields of a subagent item from its meta and transcript scan. A running item
/// whose meta says finished becomes "done" with the last assistant text as summary; one with no
/// write for `STALE` becomes "stopped".
pub fn enrich(item: &mut ThreadItem, meta: Option<&AgentMeta>, scan: Option<&Scan>, now: SystemTime) {
    let live = is_live(item);
    let ThreadItem::Subagent {
        ts,
        agent_id,
        status,
        result_summary,
        started_at,
        finished_at,
        activity,
        tool_count,
        model,
        agent_type,
        ..
    } = item
    else {
        return;
    };
    if let Some(m) = meta {
        if agent_id.is_empty() {
            agent_id.clone_from(&m.agent_id);
        }
        if m.model.is_some() {
            model.clone_from(&m.model);
        }
        if m.agent_type.is_some() {
            agent_type.clone_from(&m.agent_type);
        }
    }
    let scan = scan.filter(|s| s.mtime.is_some());
    if let Some(s) = scan {
        *started_at = s.started_at.or(*started_at);
        *tool_count = Some(s.tool_count);
    }
    if started_at.is_none() && *ts > 0 {
        *started_at = Some(*ts);
    }
    let last_ts = scan.and_then(|s| s.last_ts);
    *activity = None;
    if !live {
        if status != "error" && finished_at.is_none() {
            *finished_at = last_ts;
        }
        return;
    }
    if meta.and_then(|m| m.finished) == Some(true) {
        *status = "done".into();
        *finished_at = finished_at.or(last_ts);
        *result_summary = scan.and_then(|s| s.last_text.clone()).filter(|t| !t.is_empty());
        return;
    }
    let last_write = scan.and_then(|s| s.mtime).map(ms).unwrap_or(*ts);
    if last_write > 0 && now.duration_since(UNIX_EPOCH).is_ok_and(|n| n.as_millis() as i64 - last_write > STALE.as_millis() as i64) {
        *status = "stopped".into();
        *finished_at = finished_at.or(last_ts);
        return;
    }
    *activity = scan.and_then(|s| s.activity.clone());
}

/// Fill the live fields of every subagent item of a page of `log`.
pub fn enrich_items(log: &Path, items: &mut [ThreadItem], now: SystemTime) {
    let mut metas: Option<HashMap<String, AgentMeta>> = None;
    for item in items.iter_mut() {
        let ThreadItem::Subagent { id, agent_id, .. } = &*item else { continue };
        let meta = if agent_id.is_empty() {
            metas.get_or_insert_with(|| read_metas(log)).get(id).cloned()
        } else {
            read_meta(log, agent_id)
        };
        let aid = if agent_id.is_empty() { meta.as_ref().map(|m| m.agent_id.clone()) } else { Some(agent_id.clone()) };
        let scan = aid.and_then(|a| subagent_path(log, &a)).map(|p| {
            let mut s = Scan::default();
            s.update(&p);
            s
        });
        enrich(item, meta.as_ref(), scan.as_ref(), now);
    }
}

/// A followed subagent: its item as parsed from the parent log, and what was last sent.
#[derive(Debug, Clone)]
pub struct Tracked {
    pub base: ThreadItem,
    pub last: ThreadItem,
    meta: Option<AgentMeta>,
    scan: Scan,
}

impl Tracked {
    pub fn new(base: ThreadItem) -> Tracked {
        Tracked { last: base.clone(), base, meta: None, scan: Scan::default() }
    }

    /// Read the meta and the new transcript lines, then enrich again. Returns true when the
    /// item changed. `metas` is a lazy cache of all metas of `log` for this round.
    pub fn refresh(&mut self, log: &Path, metas: &mut Option<HashMap<String, AgentMeta>>, now: SystemTime) -> bool {
        let ThreadItem::Subagent { id, agent_id, .. } = &self.base else { return false };
        let known = if agent_id.is_empty() { self.meta.as_ref().map(|m| m.agent_id.clone()) } else { Some(agent_id.clone()) };
        if self.meta.as_ref().is_none_or(|m| m.finished != Some(true)) {
            let fresh = match &known {
                Some(a) => read_meta(log, a),
                None => metas.get_or_insert_with(|| read_metas(log)).get(id).cloned(),
            };
            if fresh.is_some() {
                self.meta = fresh;
            }
        }
        let aid = known.or_else(|| self.meta.as_ref().map(|m| m.agent_id.clone()));
        let path = aid.and_then(|a| subagent_path(log, &a));
        if let Some(p) = &path {
            self.scan.update(p);
        }
        let mut item = self.base.clone();
        enrich(&mut item, self.meta.as_ref(), path.as_ref().map(|_| &self.scan), now);
        let changed = item != self.last;
        self.last = item;
        changed
    }
}
