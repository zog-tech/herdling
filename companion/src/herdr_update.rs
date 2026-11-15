//! Process helpers for the programs that herdlingd runs on this computer: the search folders,
//! a clean child environment, the version text and a runner with a time limit. The herdr-core
//! install ([`crate::core_install`]) uses them, and the herdr 1 guard finds a `herdr` with them.
//!
//! herdlingd 0.1.x used this module for `herdr update` of herdr 1. herdlingd 0.2.0 has no herdr 1
//! update: `herdr.update` updates herdr-core.
//!
//! The rules are pure functions. The process runner is a parameter: tests never run a real program.

use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};


/// The program name of herdr 1.
pub const BIN: &str = "herdr";
/// The arguments of the version check.
pub const VERSION_ARGS: &[&str] = &["--version"];
/// Longest wait for `<program> --version`.
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
/// Most bytes read from each output stream. The rest is read and dropped, so the child never blocks.
const READ_LIMIT: usize = 256 * 1024;
/// How long to wait for the output pipes to close after the child exits. A server that herdr
/// starts can keep a copy of the pipe open.
const DRAIN_WAIT: Duration = Duration::from_secs(2);

/// herdr variables that are settings of the install, not of a session. The child keeps them.
/// Every other `HERDR_*` variable is removed: a session marker such as `HERDR_ENV`,
/// `HERDR_SESSION` or `HERDR_PANE_ID` makes `herdr update` refuse to run.
pub const KEEP_VARS: &[&str] = &["HERDR_HOME", "HERDR_CONFIG_PATH", "HERDR_INSTALL_DIR", "HERDR_CHANNEL"];

/// System folders that the PATH of the child always has, for the tools that herdr calls.
const SYSTEM_DIRS: &[&str] = &["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/// The folders searched for `herdr`, in order: every `PATH` entry, then `~/.local/bin`,
/// `~/.cargo/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. No duplicates.
pub fn search_dirs(home: &Path, path_env: Option<&OsStr>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = path_env
        .map(|p| std::env::split_paths(p).filter(|d| !d.as_os_str().is_empty()).collect())
        .unwrap_or_default();
    let extra = [home.join(".local/bin"), home.join(".cargo/bin"), PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")];
    for d in extra {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

fn executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(p).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

/// The first `herdr` in `dirs` that `is_exec` accepts.
pub fn find_with(dirs: &[PathBuf], is_exec: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    dirs.iter().map(|d| d.join(BIN)).find(|p| is_exec(p))
}

/// The first executable `herdr` file in `dirs`.
pub fn find(dirs: &[PathBuf]) -> Option<PathBuf> {
    find_with(dirs, executable)
}

/// True for a variable that the child must not get: a `HERDR_*` name not in [`KEEP_VARS`].
pub fn is_session_var(name: &OsStr) -> bool {
    let Some(n) = name.to_str() else { return false };
    n.starts_with("HERDR_") && !KEEP_VARS.contains(&n)
}

/// The full environment of the child: `vars` without the herdr session variables, and a `PATH`
/// of `dirs` and the system folders.
pub fn child_env(vars: impl IntoIterator<Item = (OsString, OsString)>, dirs: &[PathBuf]) -> Vec<(OsString, OsString)> {
    let mut out: Vec<(OsString, OsString)> =
        vars.into_iter().filter(|(k, _)| !is_session_var(k) && k.as_os_str() != OsStr::new("PATH")).collect();
    let mut path: Vec<PathBuf> = dirs.to_vec();
    for s in SYSTEM_DIRS {
        let p = PathBuf::from(s);
        if !path.contains(&p) {
            path.push(p);
        }
    }
    if let Ok(joined) = std::env::join_paths(&path) {
        out.push(("PATH".into(), joined));
    }
    out
}

/// The version in the output of `herdr --version` (`herdr 0.9.5` gives `0.9.5`). A leading `v`
/// is removed. None when the first line has no version.
pub fn parse_version(stdout: &str) -> Option<String> {
    let line = stdout.lines().map(str::trim).find(|l| !l.is_empty())?;
    let word = line.split_whitespace().last()?;
    let v = word.strip_prefix('v').unwrap_or(word);
    crate::update::parse_version(v).map(|_| v.to_string())
}

/// The last `limit` bytes of `s`, cut at a character boundary, with a mark when text is cut.
pub fn cap_tail(s: &str, limit: usize) -> String {
    if s.len() <= limit {
        return s.to_string();
    }
    let mut start = s.len() - limit;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &s[start..])
}

/// How one run of herdr ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Exit {
    /// The process exited. `success` is true for exit code 0.
    Exited { success: bool, code: Option<i32> },
    /// The process ran longer than the timeout and was stopped.
    TimedOut,
    /// The process did not start.
    SpawnFailed(String),
}

/// The result of one run: how it ended, and stdout and stderr as text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOut {
    pub exit: Exit,
    pub stdout: String,
    pub stderr: String,
}

impl RunOut {
    /// stdout, then stderr, trimmed.
    pub fn combined(&self) -> String {
        let (a, b) = (self.stdout.trim(), self.stderr.trim());
        match (a.is_empty(), b.is_empty()) {
            (true, _) => b.to_string(),
            (_, true) => a.to_string(),
            _ => format!("{a}\n{b}"),
        }
    }
}

/// Runs herdr. Tests pass a fake.
pub trait HerdrRunner: Send + Sync {
    /// Runs `bin` with `args` and exactly the environment `env`, bounded by `timeout`.
    fn run(&self, bin: &Path, args: &[&str], env: &[(OsString, OsString)], timeout: Duration) -> RunOut;
}

/// The real runner: no shell, no stdin, its own process group.
pub struct SystemHerdrRunner;

/// Reads `r` to the end. Keeps at most [`READ_LIMIT`] bytes in `buf`.
fn drain(mut r: impl Read, buf: Arc<Mutex<Vec<u8>>>, done: mpsc::Sender<()>) {
    let mut chunk = [0u8; 8192];
    loop {
        match r.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if let Ok(mut b) = buf.lock() {
                    let room = READ_LIMIT.saturating_sub(b.len());
                    b.extend_from_slice(&chunk[..n.min(room)]);
                }
            }
        }
    }
    let _ = done.send(());
}

impl HerdrRunner for SystemHerdrRunner {
    fn run(&self, bin: &Path, args: &[&str], env: &[(OsString, OsString)], timeout: Duration) -> RunOut {
        use std::os::unix::process::CommandExt;
        let spawned = Command::new(bin)
            .args(args)
            .env_clear()
            .envs(env.iter().map(|(k, v)| (k, v)))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // A signal to the group of the rpc process must not reach the update.
            .process_group(0)
            .spawn();
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => return RunOut { exit: Exit::SpawnFailed(e.to_string()), stdout: String::new(), stderr: String::new() },
        };
        let (out_buf, err_buf) = (Arc::new(Mutex::new(Vec::new())), Arc::new(Mutex::new(Vec::new())));
        let (tx, rx) = mpsc::channel();
        let mut readers = 0;
        if let Some(so) = child.stdout.take() {
            let (b, t) = (out_buf.clone(), tx.clone());
            std::thread::spawn(move || drain(so, b, t));
            readers += 1;
        }
        if let Some(se) = child.stderr.take() {
            let (b, t) = (err_buf.clone(), tx.clone());
            std::thread::spawn(move || drain(se, b, t));
            readers += 1;
        }
        drop(tx);
        let end = Instant::now() + timeout;
        let exit = loop {
            match child.try_wait() {
                Ok(Some(st)) => break Exit::Exited { success: st.success(), code: st.code() },
                Ok(None) if Instant::now() >= end => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Exit::TimedOut;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(e) => break Exit::SpawnFailed(e.to_string()),
            }
        };
        // Wait a short time for the pipes. A server that herdr started can hold them open.
        let drain_end = Instant::now() + DRAIN_WAIT;
        for _ in 0..readers {
            let left = drain_end.saturating_duration_since(Instant::now());
            if rx.recv_timeout(left).is_err() {
                break;
            }
        }
        let text = |b: &Arc<Mutex<Vec<u8>>>| b.lock().map(|v| String::from_utf8_lossy(&v).into_owned()).unwrap_or_default();
        RunOut { exit, stdout: text(&out_buf), stderr: text(&err_buf) }
    }
}
