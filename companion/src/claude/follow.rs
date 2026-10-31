//! Follow a growing Claude log: emit new items, and updated tool items when results arrive.
//! Running subagents do not write to the parent log, so the follower checks their own files
//! every `AGENT_POLL` and emits the subagent item again when it changed.

use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use super::subagents::{is_live, Tracked, AGENT_POLL};
use super::{assemble, merge_result, parse_line, parse_results, ResultInfo, ResultKind};
use crate::types::ThreadItem;

/// Time between file size checks.
pub const POLL_INTERVAL: Duration = Duration::from_millis(500);
/// Pending tool items kept to match later results. The oldest are dropped first.
pub const PENDING_CAP: usize = 256;
/// Bytes before the start offset scanned for calls that still wait for a result.
pub const SEED_WINDOW: u64 = 256 * 1024;
/// Bytes read per step. A longer line grows the read.
const CHUNK: u64 = 1024 * 1024;

pub struct Follower {
    path: PathBuf,
    offset: u64,
    pending: HashMap<String, ThreadItem>,
    order: VecDeque<String>,
    /// Running subagents by item id.
    agents: HashMap<String, Tracked>,
    next_check: Instant,
}

impl Follower {
    pub fn new(path: &Path, from: u64) -> Follower {
        let mut f = Follower {
            path: path.to_path_buf(),
            offset: from,
            pending: HashMap::new(),
            order: VecDeque::new(),
            agents: HashMap::new(),
            next_check: Instant::now() + AGENT_POLL,
        };
        // Calls before `from` may get their result later. Remember the unresolved ones.
        if let Some(text) = f.window_before(from) {
            // process() remembers the unresolved items. The output is not emitted.
            f.process(&text);
        }
        f
    }

    /// The complete lines in the last `SEED_WINDOW` bytes before `end`.
    fn window_before(&self, end: u64) -> Option<String> {
        let mut file = File::open(&self.path).ok()?;
        let end = end.min(file.metadata().ok()?.len());
        let start = end.saturating_sub(SEED_WINDOW);
        file.seek(SeekFrom::Start(start)).ok()?;
        let mut buf = vec![0u8; (end - start) as usize];
        file.read_exact(&mut buf).ok()?;
        if start > 0 {
            // The window starts inside a line. Drop it.
            let i = buf.iter().position(|c| *c == b'\n')?;
            buf.drain(..=i);
        }
        Some(String::from_utf8_lossy(&buf).into_owned())
    }

    /// Read the complete lines past the offset. Returns the items to emit and the new offset,
    /// or `None` when there is nothing new.
    /// Running subagents are checked at most every `AGENT_POLL`; their changes come in the items.
    pub fn poll(&mut self) -> io::Result<Option<(Vec<ThreadItem>, u64)>> {
        let main = self.poll_log()?;
        let agents = if !self.agents.is_empty() && Instant::now() >= self.next_check {
            self.poll_agents()
        } else {
            Vec::new()
        };
        match main {
            Some(mut items) => {
                items.extend(agents);
                Ok(Some((items, self.offset)))
            }
            None if agents.is_empty() => Ok(None),
            None => Ok(Some((agents, self.offset))),
        }
    }

    /// Check the running subagents now. Returns the items that changed.
    pub fn poll_agents(&mut self) -> Vec<ThreadItem> {
        self.next_check = Instant::now() + AGENT_POLL;
        let now = SystemTime::now();
        let mut metas = None;
        let mut out = Vec::new();
        for t in self.agents.values_mut() {
            if t.refresh(&self.path, &mut metas, now) {
                out.push(t.last.clone());
            }
        }
        self.agents.retain(|_, t| is_live(&t.last));
        out
    }

    /// Byte offset of the next unread line.
    pub fn offset(&self) -> u64 {
        self.offset
    }

    fn poll_log(&mut self) -> io::Result<Option<Vec<ThreadItem>>> {
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
        Ok(Some(items))
    }

    fn process(&mut self, text: &str) -> Vec<ThreadItem> {
        let mut items = Vec::new();
        let mut results: HashMap<String, ResultInfo> = HashMap::new();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            items.extend(parse_line(line));
            for (id, info) in parse_results(line) {
                merge_result(&mut results, id, info);
            }
        }
        // Results for calls emitted earlier come back as updated items with the same id.
        let mut updates = Vec::new();
        for (id, info) in &results {
            // A task notification is for subagents only. A tool keeps waiting for its own result.
            let skip = info.kind == ResultKind::Notice && matches!(self.pending.get(id), Some(ThreadItem::Tool { .. }));
            if skip {
                continue;
            }
            if let Some(item) = self.pending.remove(id) {
                updates.push(item);
            }
        }
        self.order.retain(|id| self.pending.contains_key(id));
        let mut out = assemble(items, results.clone());
        let updates = assemble(updates, results);
        // A call and its result can arrive in one read; `assemble` merged those already.
        // A launched background subagent stays unresolved until its notification.
        for item in out.iter().chain(updates.iter()) {
            if is_unresolved(item) {
                self.remember(item.clone());
            }
        }
        out.extend(updates);
        self.track(&mut out);
        out
    }

    /// Give subagent items their live fields. Keep the running ones for `poll_agents`.
    fn track(&mut self, items: &mut [ThreadItem]) {
        let now = SystemTime::now();
        let mut metas = None;
        for item in items.iter_mut() {
            let ThreadItem::Subagent { id, .. } = &*item else { continue };
            let id = id.clone();
            let mut t = match self.agents.remove(&id) {
                Some(mut t) => {
                    t.base = item.clone();
                    t
                }
                None => Tracked::new(item.clone()),
            };
            t.refresh(&self.path, &mut metas, now);
            item.clone_from(&t.last);
            if is_live(&t.last) {
                self.agents.insert(id, t);
            }
        }
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
