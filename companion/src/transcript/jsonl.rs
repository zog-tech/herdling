//! Pages and follow for JSONL session logs other than Claude's. Each agent gives a
//! [`LineParser`]; this module reads the file by byte offsets.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::tail::read_offset_lines_before;
use crate::types::{ThreadItem, ThreadPage, ToolResult};

/// Items and tool results of one log line. A result is keyed by the id of its tool item.
#[derive(Debug, Default)]
pub struct Parsed {
    pub items: Vec<ThreadItem>,
    pub results: Vec<(String, ToolResult)>,
}

pub trait LineParser {
    /// Parse the line that starts at byte `off`. Unknown or invalid lines give nothing.
    fn parse(&mut self, off: u64, line: &str) -> Parsed;
    /// A reason to end a follow stream (for example, the user moved to another branch).
    fn ended(&self) -> Option<&'static str> {
        None
    }
    /// Called once a follower has read the lines before its start offset.
    fn seeded(&mut self) {}
}

/// Max bytes read past a page to find results for its open tool calls.
pub const FORWARD_WINDOW: u64 = 256 * 1024;
/// Bytes before the follow start scanned for calls that still wait for a result.
pub const SEED_WINDOW: u64 = 256 * 1024;
/// Pending tool items kept by a follower. The oldest are dropped first.
pub const PENDING_CAP: usize = 256;
/// Bytes read per follow step. A longer line grows the read.
const CHUNK: u64 = 1024 * 1024;

/// Put each result into the tool item with the same id.
pub fn assemble(mut items: Vec<ThreadItem>, results: &HashMap<String, ToolResult>) -> Vec<ThreadItem> {
    for item in &mut items {
        if let ThreadItem::Tool { id, result, .. } = item {
            if let Some(r) = results.get(id.as_str()) {
                *result = Some(r.clone());
            }
        }
    }
    items
}

/// Read one page of items that ends at byte `before` (default EOF), newest last.
pub fn page<P: LineParser>(path: &Path, before: Option<u64>, limit: usize, parser: &mut P) -> io::Result<ThreadPage> {
    page_from(File::open(path)?, before, limit, parser)
}

pub fn page_from<R: Read + Seek, P: LineParser>(
    mut r: R,
    before: Option<u64>,
    limit: usize,
    parser: &mut P,
) -> io::Result<ThreadPage> {
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
            let p = parser.parse(off, &line);
            for (id, res) in p.results {
                // Lines are read newest first: the newest result for an id wins.
                results.entry(id).or_insert(res);
            }
            count += p.items.len();
            chunks.push(p.items);
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
    scan_forward(&mut r, end.min(page_end), len, &items, &mut results, parser)?;
    Ok(ThreadPage { items: assemble(items, &results), cursor, end })
}

/// A result can sit on a later page than its call. Look ahead a bounded window.
fn scan_forward<R: Read + Seek, P: LineParser>(
    r: &mut R,
    from: u64,
    len: u64,
    items: &[ThreadItem],
    results: &mut HashMap<String, ToolResult>,
    parser: &mut P,
) -> io::Result<()> {
    let mut pending: HashSet<String> = items
        .iter()
        .filter_map(|i| match i {
            ThreadItem::Tool { id, result: None, .. } if !results.contains_key(id) => Some(id.clone()),
            _ => None,
        })
        .collect();
    if pending.is_empty() || from >= len {
        return Ok(());
    }
    let n = FORWARD_WINDOW.min(len - from);
    r.seek(SeekFrom::Start(from))?;
    let mut buf = vec![0u8; n as usize];
    r.read_exact(&mut buf)?;
    if from + n < len {
        match buf.iter().rposition(|c| *c == b'\n') {
            Some(i) => buf.truncate(i + 1),
            None => return Ok(()),
        }
    }
    let mut off = from;
    for line in String::from_utf8_lossy(&buf).split_inclusive('\n') {
        let start = off;
        off += line.len() as u64;
        let line = line.trim_end_matches(['\n', '\r']);
        if line.trim().is_empty() {
            continue;
        }
        for (id, res) in parser.parse(start, line).results {
            if pending.remove(&id) {
                results.insert(id, res);
            }
        }
        if pending.is_empty() {
            break;
        }
    }
    Ok(())
}

/// Follow a growing log: new items, and tool items again when their result arrives.
pub struct Follower<P: LineParser> {
    path: PathBuf,
    offset: u64,
    parser: P,
    pending: HashMap<String, ThreadItem>,
    order: VecDeque<String>,
}

impl<P: LineParser> Follower<P> {
    pub fn new(path: &Path, from: u64, parser: P) -> Follower<P> {
        let mut f = Follower { path: path.to_path_buf(), offset: from, parser, pending: HashMap::new(), order: VecDeque::new() };
        // Calls before `from` can get their result later. Remember the open ones; emit nothing.
        if let Some((start, text)) = f.window_before(from) {
            f.process(start, &text);
        }
        f.parser.seeded();
        f
    }

    /// The complete lines in the last `SEED_WINDOW` bytes before `end`, and where they start.
    fn window_before(&self, end: u64) -> Option<(u64, String)> {
        let mut file = File::open(&self.path).ok()?;
        let end = end.min(file.metadata().ok()?.len());
        let mut start = end.saturating_sub(SEED_WINDOW);
        file.seek(SeekFrom::Start(start)).ok()?;
        let mut buf = vec![0u8; (end - start) as usize];
        file.read_exact(&mut buf).ok()?;
        if start > 0 {
            let i = buf.iter().position(|c| *c == b'\n')?;
            buf.drain(..=i);
            start += i as u64 + 1;
        }
        Some((start, String::from_utf8_lossy(&buf).into_owned()))
    }

    /// Byte offset of the next unread line.
    pub fn offset(&self) -> u64 {
        self.offset
    }

    /// See [`LineParser::ended`].
    pub fn ended(&self) -> Option<&'static str> {
        self.parser.ended()
    }

    /// Read the complete lines past the offset. `None` when there is nothing new.
    pub fn poll(&mut self) -> io::Result<Option<(Vec<ThreadItem>, u64)>> {
        let mut f = File::open(&self.path)?;
        let len = f.metadata()?.len();
        if len < self.offset {
            self.offset = len;
        }
        let mut want = CHUNK;
        let buf = loop {
            let n = want.min(len - self.offset);
            if n == 0 {
                return Ok(None);
            }
            f.seek(SeekFrom::Start(self.offset))?;
            let mut buf = vec![0u8; n as usize];
            f.read_exact(&mut buf)?;
            if let Some(i) = buf.iter().rposition(|c| *c == b'\n') {
                buf.truncate(i + 1);
                break buf;
            }
            if n == len - self.offset {
                return Ok(None);
            }
            want *= 2;
        };
        let start = self.offset;
        self.offset += buf.len() as u64;
        let items = self.process(start, &String::from_utf8_lossy(&buf));
        Ok(Some((items, self.offset)))
    }

    fn process(&mut self, start: u64, text: &str) -> Vec<ThreadItem> {
        let mut items = Vec::new();
        let mut results: HashMap<String, ToolResult> = HashMap::new();
        let mut off = start;
        for line in text.split_inclusive('\n') {
            let line_off = off;
            off += line.len() as u64;
            let line = line.trim_end_matches(['\n', '\r']);
            if line.trim().is_empty() {
                continue;
            }
            let p = self.parser.parse(line_off, line);
            items.extend(p.items);
            results.extend(p.results);
            if self.parser.ended().is_some() {
                break;
            }
        }
        let updates: Vec<ThreadItem> = results.keys().filter_map(|id| self.pending.remove(id)).collect();
        self.order.retain(|id| self.pending.contains_key(id));
        let mut out = assemble(items, &results);
        for item in &out {
            if let ThreadItem::Tool { id, result: None, .. } = item {
                if self.pending.insert(id.clone(), item.clone()).is_none() {
                    self.order.push_back(id.clone());
                }
            }
        }
        while self.order.len() > PENDING_CAP {
            if let Some(old) = self.order.pop_front() {
                self.pending.remove(&old);
            }
        }
        out.extend(assemble(updates, &results));
        out
    }
}
