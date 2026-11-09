//! `herdr.update`: updates herdr (the terminal workspace) on this computer for the phone.
//!
//! The phone sends no command text. herdlingd runs exactly `<herdr> update --handoff`, without a
//! shell. `--handoff` makes herdr try a live handoff to the new server, so the panes can keep
//! running. `herdr update` refuses to run inside a herdr session, so the child gets no herdr
//! session variables. The rpc process runs from sshd with a short PATH, so herdlingd searches the
//! usual install folders for the binary.
//!
//! The rules (argv, environment, version text, result) are pure functions. The process runner
//! is a parameter: tests never run a real herdr.

use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use crate::types::{HerdrUpdate, RpcError};

/// The program name.
pub const BIN: &str = "herdr";
/// The arguments of the update. herdlingd adds nothing from the phone.
pub const UPDATE_ARGS: &[&str] = &["update", "--handoff"];
/// The arguments of the version check.
pub const VERSION_ARGS: &[&str] = &["--version"];
/// Longest wait for `herdr update`: a download, an install and a live handoff.
pub const UPDATE_TIMEOUT: Duration = Duration::from_secs(180);
/// Longest wait for `herdr --version`.
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
/// Most bytes of output in the result. herdlingd keeps the end: it has the outcome.
pub const OUTPUT_LIMIT: usize = 16 * 1024;
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

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

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

/// What the output says about the live handoff.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Handoff {
    /// "live handoff complete": the panes moved to the new server.
    Complete,
    /// "live handoff failed": the old server keeps running, or herdr restarts.
    Failed,
    /// No handoff line.
    None,
}

impl Handoff {
    pub fn as_str(self) -> &'static str {
        match self {
            Handoff::Complete => "complete",
            Handoff::Failed => "failed",
            Handoff::None => "none",
        }
    }
}

/// Reads the handoff outcome from the herdr output. A failure line wins over a success line.
pub fn handoff_of(output: &str) -> Handoff {
    let o = output.to_ascii_lowercase();
    if o.contains("live handoff failed") || o.contains("failed handoff") {
        Handoff::Failed
    } else if o.contains("live handoff complete") {
        Handoff::Complete
    } else {
        Handoff::None
    }
}

/// True when herdr says that a package manager (Homebrew, mise or Nix) owns the install.
pub fn is_managed(output: &str) -> bool {
    output.to_ascii_lowercase().contains("self-update is disabled")
}

/// True when herdr says that it is already up to date.
pub fn says_up_to_date(output: &str) -> bool {
    output.to_ascii_lowercase().contains("already up to date")
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

/// Everything `herdr.update` needs. Pass a fake runner in tests.
#[derive(Clone)]
pub struct HerdrUpdateCtx {
    /// The folder of the lock file `herdr-update.lock`.
    pub lock_dir: PathBuf,
    /// The folders searched for `herdr`, see [`search_dirs`].
    pub dirs: Vec<PathBuf>,
    /// The environment of this process. The child gets [`child_env`] of it.
    pub env: Vec<(OsString, OsString)>,
    pub runner: Arc<dyn HerdrRunner>,
    pub timeout: Duration,
    /// Finds `herdr` in `dirs`. Production: [`find`].
    pub finder: fn(&[PathBuf]) -> Option<PathBuf>,
}

impl HerdrUpdateCtx {
    /// The real values for this process.
    pub fn new(home: &Path) -> HerdrUpdateCtx {
        HerdrUpdateCtx {
            lock_dir: crate::config::default_path(home).parent().map(Path::to_path_buf).unwrap_or_else(|| home.join(".config/herdling")),
            dirs: search_dirs(home, std::env::var_os("PATH").as_deref()),
            env: std::env::vars_os().collect(),
            runner: Arc::new(SystemHerdrRunner),
            timeout: UPDATE_TIMEOUT,
            finder: find,
        }
    }
}

/// Holds `herdr-update.lock` while an update runs.
pub struct UpdateLock(#[allow(dead_code)] fs::File);

/// Takes the lock of `dir`. The error `busy` when another update holds it.
pub fn take_lock(dir: &Path) -> Result<UpdateLock, RpcError> {
    let io = |e: std::io::Error| err("io_error", format!("herdr update lock: {e}"));
    // The folder holds the config and the pairing window: only this user may list it.
    std::os::unix::fs::DirBuilderExt::mode(fs::DirBuilder::new().recursive(true), 0o700).create(dir).map_err(io)?;
    let file = std::os::unix::fs::OpenOptionsExt::mode(fs::OpenOptions::new().create(true).truncate(false).write(true), 0o600)
        .open(dir.join("herdr-update.lock"))
        .map_err(io)?;
    match fs4::fs_std::FileExt::try_lock_exclusive(&file) {
        Ok(true) => Ok(UpdateLock(file)),
        Ok(false) => Err(err("busy", "a herdr update is already running on this computer")),
        Err(e) => Err(io(e)),
    }
}

/// The last lines of `output` for an error message.
fn tail_for_message(output: &str) -> String {
    let t = cap_tail(output.trim(), 600);
    if t.is_empty() { String::new() } else { format!(": {t}") }
}

/// Turns the run of `herdr update` into the result or an error. `from` and `to` are the versions
/// before and after (None when `herdr --version` gave none).
pub fn shape(from: Option<String>, to: Option<String>, run: &RunOut) -> Result<HerdrUpdate, RpcError> {
    let output = run.combined();
    match &run.exit {
        Exit::SpawnFailed(e) => return Err(err("command_failed", format!("herdr update did not start: {e}"))),
        Exit::TimedOut => {
            return Err(err(
                "timeout",
                format!("herdr update ran longer than the time limit and was stopped{}", tail_for_message(&output)),
            ))
        }
        Exit::Exited { success: false, code } => {
            if is_managed(&output) {
                return Err(err(
                    "managed_install",
                    format!("herdr is installed with a package manager. Update it there{}", tail_for_message(&output)),
                ));
            }
            let code = code.map(|c| c.to_string()).unwrap_or_else(|| "a signal".into());
            return Err(err("command_failed", format!("herdr update exited with {code}{}", tail_for_message(&output))));
        }
        Exit::Exited { success: true, .. } => {}
    }
    // Some versions can print the package manager line and still exit with 0.
    if is_managed(&output) {
        return Err(err("managed_install", format!("herdr is installed with a package manager. Update it there{}", tail_for_message(&output))));
    }
    let same = matches!((&from, &to), (Some(a), Some(b)) if a == b);
    let status = if says_up_to_date(&output) || same { "up_to_date" } else { "updated" };
    Ok(HerdrUpdate {
        from,
        to,
        status: status.into(),
        handoff: handoff_of(&output).as_str().into(),
        output: cap_tail(&output, OUTPUT_LIMIT),
    })
}

fn version_of(ctx: &HerdrUpdateCtx, bin: &Path, env: &[(OsString, OsString)]) -> Option<String> {
    let r = ctx.runner.run(bin, VERSION_ARGS, env, VERSION_TIMEOUT);
    match r.exit {
        Exit::Exited { success: true, .. } => parse_version(&r.stdout),
        _ => None,
    }
}

/// `herdr.update`: finds herdr, takes the lock, reads the version, runs `herdr update --handoff`,
/// reads the version again and shapes the result. Blocking: call it from a blocking task.
pub fn run(ctx: &HerdrUpdateCtx) -> Result<HerdrUpdate, RpcError> {
    let bin = (ctx.finder)(&ctx.dirs).ok_or_else(|| err("not_installed", "herdr is not installed on this computer, or not in PATH, ~/.local/bin, ~/.cargo/bin, /opt/homebrew/bin or /usr/local/bin"))?;
    let _lock = take_lock(&ctx.lock_dir)?;
    let env = child_env(ctx.env.iter().cloned(), &ctx.dirs);
    let from = version_of(ctx, &bin, &env);
    let r = ctx.runner.run(&bin, UPDATE_ARGS, &env, ctx.timeout);
    let to = version_of(ctx, &bin, &env);
    shape(from, to, &r)
}
