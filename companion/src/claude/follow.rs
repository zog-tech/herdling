//! Follow a growing Claude log: emit new items, and updated tool items when results arrive.

use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::{assemble, parse_line, parse_results, ResultInfo};
use crate::types::ThreadItem;

/// Time between file size checks.
pub const POLL_INTERVAL: Duration = Duration::from_millis(500);
/// Pending tool items kept to match later results. The oldest are dropped first.
pub const PENDING_CAP: usize = 256;
/// Bytes read per step. A longer line grows the read.
const CHUNK: u64 = 1024 * 1024;

pub struct Follower {
    path: PathBuf,
    offset: u64,
    pending: HashMap<String, ThreadItem>,
    order: VecDeque<String>,
}

impl Follower {
    pub fn new(path: &Path, from: u64) -> Follower {
        Follower { path: path.to_path_buf(), offset: from, pending: HashMap::new(), order: VecDeque::new() }
    }

    /// Read the complete lines past the offset. Returns the items to emit and the new offset,
    /// or `None` when there is nothing new.
    pub fn poll(&mut self) -> io::Result<Option<(Vec<ThreadItem>, u64)>> {
        let mut f = File::open(&self.path)?;
        let len = f.metadata()?.len();
        if len < self.offset {
            // The file was replaced by a shorter one. Start at its end.
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
                return Ok(None); // Only a partial line so far.
            }
            want *= 2;
        };
        self.offset += buf.len() as u64;
        let items = self.process(&String::from_utf8_lossy(&buf));
        Ok(Some((items, self.offset)))
    }

    fn process(&mut self, text: &str) -> Vec<ThreadItem> {
        let mut items = Vec::new();
        let mut results: HashMap<String, ResultInfo> = HashMap::new();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            items.extend(parse_line(line));
            results.extend(parse_results(line));
        }
        // Results for calls emitted earlier come back as updated items with the same id.
        let mut updates = Vec::new();
        for id in results.keys() {
            if let Some(item) = self.pending.remove(id) {
                updates.push(item);
            }
        }
        self.order.retain(|id| self.pending.contains_key(id));
        let mut out = assemble(items, results.clone());
        // A call and its result can arrive in one read; `assemble` merged those already.
        for item in &out {
            if is_unresolved(item) {
                self.remember(item.clone());
            }
        }
        out.extend(assemble(updates, results));
        out
    }

    fn remember(&mut self, item: ThreadItem) {
        let id = match &item {
            ThreadItem::Tool { id, .. } | ThreadItem::Subagent { id, .. } => id.clone(),
            _ => return,
        };
        if self.pending.insert(id.clone(), item).is_none() {
            self.order.push_back(id);
        }
        while self.order.len() > PENDING_CAP {
            if let Some(old) = self.order.pop_front() {
                self.pending.remove(&old);
            }
        }
    }
}

fn is_unresolved(item: &ThreadItem) -> bool {
    match item {
        ThreadItem::Tool { result, .. } => result.is_none(),
        ThreadItem::Subagent { status, result_summary, .. } => status == "running" && result_summary.is_none(),
        _ => false,
    }
}
