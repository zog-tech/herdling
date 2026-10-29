//! Claude Code session logs (JSONL) as normalized thread items.

mod parse;

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use crate::tail::read_offset_lines_before;
use crate::types::{ThreadItem, ThreadPage, ToolResult};

pub use parse::{assemble, parse_line, parse_results, RESULT_CAP};

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
    let mut cursor = Some(before.map_or(len, |b| b.min(len)));
    let mut end = len;
    let mut chunks: Vec<Vec<ThreadItem>> = Vec::new();
    let mut results: HashMap<String, ToolResult> = HashMap::new();
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
    let items = assemble(chunks.into_iter().flatten().collect(), results);
    Ok(ThreadPage { items, cursor, end })
}
