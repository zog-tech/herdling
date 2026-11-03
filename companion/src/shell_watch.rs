//! "Notify me when it finishes" for a shell pane. The phone asks for a watch (`shell.watch`).
//! `serve` asks herdr for `pane.process_info` of each watched pane every few seconds. When the
//! pane goes from busy (another process in the foreground) to idle (the shell in the foreground),
//! `serve` sends one push and removes the watch.
//!
//! Each SSH connection runs its own `rpc` process, so the watches go through a file
//! (folder 0700, file 0600, a lock file and an atomic rename). The rules here are pure: the
//! caller passes the time and the process info.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A watch ends after this time, also when the command did not finish.
pub const WATCH_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// `serve` checks the watched panes at this interval.
pub const POLL: Duration = Duration::from_secs(3);
/// At most this many watches. A new watch drops the oldest one.
pub const MAX_WATCHES: usize = 32;
/// The push body shows at most this many characters of the command.
pub const MAX_COMMAND: usize = 80;
/// The longest pane id or device id that a watch accepts, in bytes.
pub const MAX_ID: usize = 256;

/// One watched pane.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Watch {
    pub pane_id: String,
    /// Unix seconds of `shell.watch`. With `pane_id`, it identifies the watch.
    pub since: u64,
    /// The device that asked. Only that device gets the push. `None`: every device.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    /// The command line of the foreground process at the last busy check.
    /// `None` until a check finds the pane busy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub busy: Option<String>,
    /// The folder of that process, if herdr gives it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

impl Watch {
    /// Unix seconds when the watch ends.
    pub fn expires_at(&self) -> u64 {
        self.since.saturating_add(WATCH_TTL.as_secs())
    }

    pub fn expired(&self, now: u64) -> bool {
        now >= self.expires_at()
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct WatchFile {
    #[serde(default)]
    watches: Vec<Watch>,
}

/// What one check of a pane found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Probe {
    /// herdr does not know the pane: it closed.
    Gone,
    /// herdr did not answer, or did not give the shell and the foreground group.
    Unknown,
    /// The shell is in the foreground.
    Idle,
    /// Another process is in the foreground.
    Busy { command: String, cwd: Option<String> },
}

/// What to do with a watch after a check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// No change.
    Keep,
    /// Save the new state of the watch.
    Update(Watch),
    /// Remove the watch without a push (the pane closed or the watch expired).
    Drop,
    /// The command finished: send one push and remove the watch.
    Finished { command: String, cwd: Option<String> },
}

/// `~/.local/state/herdling/shell-watches.json`.
pub fn path(home: &Path) -> PathBuf {
    home.join(".local/state/herdling/shell-watches.json")
}

fn str_of<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

/// The check result from the inner object of a herdr `pane.process_info` reply.
/// The command is the `cmdline` of the group leader, else its `argv`, else its name.
pub fn probe(info: &Value) -> Probe {
    let pid = |k: &str| info.get(k).and_then(Value::as_u64);
    let (Some(shell), Some(fg)) = (pid("shell_pid"), pid("foreground_process_group_id")) else {
        return Probe::Unknown;
    };
    if fg == shell {
        return Probe::Idle;
    }
    let procs: &[Value] = info.get("foreground_processes").and_then(Value::as_array).map_or(&[], Vec::as_slice);
    let leader = procs.iter().find(|p| p.get("pid").and_then(Value::as_u64) == Some(fg)).or(procs.first());
    let command = leader
        .and_then(|p| {
            str_of(p, "cmdline").map(String::from).or_else(|| {
                let argv: Vec<&str> = p.get("argv")?.as_array()?.iter().filter_map(Value::as_str).collect();
                Some(argv.join(" ")).filter(|s| !s.trim().is_empty())
            })
        })
        .or_else(|| leader.and_then(|p| str_of(p, "name")).map(String::from))
        .unwrap_or_default();
    Probe::Busy { command, cwd: leader.and_then(|p| str_of(p, "cwd")).map(String::from) }
}

/// The next step for `w` after the check `p` at `now`. Busy to idle gives `Finished`.
/// A pane that is idle and was never seen busy keeps its watch: the command has not started yet.
pub fn step(w: &Watch, p: &Probe, now: u64) -> Step {
    if w.expired(now) {
        return Step::Drop;
    }
    match p {
        Probe::Gone => Step::Drop,
        Probe::Unknown => Step::Keep,
        Probe::Idle => match &w.busy {
            Some(command) => Step::Finished { command: command.clone(), cwd: w.cwd.clone() },
            None => Step::Keep,
        },
        Probe::Busy { command, cwd } => {
            // An empty command line keeps the last known one.
            let command = if command.is_empty() { w.busy.clone().unwrap_or_default() } else { command.clone() };
            let cwd = cwd.clone().or_else(|| w.cwd.clone());
            if w.busy.as_deref() == Some(command.as_str()) && w.cwd == cwd {
                return Step::Keep;
            }
            Step::Update(Watch { busy: Some(command), cwd, ..w.clone() })
        }
    }
}

/// The command for the push body: one line, white space joined, at most [`MAX_COMMAND`] characters.
pub fn short_command(command: &str) -> String {
    let one = command.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() <= MAX_COMMAND {
        return one;
    }
    let mut cut: String = one.chars().take(MAX_COMMAND - 1).collect();
    cut.truncate(cut.trim_end().len());
    cut.push('…');
    cut
}

/// The last part of a folder path, for example `proj` for `/home/sam/proj/`.
pub fn folder_tail(folder: &str) -> Option<&str> {
    folder.trim_end_matches('/').rsplit('/').next().filter(|s| !s.is_empty())
}

/// The push title and body: "<folder tail>: command finished" and the short command.
/// Without a folder the title is "Terminal: command finished".
pub fn push_text(folder: Option<&str>, command: &str) -> (String, String) {
    let tail = folder.and_then(folder_tail).unwrap_or("Terminal");
    (format!("{tail}: command finished"), short_command(command))
}

fn open_private(path: &Path, truncate: bool) -> std::io::Result<File> {
    OpenOptions::new().create(true).write(true).truncate(truncate).mode(0o600).open(path)
}

/// Reads the watch file under an exclusive lock, applies `f` to the live watches, and writes the
/// file back when `f` returns true in its pair. Expired watches are dropped.
fn with_watches<T>(path: &Path, now: u64, f: impl FnOnce(&mut Vec<Watch>) -> (T, bool)) -> std::io::Result<T> {
    let dir = path.parent().ok_or_else(|| std::io::Error::other("watch path has no parent"))?;
    fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    let lock = open_private(&path.with_extension("json.lock"), false)?;
    fs4::fs_std::FileExt::lock_exclusive(&lock)?;
    let mut file: WatchFile = match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => WatchFile::default(),
        Err(e) => return Err(e),
    };
    let before = file.watches.len();
    file.watches.retain(|w| !w.expired(now));
    let (out, changed) = f(&mut file.watches);
    if changed || file.watches.len() != before {
        let tmp = path.with_extension(format!("json.tmp{}", std::process::id()));
        let mut w = open_private(&tmp, true)?;
        w.write_all(serde_json::to_string(&file).map_err(std::io::Error::other)?.as_bytes())?;
        w.sync_all()?;
        fs::rename(&tmp, path)?;
    }
    Ok(out)
}

/// Adds a watch for `pane`. A watch of the same pane is replaced. Drops the oldest watches
/// above [`MAX_WATCHES`].
pub fn add(path: &Path, pane: &str, device_id: Option<&str>, now: u64) -> std::io::Result<Watch> {
    let w = Watch { pane_id: pane.to_string(), since: now, device_id: device_id.map(String::from), busy: None, cwd: None };
    with_watches(path, now, |ws| {
        ws.retain(|x| x.pane_id != pane);
        ws.push(w.clone());
        ws.sort_by_key(|x| x.since);
        let extra = ws.len().saturating_sub(MAX_WATCHES);
        ws.drain(..extra);
        ((), true)
    })?;
    Ok(w)
}

/// Removes the watch of `pane`. Returns true when it was live.
pub fn remove(path: &Path, pane: &str, now: u64) -> std::io::Result<bool> {
    with_watches(path, now, |ws| {
        let before = ws.len();
        ws.retain(|w| w.pane_id != pane);
        let removed = ws.len() != before;
        (removed, removed)
    })
}

/// The live watches. A missing file gives none and creates nothing.
pub fn list(path: &Path, now: u64) -> std::io::Result<Vec<Watch>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    with_watches(path, now, |ws| (ws.clone(), false))
}

/// Saves the results of one round of checks. Each item is the watch as it was read, and its new
/// state (`None` removes it). A watch that changed in the meantime (for example a new
/// `shell.watch` of the same pane) is left alone. Returns, per item, true when it applied.
pub fn apply(path: &Path, now: u64, results: &[(Watch, Option<Watch>)]) -> std::io::Result<Vec<bool>> {
    with_watches(path, now, |ws| {
        let mut changed = false;
        let applied = results
            .iter()
            .map(|(old, new)| {
                let Some(i) = ws.iter().position(|w| w.pane_id == old.pane_id && w.since == old.since) else {
                    return false;
                };
                match new {
                    Some(n) => ws[i] = n.clone(),
                    None => {
                        ws.remove(i);
                    }
                }
                changed = true;
                true
            })
            .collect();
        (applied, changed)
    })
}
