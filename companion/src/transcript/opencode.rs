//! OpenCode 2 sessions in SQLite: `~/.local/share/opencode/opencode.db`, tables `session_v2`
//! and `session_message`. The database is in WAL mode and OpenCode writes to it while we
//! read, so every connection is read-only with a busy timeout.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde_json::Value;

use super::{short, text_result, tool_summary, CandidateSession};
use crate::claude::cap;
use crate::types::{ThreadItem, ThreadPage, ToolResult};

/// Prefix of an OpenCode `log_path`: `opencode-db:<db path>#<session id>`.
pub const SCHEME: &str = "opencode-db:";
const BUSY: Duration = Duration::from_millis(1000);
const SUMMARY_CAP: usize = 280;

pub fn db_path(home: &Path) -> PathBuf {
    home.join(".local").join("share").join("opencode").join("opencode.db")
}

pub fn log_path(db: &Path, session: &str) -> String {
    format!("{SCHEME}{}#{session}", db.display())
}

/// The database path and session id of an OpenCode `log_path`.
pub fn parse_log_path(s: &str) -> Option<(PathBuf, String)> {
    let (db, session) = s.strip_prefix(SCHEME)?.rsplit_once('#')?;
    (!db.is_empty() && !session.is_empty()).then(|| (PathBuf::from(db), session.to_string()))
}

fn sql_err(e: rusqlite::Error) -> io::Error {
    io::Error::other(e.to_string())
}

pub fn open(db: &Path) -> io::Result<Connection> {
    if !db.is_file() {
        return Err(io::Error::new(io::ErrorKind::NotFound, format!("no such database: {}", db.display())));
    }
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let c = Connection::open_with_flags(db, flags).map_err(sql_err)?;
    c.busy_timeout(BUSY).map_err(sql_err)?;
    Ok(c)
}

/// One `session_message` row.
struct Row {
    id: String,
    seq: i64,
    kind: String,
    data: String,
    updated: i64,
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Row> {
    Ok(Row { id: r.get(0)?, seq: r.get(1)?, kind: r.get(2)?, data: r.get(3)?, updated: r.get(4)? })
}

const COLS: &str = "id, seq, type, data, time_updated";

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn created(v: &Value) -> i64 {
    v.pointer("/time/created").and_then(Value::as_i64).unwrap_or(0)
}

/// The thread items of one row. Ids are `<row id>:<block index>`; a tool keeps its call id.
fn items_of(r: &Row) -> Vec<ThreadItem> {
    let Ok(v) = serde_json::from_str::<Value>(&r.data) else { return Vec::new() };
    let ts = created(&v);
    let mut out = Vec::new();
    match r.kind.as_str() {
        "user" => {
            let text = s(&v, "text").to_string();
            let images = v
                .get("files")
                .and_then(Value::as_array)
                .map_or(0, |a| a.iter().filter(|f| s(f, "mime").starts_with("image/")).count() as u32);
            if !text.trim().is_empty() || images > 0 {
                out.push(ThreadItem::User { id: r.id.clone(), ts, text, images: (images > 0).then_some(images) });
            }
        }
        "compaction" => {
            let text = format!("Conversation compacted. {}", s(&v, "summary").trim());
            out.push(ThreadItem::System { id: r.id.clone(), ts, text: cap(text.trim(), SUMMARY_CAP).0 });
        }
        "assistant" => {
            for (i, b) in v.get("content").and_then(Value::as_array).into_iter().flatten().enumerate() {
                let id = format!("{}:{i}", r.id);
                match s(b, "type") {
                    "text" if !s(b, "text").trim().is_empty() => {
                        out.push(ThreadItem::Assistant { id, ts, markdown: s(b, "text").to_string() });
                    }
                    "reasoning" if !s(b, "text").trim().is_empty() => {
                        out.push(ThreadItem::Thinking { id, ts: created(b).max(ts), text: Some(s(b, "text").to_string()) });
                    }
                    "tool" => out.push(tool_of(b, id, ts)),
                    _ => {}
                }
            }
            if let Some(e) = v.get("error").filter(|e| e.is_object()) {
                let text = if s(e, "type") == "aborted" { "Interrupted".to_string() } else { s(e, "message").to_string() };
                let text = if text.is_empty() { "Request failed".to_string() } else { text };
                out.push(ThreadItem::System { id: format!("{}:error", r.id), ts, text: cap(&text, SUMMARY_CAP).0 });
            }
        }
        // `system` and `synthetic` rows are harness notes for the model.
        _ => {}
    }
    out
}

fn tool_of(b: &Value, fallback_id: String, ts: i64) -> ThreadItem {
    let name = s(b, "name").to_string();
    let state = b.get("state").unwrap_or(&Value::Null);
    let input = state.get("input").cloned().unwrap_or(Value::Null);
    let at = b.pointer("/time/completed").and_then(Value::as_i64);
    let result: Option<ToolResult> = match s(state, "status") {
        "completed" => {
            let text: Vec<&str> = state
                .get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|c| c.get("text").and_then(Value::as_str))
                .collect();
            let text = if text.is_empty() { state.pointer("/metadata/output").and_then(Value::as_str).unwrap_or("").to_string() } else { text.join("\n") };
            Some(text_result(&text, true, at))
        }
        "error" => Some(text_result(state.pointer("/error/message").and_then(Value::as_str).unwrap_or(""), false, at)),
        _ => None,
    };
    let id = Some(s(b, "id")).filter(|x| !x.is_empty()).map_or(fallback_id, String::from);
    ThreadItem::Tool { input_summary: tool_summary(&name, &input), id, ts: created(b).max(ts), name, input, result }
}

fn session_exists(c: &Connection, session: &str) -> io::Result<bool> {
    c.query_row("SELECT 1 FROM session_v2 WHERE id = ?1", params![session], |_| Ok(()))
        .optional()
        .map(|o| o.is_some())
        .map_err(sql_err)
}

/// One page of items that ends before `seq` `before` (default: the newest row), newest last.
/// The cursor is a `seq`; `end` is one past the newest `seq`.
pub fn thread_get(log: &str, before: Option<u64>, limit: usize) -> io::Result<ThreadPage> {
    let (db, session) = parse_log_path(log).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "bad OpenCode log path"))?;
    let c = open(&db)?;
    if !session_exists(&c, &session)? {
        return Err(io::Error::new(io::ErrorKind::NotFound, format!("no such session: {session}")));
    }
    let limit = limit.max(1);
    let max: Option<i64> = c
        .query_row("SELECT MAX(seq) FROM session_message WHERE session_id = ?1", params![session], |r| r.get(0))
        .map_err(sql_err)?;
    let end = max.map_or(0, |m| m + 1);
    let mut upper = before.map_or(end, |b| (b as i64).min(end));
    let mut chunks: Vec<Vec<ThreadItem>> = Vec::new();
    let mut count = 0usize;
    let mut oldest = upper;
    let mut stmt = c
        .prepare(&format!("SELECT {COLS} FROM session_message WHERE session_id = ?1 AND seq < ?2 ORDER BY seq DESC LIMIT ?3"))
        .map_err(sql_err)?;
    'outer: loop {
        let rows: Vec<Row> = stmt
            .query_map(params![session, upper, limit as i64], row)
            .map_err(sql_err)?
            .collect::<Result<_, _>>()
            .map_err(sql_err)?;
        if rows.is_empty() {
            break;
        }
        for r in &rows {
            let items = items_of(r);
            count += items.len();
            chunks.push(items);
            oldest = r.seq;
            if count >= limit {
                break 'outer;
            }
        }
        upper = oldest;
    }
    let older: Option<i64> = c
        .query_row("SELECT 1 FROM session_message WHERE session_id = ?1 AND seq < ?2 LIMIT 1", params![session, oldest], |r| r.get(0))
        .optional()
        .map_err(sql_err)?;
    chunks.reverse();
    let cursor = older.and((oldest > 0).then_some(oldest as u64));
    Ok(ThreadPage { items: chunks.into_iter().flatten().collect(), cursor, end: end as u64 })
}

/// Follow a session: new rows, and rows that changed (a streamed reply, a finished tool).
pub struct Follower {
    conn: Connection,
    session: String,
    /// Rows with a `seq` at or past this are new.
    next_seq: i64,
    /// Rows updated after this time (ms) changed.
    watermark: i64,
    /// `time_updated` of the rows sent at the watermark, so a row is not sent twice.
    sent: HashMap<i64, i64>,
}

impl Follower {
    /// Start at `seq` `from`. The row before it comes again on the first poll: it can still
    /// change while the agent streams.
    pub fn new(log: &str, from: u64) -> io::Result<Follower> {
        let (db, session) = parse_log_path(log).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "bad OpenCode log path"))?;
        let conn = open(&db)?;
        let watermark: Option<i64> = conn
            .query_row("SELECT MAX(time_updated) FROM session_message WHERE session_id = ?1", params![session], |r| r.get(0))
            .map_err(sql_err)?;
        Ok(Follower { conn, session, next_seq: (from as i64 - 1).max(0), watermark: watermark.unwrap_or(0), sent: HashMap::new() })
    }

    pub fn offset(&self) -> u64 {
        self.next_seq as u64
    }

    pub fn poll(&mut self) -> io::Result<Option<(Vec<ThreadItem>, u64)>> {
        let mut stmt = self
            .conn
            .prepare_cached(&format!(
                "SELECT {COLS} FROM session_message WHERE session_id = ?1 AND (seq >= ?2 OR time_updated >= ?3) ORDER BY seq"
            ))
            .map_err(sql_err)?;
        let rows: Vec<Row> = stmt
            .query_map(params![self.session, self.next_seq, self.watermark], row)
            .map_err(sql_err)?
            .collect::<Result<_, _>>()
            .map_err(sql_err)?;
        drop(stmt);
        let mut items = Vec::new();
        let mut changed = false;
        for r in rows {
            if self.sent.get(&r.seq) == Some(&r.updated) {
                continue;
            }
            changed = true;
            self.next_seq = self.next_seq.max(r.seq + 1);
            if r.updated > self.watermark {
                self.watermark = r.updated;
            }
            self.sent.insert(r.seq, r.updated);
            items.extend(items_of(&r));
        }
        let w = self.watermark;
        let next = self.next_seq;
        // Keep only what can still match the watermark or the last row.
        self.sent.retain(|seq, t| *t >= w || *seq + 1 >= next);
        Ok(changed.then(|| (items, self.next_seq as u64)))
    }
}

/// Top-level sessions of `cwd` (all folders when `None`), most recent first. The recency is
/// the newer of `time_updated` and `time_viewed`.
pub fn candidates(db: &Path, cwd: Option<&str>, limit: usize) -> io::Result<Vec<CandidateSession>> {
    let c = open(db)?;
    let mut stmt = c
        .prepare(
            "SELECT id, directory, MAX(time_updated, COALESCE(time_viewed, 0)) AS t FROM session_v2 \
             WHERE parent_id IS NULL AND time_archived IS NULL AND (?1 IS NULL OR directory = ?1) \
             ORDER BY t DESC LIMIT ?2",
        )
        .map_err(sql_err)?;
    let rows = stmt
        .query_map(params![cwd, limit as i64], |r| {
            let id: String = r.get(0)?;
            Ok(CandidateSession { log_path: log_path(db, &id), id, cwd: r.get(1)?, last_activity: r.get(2)? })
        })
        .map_err(sql_err)?;
    rows.collect::<Result<_, _>>().map_err(sql_err)
}

/// The session title, else the first user prompt.
pub fn first_prompt(db: &Path, session: &str) -> String {
    let Ok(c) = open(db) else { return String::new() };
    let title: Option<String> = c
        .query_row("SELECT title FROM session_v2 WHERE id = ?1", params![session], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
        .flatten();
    if let Some(t) = title.filter(|t| !t.trim().is_empty()) {
        return short(&t);
    }
    let data: Option<String> = c
        .query_row(
            "SELECT data FROM session_message WHERE session_id = ?1 AND type = 'user' ORDER BY seq LIMIT 1",
            params![session],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    data.and_then(|d| serde_json::from_str::<Value>(&d).ok()).map(|v| short(s(&v, "text"))).unwrap_or_default()
}
