//! Install, update and status of herdr-core (Herdr 2) on this computer: `core.status`,
//! `core.install`, `herdlingd core`, and the core step of `update.apply` and the installer.
//!
//! herdlingd installs the pinned version ([`pin`]) the way the upstream installer does
//! (`https://releases.herdr.dev/core/install.sh`), but it checks the SHA-256 against the pin in
//! this binary first. It never downgrades and never replaces a core of a package manager. The
//! core runs as its own service (systemd user service on Linux, a launchd job on macOS): herdlingd
//! only starts it with `herdr-core server start` when no core answers.
//!
//! The rules are in the pure [`machine`] and [`guard`]. [`drive`] runs the flow with a [`CoreIo`].
//! [`SystemCoreIo`] is the real I/O; processes, the download and the socket probe come from
//! [`CoreInstallCtx`], so tests pass fakes and never download or touch a live core.

pub mod guard;
pub mod machine;
pub mod pin;

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::herdr_update::{self, Exit, HerdrRunner, RunOut};
use crate::types::{CoreInstall, CoreStatus, HerdrUpdate, RpcError};
use machine::{Effect, Found, Input, Outcome, Plan, PlaceMode, State, Step, Where};
use pin::CorePin;

/// The program name of herdr-core.
pub const BIN: &str = "herdr-core";
/// Largest accepted core tarball (about 15 MB in 0.1.20).
pub const DOWNLOAD_LIMIT: usize = 128 << 20;
/// The longest whole install: download, place, start and checks. The app waits 180 s for
/// `core.install` and `herdr.update`, so its answer always comes first from herdlingd.
pub const INSTALL_BUDGET: Duration = Duration::from_secs(150);
/// The least time left for the place. With less, the install stops before it: a place that is
/// cut off could leave a half-written core.
pub const PLACE_MIN: Duration = Duration::from_secs(60);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const PLACE_TIMEOUT: Duration = Duration::from_secs(120);
const START_TIMEOUT: Duration = Duration::from_secs(30);
/// Variables of a core terminal. A child started from inside one must not act for it.
const TERMINAL_VARS: &[&str] = &["HC_TERMINAL_ID", "HC_TERMINAL_SOCKET"];

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

/// Downloads a URL and returns the body. Tests pass a fake.
pub type Fetch = Arc<dyn Fn(&str) -> Result<Vec<u8>, String> + Send + Sync>;
/// Asks the core socket. `true`: wait some seconds for a core that just started. Returns the
/// version of the running core (empty when it says none), or None when no core answers.
pub type Probe = Arc<dyn Fn(bool) -> Option<String> + Send + Sync>;

/// Everything the core install needs. Pass fakes in tests.
#[derive(Clone)]
pub struct CoreInstallCtx {
    pub home: PathBuf,
    /// The folders searched for `herdr-core`, `herdr` and `hc` (see [`herdr_update::search_dirs`]).
    pub dirs: Vec<PathBuf>,
    /// The environment of this process. Children get it without session variables.
    pub env: Vec<(OsString, OsString)>,
    pub runner: Arc<dyn HerdrRunner>,
    pub fetch: Fetch,
    pub probe: Probe,
    /// True on macOS.
    pub mac: bool,
    /// The upstream target of this computer. None: herdr-core has no build for it.
    pub target: Option<String>,
    /// The pin of this herdlingd.
    pub pin: CorePin,
    /// The folder of `core-install.lock`.
    pub lock_dir: PathBuf,
}

impl CoreInstallCtx {
    /// The real values for this process. Call it inside the tokio runtime: the download and the
    /// socket probe run on it. Call [`install`] and [`status`] from a blocking task.
    pub fn new(home: &Path, core_socket: Option<crate::core::endpoint::CoreSocket>) -> CoreInstallCtx {
        let handle = tokio::runtime::Handle::try_current().ok();
        let fh = handle.clone();
        let fetch: Fetch = Arc::new(move |url: &str| {
            // Only upstream release files. The URL is made from the pin, so this is a second check.
            if !url.starts_with(&format!("{}/", pin::RELEASES)) || url.contains(['?', '#', '%']) || url.contains("..") {
                return Err(format!("refused a download outside {}/", pin::RELEASES));
            }
            let h = fh.as_ref().ok_or("no async runtime")?;
            h.block_on(crate::update::download(url, DOWNLOAD_LIMIT)).map_err(|e| e.message)
        });
        let probe: Probe = Arc::new(move |wait: bool| {
            let (h, sock) = (handle.as_ref()?, core_socket.as_ref()?);
            let tries = if wait { 20 } else { 1 };
            for i in 0..tries {
                if let Some(info) = h.block_on(crate::core::live::backend_info(sock, Duration::from_secs(3))) {
                    return Some(info.get("version").and_then(serde_json::Value::as_str).unwrap_or("").to_string());
                }
                if i + 1 < tries {
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
            None
        });
        CoreInstallCtx {
            home: home.to_path_buf(),
            dirs: herdr_update::search_dirs(home, std::env::var_os("PATH").as_deref()),
            env: std::env::vars_os().collect(),
            runner: Arc::new(herdr_update::SystemHerdrRunner),
            fetch,
            probe,
            mac: cfg!(target_os = "macos"),
            target: pin::target(std::env::consts::OS, std::env::consts::ARCH).map(String::from),
            pin: pin::embedded(),
            lock_dir: crate::config::default_path(home).parent().map(Path::to_path_buf).unwrap_or_else(|| home.join(".config/herdling")),
        }
    }

    /// `~/.local/bin/herdr-core`: the place of the upstream installer and of herdlingd.
    pub fn dest(&self) -> PathBuf {
        self.home.join(".local/bin").join(BIN)
    }

    /// The environment of a child: no herdr or core terminal variables, and a full PATH.
    fn child_env(&self) -> Vec<(OsString, OsString)> {
        let vars = self.env.iter().filter(|(k, _)| !TERMINAL_VARS.iter().any(|t| k.as_os_str() == *t)).cloned();
        herdr_update::child_env(vars, &self.dirs)
    }
}

/// The I/O of the install flow. Each function answers one [`Effect`].
pub trait CoreIo {
    fn find_installed(&mut self) -> Found;
    /// Downloads `url` into the stage folder. Returns its SHA-256 (lower-case hex).
    fn download(&mut self, url: &str) -> Result<String, String>;
    /// Unpacks the download. True when it has `Herdr Core.app`.
    fn unpack(&mut self) -> Result<bool, String>;
    /// Runs the unpacked core with `--version`. Returns the version it says.
    fn check_unpacked(&mut self) -> Result<Option<String>, String>;
    fn place(&mut self, mode: PlaceMode) -> Result<(), String>;
    fn running(&mut self, wait: bool) -> Option<String>;
    fn start(&mut self) -> Result<(), String>;
    /// The time left of the install budget. None: no deadline.
    fn left(&self) -> Option<Duration> {
        None
    }
}

/// The error when the install budget is used up before `effect`. Before the place nothing
/// changed; after it the core is there but may not run yet.
fn out_of_time(effect: Effect, placed: bool) -> RpcError {
    let secs = INSTALL_BUDGET.as_secs();
    let message = if placed {
        format!("herdr-core is installed, but the install ran out of time ({secs} s) before it was sure that the core runs. Look again in a minute")
    } else {
        format!("the herdr-core install ran out of time ({secs} s) before the step {effect:?}. Nothing was installed. Try again")
    };
    err("install_timeout", message)
}

/// Most steps of one flow. The longest flow has 9.
const MAX_STEPS: usize = 32;

/// Runs the flow of [`machine::step`] with `io`. `url` is the download of the pin.
pub fn drive(plan: &Plan, url: &str, io: &mut dyn CoreIo) -> Result<Outcome, RpcError> {
    let (mut state, mut input) = (State::Begin, Input::Go);
    let mut placed = false;
    for _ in 0..MAX_STEPS {
        match machine::step(plan, state, input) {
            Step::Done(o) => return Ok(o),
            Step::Fail(f) => return Err(err(f.code, f.message)),
            Step::Next(next, effect) => {
                if let Some(left) = io.left() {
                    let need = if matches!(effect, Effect::Place(_)) { PLACE_MIN } else { Duration::from_millis(1) };
                    if left < need {
                        return Err(out_of_time(effect, placed));
                    }
                }
                placed |= matches!(effect, Effect::Place(_));
                input = match effect {
                    Effect::FindInstalled => Input::Installed(io.find_installed()),
                    Effect::Download => Input::Downloaded(io.download(url)),
                    Effect::Unpack => Input::Unpacked(io.unpack()),
                    Effect::CheckUnpacked => Input::Checked(io.check_unpacked()),
                    Effect::Place(mode) => Input::Placed(io.place(mode)),
                    Effect::ProbeRunning { wait } => Input::Running(io.running(wait)),
                    Effect::Start => Input::Started(io.start()),
                };
                state = next;
            }
        }
    }
    Err(err("internal", "the core install did not end"))
}

fn executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(p).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

/// The folder of the upstream macOS app bundle install. Its installer puts a symlink to the core
/// in this folder at `~/.local/bin/herdr-core`.
fn upstream_share(home: &Path) -> PathBuf {
    let home = home.canonicalize().unwrap_or_else(|_| home.to_path_buf());
    home.join(".local/share/herdr-core")
}

/// What `~/.local/bin/herdr-core` is. A plain executable file and a symlink into the upstream
/// bundle folder are ours. Any other symlink (Homebrew, Nix, a link that the user made) is
/// managed: herdlingd never replaces it, also when its target is gone. A broken link into the
/// upstream folder counts as no core. None: nothing usable is there.
fn classify_dest(dest: &Path, home: &Path) -> Option<Where> {
    let meta = fs::symlink_metadata(dest).ok()?;
    if !meta.file_type().is_symlink() {
        return executable(dest).then_some(Where::Ours);
    }
    let share = upstream_share(home);
    match dest.canonicalize() {
        Ok(target) if target.starts_with(&share) && executable(&target) => Some(Where::Ours),
        Ok(_) => Some(Where::Managed),
        Err(_) => {
            let raw = fs::read_link(dest).ok()?;
            let raw = if raw.is_absolute() { raw } else { dest.parent().map(|p| p.join(&raw)).unwrap_or(raw) };
            let into_share = raw.starts_with(&share) || raw.starts_with(home.join(".local/share/herdr-core"));
            (!into_share).then_some(Where::Managed)
        }
    }
}

/// Where the core is: `~/.local/bin/herdr-core` first (see [`classify_dest`]), else the first
/// `herdr-core` in `dirs`.
pub fn find_core(ctx: &CoreInstallCtx) -> Option<(Where, PathBuf)> {
    let dest = ctx.dest();
    if let Some(at) = classify_dest(&dest, &ctx.home) {
        return Some((at, dest));
    }
    ctx.dirs.iter().map(|d| d.join(BIN)).find(|p| *p != dest && executable(p)).map(|p| (Where::Managed, p))
}

/// True when herdr 1 (`herdr`) is on this computer.
pub fn herdr1_found(ctx: &CoreInstallCtx) -> bool {
    herdr_update::find(&ctx.dirs).is_some()
}

fn path_str(p: &Path) -> Result<&str, String> {
    p.to_str().ok_or_else(|| format!("the path {} is not UTF-8", p.display()))
}

/// The last lines of a run, for an error text.
fn run_text(r: &RunOut) -> String {
    let t = herdr_update::cap_tail(r.combined().trim(), 400);
    match &r.exit {
        Exit::SpawnFailed(e) => format!("did not start: {e}"),
        Exit::TimedOut => format!("ran longer than the time limit{}", if t.is_empty() { String::new() } else { format!(": {t}") }),
        Exit::Exited { code, .. } => {
            let code = code.map_or_else(|| "a signal".to_string(), |c| c.to_string());
            if t.is_empty() { format!("exited with {code}") } else { format!("exited with {code}: {t}") }
        }
    }
}

fn succeeded(r: &RunOut) -> bool {
    matches!(r.exit, Exit::Exited { success: true, .. })
}

/// Removes the folder when dropped.
struct Stage(PathBuf);

impl Drop for Stage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// The real I/O. The stage folder is `~/.cache/herdling/core.<pid>`: some systems mount `/tmp`
/// with `noexec`, and the unpacked core must run. It is removed at the end.
pub struct SystemCoreIo<'a> {
    ctx: &'a CoreInstallCtx,
    env: Vec<(OsString, OsString)>,
    stage: Option<Stage>,
    /// The core to start: the found one, or the one just placed.
    bin: Option<PathBuf>,
    bundle: bool,
    /// The end of the install budget ([`INSTALL_BUDGET`]).
    deadline: Instant,
}

/// Runs `f` on its own thread and waits at most `limit` for it. A late result is dropped (the
/// thread ends on its own timeout); it never changes the install after the answer.
fn within<T: Send + 'static>(limit: Duration, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(limit).ok()
}

impl<'a> SystemCoreIo<'a> {
    pub fn new(ctx: &'a CoreInstallCtx) -> SystemCoreIo<'a> {
        SystemCoreIo { ctx, env: ctx.child_env(), stage: None, bin: None, bundle: false, deadline: Instant::now() + INSTALL_BUDGET }
    }

    fn remaining(&self) -> Duration {
        self.deadline.saturating_duration_since(Instant::now())
    }

    /// Runs a process, bounded by its own `timeout` and by the install budget.
    fn run(&self, bin: &Path, args: &[&str], timeout: Duration) -> RunOut {
        self.ctx.runner.run(bin, args, &self.env, timeout.min(self.remaining().max(Duration::from_secs(1))))
    }

    fn version_of(&self, bin: &Path) -> Option<String> {
        let r = self.run(bin, herdr_update::VERSION_ARGS, VERSION_TIMEOUT);
        if succeeded(&r) { herdr_update::parse_version(&r.stdout) } else { None }
    }

    fn stage_dir(&self) -> Result<&Path, String> {
        self.stage.as_ref().map(|s| s.0.as_path()).ok_or_else(|| "no download".to_string())
    }

    fn unpacked(&self) -> Result<PathBuf, String> {
        let x = self.stage_dir()?.join("x");
        Ok(if self.bundle { x.join("Herdr Core.app").join(machine_bundle_exe()) } else { x.join(BIN) })
    }

    /// Adds `~/.local/bin/hc` → `herdr-core` when no `hc` exists, as the upstream installer does.
    fn link_hc(&self) {
        let bin = self.ctx.home.join(".local/bin");
        let link = bin.join("hc");
        if fs::symlink_metadata(&link).is_ok() || self.ctx.dirs.iter().any(|d| d.join("hc").exists()) {
            return;
        }
        let _ = std::os::unix::fs::symlink(BIN, &link);
    }
}

/// The executable inside `Herdr Core.app`.
fn machine_bundle_exe() -> &'static str {
    "Contents/MacOS/herdr-core"
}

impl CoreIo for SystemCoreIo<'_> {
    fn find_installed(&mut self) -> Found {
        match find_core(self.ctx) {
            None => Found { at: Where::Missing, version: None },
            Some((at, path)) => {
                let version = self.version_of(&path);
                self.bin = Some(path);
                Found { at, version }
            }
        }
    }

    fn download(&mut self, url: &str) -> Result<String, String> {
        // The place keeps its own time ([`PLACE_MIN`]).
        let limit = self.remaining().saturating_sub(PLACE_MIN);
        let (fetch, u) = (self.ctx.fetch.clone(), url.to_string());
        let body = within(limit, move || fetch(&u)).ok_or_else(|| format!("the download took longer than {} s", limit.as_secs()))??;
        let root = self.ctx.home.join(".cache/herdling");
        let dir = root.join(format!("core.{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        std::os::unix::fs::DirBuilderExt::mode(fs::DirBuilder::new().recursive(true), 0o700)
            .create(&dir)
            .map_err(|e| format!("create {}: {e}", dir.display()))?;
        self.stage = Some(Stage(dir.clone()));
        fs::write(dir.join("core.tar.gz"), &body).map_err(|e| format!("write the download: {e}"))?;
        Ok(crate::update::sha256_hex(&body))
    }

    fn unpack(&mut self) -> Result<bool, String> {
        let dir = self.stage_dir()?.to_path_buf();
        let x = dir.join("x");
        fs::create_dir(&x).map_err(|e| format!("create {}: {e}", x.display()))?;
        let out = std::process::Command::new("tar")
            .arg("-xzf")
            .arg(dir.join("core.tar.gz"))
            .arg("-C")
            .arg(&x)
            .output()
            .map_err(|e| format!("run tar: {e}"))?;
        if !out.status.success() {
            return Err(format!("tar failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }
        let plain = |p: &Path| fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_file());
        if !plain(&x.join(BIN)) {
            return Err("the tarball has no herdr-core file".into());
        }
        // The app bundle is only for a user install on macOS, as upstream does it.
        self.bundle = self.ctx.mac && plain(&x.join("Herdr Core.app").join(machine_bundle_exe()));
        Ok(self.bundle)
    }

    fn check_unpacked(&mut self) -> Result<Option<String>, String> {
        use std::os::unix::fs::PermissionsExt;
        let exe = self.unpacked()?;
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).map_err(|e| format!("chmod: {e}"))?;
        let r = self.run(&exe, herdr_update::VERSION_ARGS, VERSION_TIMEOUT);
        if !succeeded(&r) {
            return Err(run_text(&r));
        }
        Ok(herdr_update::parse_version(&r.stdout))
    }

    fn place(&mut self, mode: PlaceMode) -> Result<(), String> {
        use std::os::unix::fs::PermissionsExt;
        let dest = self.ctx.dest();
        let bin_dir = dest.parent().ok_or("no bin folder")?.to_path_buf();
        fs::create_dir_all(&bin_dir).map_err(|e| format!("create {}: {e}", bin_dir.display()))?;
        let new = self.unpacked()?;
        match mode {
            PlaceMode::Bundle { update } => {
                let (n, d) = (path_str(&new)?, path_str(&dest)?);
                let r = self.run(&new, &["--hc-install-bundle", n, d], PLACE_TIMEOUT);
                if !succeeded(&r) {
                    return Err(format!("Herdr Core.app install {}", run_text(&r)));
                }
                if update {
                    let r = self.run(&dest, &["server", "restart"], PLACE_TIMEOUT);
                    if !succeeded(&r) {
                        return Err(format!("herdr-core server restart {}", run_text(&r)));
                    }
                }
            }
            PlaceMode::SwapFrom => {
                let r = self.run(&dest, &["update", "--from", path_str(&new)?], PLACE_TIMEOUT);
                if !succeeded(&r) {
                    return Err(format!("herdr-core update --from {}", run_text(&r)));
                }
            }
            PlaceMode::Copy => {
                // Into a temp file beside the target, then one rename.
                let tmp = bin_dir.join(format!(".herdr-core.new.{}", std::process::id()));
                let copy = || -> std::io::Result<()> {
                    fs::copy(&new, &tmp)?;
                    fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
                    fs::rename(&tmp, &dest)
                };
                if let Err(e) = copy() {
                    let _ = fs::remove_file(&tmp);
                    return Err(format!("copy to {}: {e}", dest.display()));
                }
            }
        }
        self.link_hc();
        self.bin = Some(dest);
        Ok(())
    }

    fn running(&mut self, wait: bool) -> Option<String> {
        let probe = self.ctx.probe.clone();
        within(self.remaining(), move || probe(wait)).flatten()
    }

    fn start(&mut self) -> Result<(), String> {
        let bin = self.bin.clone().unwrap_or_else(|| self.ctx.dest());
        let r = self.run(&bin, &["server", "start"], START_TIMEOUT);
        if succeeded(&r) { Ok(()) } else { Err(run_text(&r)) }
    }

    fn left(&self) -> Option<Duration> {
        Some(self.remaining())
    }
}

/// Holds `core-install.lock` while an install runs.
pub struct InstallLock(#[allow(dead_code)] fs::File);

/// Takes the lock in `dir`. The error `busy` when another install holds it.
pub fn take_lock(dir: &Path) -> Result<InstallLock, RpcError> {
    let io = |e: std::io::Error| err("io_error", format!("core install lock: {e}"));
    std::os::unix::fs::DirBuilderExt::mode(fs::DirBuilder::new().recursive(true), 0o700).create(dir).map_err(io)?;
    let file = std::os::unix::fs::OpenOptionsExt::mode(fs::OpenOptions::new().create(true).truncate(false).write(true), 0o600)
        .open(dir.join("core-install.lock"))
        .map_err(io)?;
    match fs4::fs_std::FileExt::try_lock_exclusive(&file) {
        Ok(true) => Ok(InstallLock(file)),
        Ok(false) => Err(err("busy", "a herdr-core install is already running on this computer")),
        Err(e) => Err(io(e)),
    }
}

/// The plan and the URL of `pin` for this computer.
pub fn plan_for(ctx: &CoreInstallCtx, pin: &CorePin) -> Result<(Plan, String), RpcError> {
    if !pin.valid() {
        return Err(err("bad_pin", format!("the herdr-core pin {} is not valid", pin.version)));
    }
    let unsupported = || err("unsupported_target", "herdr-core has no build for this computer");
    let target = ctx.target.as_deref().ok_or_else(unsupported)?;
    let sha256 = pin.sha_for(target).ok_or_else(unsupported)?;
    Ok((Plan { pin: pin.version.clone(), sha256, mac: ctx.mac }, pin.url(target)))
}

/// `core.install`: installs `pin` when no core is installed, updates our core when it is older,
/// and makes sure that the core runs. Blocking: call it from a blocking task.
pub fn install(ctx: &CoreInstallCtx, pin: &CorePin) -> Result<CoreInstall, RpcError> {
    let (plan, url) = plan_for(ctx, pin)?;
    let _lock = take_lock(&ctx.lock_dir)?;
    let mut io = SystemCoreIo::new(ctx);
    let o = drive(&plan, &url, &mut io)?;
    Ok(CoreInstall { from: o.from, to: o.to, status: o.status.as_str().into(), started: o.started, pinned: plan.pin })
}

/// The status from the facts. Pure.
pub fn status_of(found: &Found, running: Option<String>, pin: &CorePin, target: Option<&str>, herdr1: bool) -> CoreStatus {
    use std::cmp::Ordering;
    let newer = |v: Option<&str>| v.and_then(|v| crate::update::compare_versions(v, &pin.version)) == Some(Ordering::Greater);
    let running_version = running.clone().filter(|v| !v.is_empty());
    let decision = machine::decide(found, &pin.version);
    let buildable = target.is_some_and(|t| pin.sha256.contains_key(t));
    CoreStatus {
        found: found.at != Where::Missing,
        installed: found.version.clone(),
        managed: found.at == Where::Managed,
        running: running.is_some(),
        newer_than_pin: newer(found.version.as_deref()) || newer(running_version.as_deref()),
        running_version,
        pinned: pin.version.clone(),
        update_available: buildable && matches!(decision, machine::Decision::Install | machine::Decision::Update),
        required: pin.required,
        target: target.map(String::from),
        herdr1,
    }
}

/// `core.status`. Only reads: it runs `herdr-core --version` and asks the socket. Blocking.
pub fn status(ctx: &CoreInstallCtx) -> CoreStatus {
    let mut io = SystemCoreIo::new(ctx);
    let found = io.find_installed();
    let running = io.running(false);
    status_of(&found, running, &ctx.pin, ctx.target.as_deref(), herdr1_found(ctx))
}

/// A `core.install` result in the shape of `herdr.update`, for old apps that call
/// `herdr.update` on a computer with herdr-core. Pure.
pub fn as_herdr_update(r: &CoreInstall) -> HerdrUpdate {
    let changed = r.status == "installed" || r.status == "updated";
    let output = match r.status.as_str() {
        "installed" => format!("herdr-core {} installed.", r.pinned),
        "updated" => format!("herdr-core updated to {}. Running terminals keep running.", r.pinned),
        "kept_newer" => format!("herdr-core {} is newer than {}. Nothing changed.", r.to.as_deref().unwrap_or("?"), r.pinned),
        "kept_managed" => "herdr-core is installed with a package manager. Update it there.".to_string(),
        _ => format!("herdr-core {} is up to date.", r.to.as_deref().unwrap_or(&r.pinned)),
    };
    HerdrUpdate {
        from: r.from.clone(),
        to: r.to.clone(),
        status: if changed { "updated" } else { "up_to_date" }.into(),
        // An updated core takes over its terminals, as a herdr live handoff does.
        handoff: if r.status == "updated" { "complete" } else { "none" }.into(),
        output,
    }
}
