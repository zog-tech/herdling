//! Claude Code session logs (JSONL) as normalized thread items.

mod follow;
mod parse;
mod resolve;

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use crate::tail::read_offset_lines_before;
use crate::types::{ThreadItem, ThreadPage};

pub use follow::{Follower, POLL_INTERVAL};
pub use resolve::{descendants, parse_ps, newest_jsonl, project_dir, recent_cwds, recent_sessions, resolve};
pub use parse::{assemble, parse_line, parse_results, ResultInfo, RESULT_CAP};

/// Default page size in thread items.
pub const DEFAULT_LIMIT: usize = 60;

/// Read one page of items ending at byte `before` (default EOF), newest last.
/// `limit` counts items; a line is never split, so a page can hold a few more.
pub fn thread_get(path: &Path, before: Option<u64>, limit: usize) -> io::Result<ThreadPage> {
    thread_get_from(File::open(path)?, before, limit)
}

pub fn thread_get_from<R: Read + Seek>(mut r: R, before: Option<u64>, limit: usize) -> io::Result<ThreadPage> {
    let len = r.seek(SeekFrom::End(0))?;
    let limit = limit.max(1);
    let ends_with_newline = if len == 0 {
        true
    } else {
        r.seek(SeekFrom::Start(len - 1))?;
        let mut b = [0u8; 1];
        r.read_exact(&mut b)?;
        b[0] == b'\n'
    };
    let page_end = before.map_or(len, |b| b.min(len));
    let mut cursor = Some(page_end);
    let mut end = len;
    let mut chunks: Vec<Vec<ThreadItem>> = Vec::new();
    let mut results: HashMap<String, ResultInfo> = HashMap::new();
    let mut count = 0usize;
    let mut first = true;

    'outer: while let Some(cur) = cursor {
        if cur == 0 {
            cursor = None;
            break;
        }
        let mut lines = read_offset_lines_before(&mut r, Some(cur), limit.max(8))?;
        if lines.is_empty() {
            // Only a cut-off fragment remained in range; nothing older can be read.
            cursor = None;
            break;
        }
        let batch_start = lines.first().map(|(o, _)| *o);
        if first && before.is_none() && !ends_with_newline {
            // A line still being written is not valid JSON yet. Leave it for the next read.
            if let Some((off, last)) = lines.last() {
                if serde_json::from_str::<serde::de::IgnoredAny>(last).is_err() {
                    end = *off;
                    lines.pop();
                }
            }
        }
        first = false;
        for (off, line) in lines.into_iter().rev() {
            for (id, res) in parse_results(&line) {
                results.insert(id, res);
            }
            let items = parse_line(&line);
            count += items.len();
            chunks.push(items);
            cursor = Some(off);
            if count >= limit {
                break 'outer;
            }
        }
        cursor = batch_start;
    }
    let cursor = cursor.filter(|c| *c > 0);
    chunks.reverse();
    let items: Vec<ThreadItem> = chunks.into_iter().flatten().collect();
    scan_forward(&mut r, end.min(page_end), len, &items, &mut results)?;
    let items = assemble(items, results);
    Ok(ThreadPage { items, cursor, end })
}

/// Max bytes read past a page to find results for its unresolved tool calls.
pub const FORWARD_WINDOW: u64 = 256 * 1024;

/// A result can sit on a later page than its call. Look ahead a bounded window
/// for results of calls on this page that have none yet.
fn scan_forward<R: Read + Seek>(
    r: &mut R,
    from: u64,
    len: u64,
    items: &[ThreadItem],
    results: &mut HashMap<String, ResultInfo>,
) -> io::Result<()> {
    let mut pending: std::collections::HashSet<&str> = items
        .iter()
        .filter_map(|i| match i {
            ThreadItem::Tool { id, result: None, .. } | ThreadItem::Subagent { id, .. } => Some(id.as_str()),
            _ => None,
        })
        .filter(|id| !results.contains_key(*id))
        .collect();
    if pending.is_empty() || from >= len {
        return Ok(());
    }
    let n = FORWARD_WINDOW.min(len - from);
    r.seek(SeekFrom::Start(from))?;
    let mut buf = vec![0u8; n as usize];
    r.read_exact(&mut buf)?;
    if from + n < len {
        // The window ends inside a line. Drop the cut-off tail.
        match buf.iter().rposition(|c| *c == b'\n') {
            Some(i) => buf.truncate(i + 1),
            None => return Ok(()),
        }
    }
    for line in String::from_utf8_lossy(&buf).lines() {
        if !line.contains("tool_result") {
            continue;
        }
        for (id, info) in parse_results(line) {
            if pending.remove(id.as_str()) {
                results.insert(id, info);
            }
        }
        if pending.is_empty() {
            break;
        }
    }
    Ok(())
}

/// Path of a subagent transcript next to its parent log.
pub fn subagent_path(log_path: &Path, agent_id: &str) -> Option<std::path::PathBuf> {
    if agent_id.is_empty() || !agent_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return None;
    }
    Some(log_path.with_extension("").join("subagents").join(format!("agent-{agent_id}.jsonl")))
}
