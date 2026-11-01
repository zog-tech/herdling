//! Background work of an agent: shells and subagents that keep running after the turn ends.
//!
//! The tracker is agent-neutral. An agent adapter turns its log lines into `start` and `end`
//! calls (see `claude::background`). [`BackgroundLog`] reads a log once from a bounded window
//! and then only the new lines, so a preview poll stays cheap.

use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::types::BackgroundInfo;

/// A task with no end signal after this time counts as ended (milliseconds).
pub const STALE_MS: i64 = 12 * 60 * 60 * 1000;
/// Most tasks kept. The oldest go first.
pub const TASK_CAP: usize = 64;
/// Most commands sent in [`BackgroundInfo::commands`].
pub const COMMANDS_SENT: usize = 3;
/// Chars of one command in [`BackgroundInfo::commands`].
pub const COMMAND_CAP: usize = 40;
/// Bytes read from the end of a log on the first read. Older starts are not seen.
pub const SCAN_BYTES: u64 = 8 * 1024 * 1024;

/// The kind of a background task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskKind {
    Shell,
    Subagent,
}

/// One background task that has started and has not ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Task {
    pub id: String,
    pub kind: TaskKind,
    /// The shell command or the subagent description, when known.
    pub command: Option<String>,
    /// Start time in Unix milliseconds, when the log has it.
    pub started: Option<i64>,
}

/// The running background tasks of one session, oldest first.
#[derive(Debug, Default, Clone)]
pub struct Tracker {
    tasks: VecDeque<Task>,
}

impl Tracker {
    /// Records a started task. A second start of the same id replaces the first.
    pub fn start(&mut self, task: Task) {
        self.tasks.retain(|t| t.id != task.id);
        self.tasks.push_back(task);
        while self.tasks.len() > TASK_CAP {
            self.tasks.pop_front();
        }
    }

    /// Records the end of a task. An unknown id does nothing.
    pub fn end(&mut self, id: &str) {
        self.tasks.retain(|t| t.id != id);
    }

    /// Forgets every task, for example when the session starts again.
    pub fn reset(&mut self) {
        self.tasks.clear();
    }

    /// The tasks that still run at `now` (Unix ms). A task older than [`STALE_MS`] has ended.
    /// A task that started before `agent_start` (Unix ms) has ended too: the agent process
    /// started again, and its old shells stopped with the old process.
    pub fn running(&self, now: i64, agent_start: Option<i64>) -> Vec<&Task> {
        self.tasks
            .iter()
            .filter(|t| match t.started {
                Some(s) => now - s < STALE_MS && agent_start.is_none_or(|a| s >= a),
                None => true,
            })
            .collect()
    }

    /// The running tasks as the preview field, or None when nothing runs.
    pub fn info(&self, now: i64, agent_start: Option<i64>) -> Option<BackgroundInfo> {
        let running = self.running(now, agent_start);
        let shells: Vec<&&Task> = running.iter().filter(|t| t.kind == TaskKind::Shell).collect();
        let agents = running.iter().filter(|t| t.kind == TaskKind::Subagent).count() as u32;
        if shells.is_empty() && agents == 0 {
            return None;
        }
        // The newest commands first: they are the most likely to matter now.
        let commands = shells
            .iter()
            .rev()
            .filter_map(|t| t.command.as_deref())
            .map(short_command)
            .filter(|c| !c.is_empty())
            .take(COMMANDS_SENT)
            .collect();
        Some(BackgroundInfo { count: shells.len() as u32, commands, agents })
    }

    /// True when no task is kept.
    pub fn is_empty(&self) -> bool {
        self.tasks.is_empty()
    }
}

/// A command on one line, cut to [`COMMAND_CAP`] chars ("…" at the cut).
pub fn short_command(cmd: &str) -> String {
    let joined = cmd.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.chars().count() <= COMMAND_CAP {
        return joined;
    }
    let mut t: String = joined.chars().take(COMMAND_CAP - 1).collect();
    t.truncate(t.trim_end().len());
    t.push('…');
    t
}

/// Turns the lines of one agent's log into tracker changes.
pub trait LineFeed: Default + Send {
    /// Applies one complete log line.
    fn feed(&mut self, tracker: &mut Tracker, line: &str);
}

/// Background tasks of one log file, read step by step.
pub struct BackgroundLog<F: LineFeed> {
    path: PathBuf,
    offset: u64,
    started: bool,
    pub tracker: Tracker,
    feed: F,
}

impl<F: LineFeed> BackgroundLog<F> {
    pub fn new(path: &Path) -> Self {
        BackgroundLog { path: path.to_path_buf(), offset: 0, started: false, tracker: Tracker::default(), feed: F::default() }
    }

    /// The log this state belongs to. A new log path (a new session) needs a new state.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Reads the complete lines that were added since the last call. The first call reads
    /// only the last [`SCAN_BYTES`] of the log. A log that got shorter starts again.
    pub fn update(&mut self) -> io::Result<()> {
        let mut f = File::open(&self.path)?;
        let len = f.metadata()?.len();
        if len < self.offset {
            self.reset();
        }
        let mut skip_partial = false;
        if !self.started {
            self.started = true;
            self.offset = len.saturating_sub(SCAN_BYTES);
            skip_partial = self.offset > 0;
        }
        if len == self.offset {
            return Ok(());
        }
        f.seek(SeekFrom::Start(self.offset))?;
        let mut buf = Vec::with_capacity((len - self.offset) as usize);
        f.take(len - self.offset).read_to_end(&mut buf)?;
        let mut from = 0;
        if skip_partial {
            // The window starts inside a line. Drop it.
            match buf.iter().position(|c| *c == b'\n') {
                Some(i) => from = i + 1,
                None => return Ok(()),
            }
        }
        // A line still being written stays for the next call.
        let Some(end) = buf.iter().rposition(|c| *c == b'\n') else { return Ok(()) };
        if end < from {
            return Ok(());
        }
        for line in String::from_utf8_lossy(&buf[from..=end]).lines() {
            if !line.trim().is_empty() {
                self.feed.feed(&mut self.tracker, line);
            }
        }
        self.offset += end as u64 + 1;
        Ok(())
    }

    fn reset(&mut self) {
        self.offset = 0;
        self.started = true;
        self.tracker.reset();
        self.feed = F::default();
    }
}

/// Keeps a bounded map from a call id to a value, oldest dropped first. Adapters use it to
/// remember calls until their results arrive.
#[derive(Debug, Clone)]
pub struct Pending<V> {
    map: HashMap<String, V>,
    order: VecDeque<String>,
    cap: usize,
}

impl<V> Pending<V> {
    pub fn new(cap: usize) -> Self {
        Pending { map: HashMap::new(), order: VecDeque::new(), cap }
    }

    pub fn insert(&mut self, id: String, v: V) {
        if self.map.insert(id.clone(), v).is_none() {
            self.order.push_back(id);
        }
        while self.order.len() > self.cap {
            if let Some(old) = self.order.pop_front() {
                self.map.remove(&old);
            }
        }
    }

    pub fn take(&mut self, id: &str) -> Option<V> {
        let v = self.map.remove(id)?;
        self.order.retain(|o| o != id);
        Some(v)
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}
