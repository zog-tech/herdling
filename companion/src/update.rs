//! Self-update of `herdlingd` from the GitHub releases (`update.check`, `update.apply` and
//! `herdlingd update`).
//!
//! The paired phone key can only run `herdlingd rpc`, so the update runs inside this process.
//! Rules: download only from `<release_base>/download/` URLs, check the SHA-256 before anything
//! changes, replace only the running executable, and never use `sudo`.
//! See `docs/superpowers/specs/2026-10-31-herdlingd-install-update-design.md`.

use std::collections::BTreeMap;
use std::cmp::Ordering;
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::install::{Runner, SystemRunner, LABEL};
use crate::types::{RpcError, UpdateApply, UpdateCheck};

/// Where the releases are. Tests use a local server.
pub const RELEASE_BASE: &str = "https://github.com/zog-tech/herdling/releases";
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(15);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);
/// Largest accepted manifest.
const MANIFEST_LIMIT: usize = 256 * 1024;
/// Largest accepted tarball.
pub const DOWNLOAD_LIMIT: usize = 64 << 20;

/// `latest.json` of a release.
#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub notes: String,
    pub assets: BTreeMap<String, Asset>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Asset {
    pub url: String,
    pub sha256: String,
}

/// Everything an update needs. Pass fakes in tests.
#[derive(Clone)]
pub struct UpdateCtx {
    /// Release root, without a trailing slash. Production: [`RELEASE_BASE`].
    pub release_base: String,
    /// The executable to replace: the running binary after `canonicalize`.
    pub exe: PathBuf,
    pub home: PathBuf,
    /// `std::env::consts::OS` value.
    pub os: String,
    /// `std::env::consts::ARCH` value.
    pub arch: String,
    /// The running version.
    pub current: String,
    /// Runs the service restart command.
    pub runner: Arc<dyn Runner + Send + Sync>,
}

impl UpdateCtx {
    /// The real values for this process.
    pub fn new(home: PathBuf, exe: PathBuf) -> UpdateCtx {
        UpdateCtx {
            release_base: RELEASE_BASE.into(),
            exe,
            home,
            os: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            current: env!("CARGO_PKG_VERSION").into(),
            runner: Arc::new(SystemRunner),
        }
    }
}

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

/// The release asset target for an OS and CPU. Linux always uses the static musl build.
pub fn asset_target(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("aarch64-apple-darwin"),
        ("macos", "x86_64") => Some("x86_64-apple-darwin"),
        ("linux", "x86_64") => Some("x86_64-unknown-linux-musl"),
        ("linux", "aarch64") => Some("aarch64-unknown-linux-musl"),
        _ => None,
    }
}

/// A parsed `X.Y.Z` or `X.Y.Z-pre` version. A leading `v` is allowed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub nums: [u64; 3],
    pub pre: Option<String>,
}

pub fn parse_version(s: &str) -> Option<Version> {
    let s = s.trim();
    let s = s.strip_prefix('v').unwrap_or(s);
    let (core, pre) = match s.split_once('-') {
        Some((c, p)) if !p.is_empty() => (c, Some(p.to_string())),
        Some(_) => return None,
        None => (s, None),
    };
    let mut parts = core.split('.');
    let mut nums = [0u64; 3];
    for n in &mut nums {
        let p = parts.next()?;
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *n = p.parse().ok()?;
    }
    if parts.next().is_some() {
        return None;
    }
    Some(Version { nums, pre })
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        self.nums.cmp(&other.nums).then_with(|| match (&self.pre, &other.pre) {
            (None, None) => Ordering::Equal,
            // A pre-release comes before the release of the same number.
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (Some(a), Some(b)) => a.cmp(b),
        })
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Compares two version texts. None when one of them is not a version.
pub fn compare_versions(a: &str, b: &str) -> Option<Ordering> {
    Some(parse_version(a)?.cmp(&parse_version(b)?))
}

/// The manifest URL: the latest release, or the release of `version`.
pub fn manifest_url(base: &str, version: Option<&str>) -> String {
    match version {
        None => format!("{base}/latest/download/latest.json"),
        Some(v) => format!("{base}/download/herdlingd-v{v}/latest.json"),
    }
}

/// True when `url` is a release download of `base`. Other URLs are refused.
pub fn url_allowed(base: &str, url: &str) -> bool {
    let prefix = format!("{base}/download/");
    url.starts_with(&prefix) && !url[prefix.len()..].contains("..") && !url.contains(['?', '#', '\\'])
}

fn client(timeout: Duration) -> Result<reqwest::Client, RpcError> {
    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(concat!("herdlingd/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| err("internal", e.to_string()))
}

/// GETs `url` and returns the body, refusing more than `limit` bytes.
async fn get_bytes(url: &str, timeout: Duration, limit: usize) -> Result<Vec<u8>, RpcError> {
    let unavailable = |m: String| err("update_unavailable", m);
    let mut resp = client(timeout)?.get(url).send().await.map_err(|e| unavailable(format!("download {url}: {e}")))?;
    if !resp.status().is_success() {
        return Err(unavailable(format!("download {url}: HTTP {}", resp.status().as_u16())));
    }
    if resp.content_length().is_some_and(|n| n > limit as u64) {
        return Err(unavailable(format!("download {url}: larger than {limit} bytes")));
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| unavailable(format!("download {url}: {e}")))? {
        if body.len() + chunk.len() > limit {
            return Err(unavailable(format!("download {url}: larger than {limit} bytes")));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Gets and checks the manifest of the latest release, or of `version`.
pub async fn fetch_manifest(base: &str, version: Option<&str>) -> Result<Manifest, RpcError> {
    if let Some(v) = version {
        if parse_version(v).is_none() {
            return Err(err("bad_request", format!("not a version: {v}")));
        }
    }
    let url = manifest_url(base, version);
    let body = get_bytes(&url, MANIFEST_TIMEOUT, MANIFEST_LIMIT).await?;
    let m: Manifest =
        serde_json::from_slice(&body).map_err(|e| err("update_unavailable", format!("bad release manifest: {e}")))?;
    if parse_version(&m.version).is_none() {
        return Err(err("update_unavailable", format!("bad version in the release manifest: {}", m.version)));
    }
    if let Some(v) = version {
        if compare_versions(v, &m.version) != Some(Ordering::Equal) {
            return Err(err("update_unavailable", format!("the manifest of {v} names version {}", m.version)));
        }
    }
    Ok(m)
}

fn target_of(ctx: &UpdateCtx) -> Result<&'static str, RpcError> {
    asset_target(&ctx.os, &ctx.arch)
        .ok_or_else(|| err("unsupported_target", format!("no release for {} {}", ctx.os, ctx.arch)))
}

fn asset_for<'a>(m: &'a Manifest, target: &str) -> Result<&'a Asset, RpcError> {
    m.assets.get(target).ok_or_else(|| err("unsupported_target", format!("release {} has no build for {target}", m.version)))
}

/// `update.check`: the running version and the release (latest, or `version`).
pub async fn check(ctx: &UpdateCtx, version: Option<&str>) -> Result<UpdateCheck, RpcError> {
    let target = target_of(ctx)?;
    let m = fetch_manifest(&ctx.release_base, version).await?;
    asset_for(&m, target)?;
    let newer = compare_versions(&m.version, &ctx.current) == Some(Ordering::Greater);
    Ok(UpdateCheck {
        current: ctx.current.clone(),
        latest: m.version,
        update_available: newer,
        notes: m.notes,
        date: m.date,
        target: target.into(),
    })
}

/// Holds `update.lock` while an update runs.
struct UpdateLock(#[allow(dead_code)] fs::File);

fn take_lock(home: &Path) -> Result<UpdateLock, RpcError> {
    let dir = crate::config::default_path(home).parent().map(Path::to_path_buf).unwrap_or_else(|| home.join(".config/herdling"));
    let io = |e: std::io::Error| err("io_error", format!("update lock: {e}"));
    fs::create_dir_all(&dir).map_err(io)?;
    let file = fs::OpenOptions::new().create(true).truncate(false).write(true).open(dir.join("update.lock")).map_err(io)?;
    match fs4::fs_std::FileExt::try_lock_exclusive(&file) {
        Ok(true) => Ok(UpdateLock(file)),
        Ok(false) => Err(err("update_in_progress", "another update is running")),
        Err(e) => Err(io(e)),
    }
}

/// `update.apply`: downloads, checks and installs the release, then restarts the service.
pub async fn apply(ctx: &UpdateCtx, version: Option<&str>, allow_downgrade: bool) -> Result<UpdateApply, RpcError> {
    let target = target_of(ctx)?;
    let _lock = take_lock(&ctx.home)?;
    let m = fetch_manifest(&ctx.release_base, version).await?;
    let asset = asset_for(&m, target)?.clone();
    let order = compare_versions(&m.version, &ctx.current).unwrap_or(Ordering::Greater);
    let result = |status: &str, service_restarted: bool| UpdateApply {
        from: ctx.current.clone(),
        to: m.version.clone(),
        status: status.into(),
        service_restarted,
    };
    match order {
        Ordering::Equal => return Ok(result("up_to_date", false)),
        Ordering::Less if !allow_downgrade => {
            return Err(err("downgrade", format!("{} is older than the running {}", m.version, ctx.current)));
        }
        _ => {}
    }
    if !url_allowed(&ctx.release_base, &asset.url) {
        return Err(err("update_unavailable", format!("refused a download outside {}/download/", ctx.release_base)));
    }
    let want = asset.sha256.trim().to_ascii_lowercase();
    if want.len() != 64 || !want.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(err("update_unavailable", "bad sha256 in the release manifest"));
    }
    let tarball = get_bytes(&asset.url, DOWNLOAD_TIMEOUT, DOWNLOAD_LIMIT).await?;
    let got = sha256_hex(&tarball);
    if got != want {
        return Err(err("checksum_mismatch", format!("the download has sha256 {got}, the release says {want}")));
    }
    let exe = ctx.exe.clone();
    tokio::task::spawn_blocking(move || replace_exe(&exe, &tarball))
        .await
        .map_err(|e| err("internal", e.to_string()))??;
    let restarted = restart_service(ctx);
    Ok(result("updated", restarted))
}

pub fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

/// Removes the folder when dropped.
struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Unpacks `herdlingd` from the checked tarball and puts it in place of `exe` with one rename.
/// The temporary files stay in the folder of `exe`, so the rename does not cross file systems.
pub fn replace_exe(exe: &Path, tarball: &[u8]) -> Result<(), RpcError> {
    let io = |what: &str, e: std::io::Error| err("io_error", format!("{what}: {e}"));
    let dir = exe.parent().ok_or_else(|| err("io_error", "the executable has no folder"))?;
    let tmp = TempDir(dir.join(format!(".herdlingd-update.{}", std::process::id())));
    let _ = fs::remove_dir_all(&tmp.0);
    fs::create_dir(&tmp.0).map_err(|e| io(&format!("create {}", tmp.0.display()), e))?;
    let archive = tmp.0.join("herdlingd.tar.gz");
    fs::write(&archive, tarball).map_err(|e| io("write the download", e))?;
    let out = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(&tmp.0)
        .arg("herdlingd")
        .output()
        .map_err(|e| io("run tar", e))?;
    if !out.status.success() {
        return Err(err("io_error", format!("tar failed: {}", String::from_utf8_lossy(&out.stderr).trim())));
    }
    let unpacked = tmp.0.join("herdlingd");
    let meta = fs::symlink_metadata(&unpacked).map_err(|e| io("read the unpacked binary", e))?;
    if !meta.file_type().is_file() {
        return Err(err("io_error", "the tarball has no herdlingd file"));
    }
    let bytes = fs::read(&unpacked).map_err(|e| io("read the unpacked binary", e))?;

    let mut new_name = exe.as_os_str().to_owned();
    new_name.push(".new");
    let new = PathBuf::from(new_name);
    let write = || -> std::io::Result<()> {
        let mut f = fs::OpenOptions::new().write(true).create(true).truncate(true).open(&new)?;
        f.write_all(&bytes)?;
        f.set_permissions(fs::Permissions::from_mode(0o755))?;
        f.sync_all()?;
        Ok(())
    };
    if let Err(e) = write() {
        let _ = fs::remove_file(&new);
        return Err(io(&format!("write {} (is the folder writable?)", new.display()), e));
    }
    if let Err(e) = fs::rename(&new, exe) {
        let _ = fs::remove_file(&new);
        return Err(io(&format!("replace {}", exe.display()), e));
    }
    // Make the rename durable.
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

/// The service restart command, when the service is installed.
pub fn restart_command(ctx: &UpdateCtx) -> Option<Vec<String>> {
    if ctx.os == "macos" {
        let plist = ctx.home.join("Library/LaunchAgents").join(format!("{LABEL}.plist"));
        if !plist.exists() {
            return None;
        }
        // SAFETY: getuid has no preconditions and cannot fail.
        let uid = unsafe { libc::getuid() };
        Some(vec!["launchctl".into(), "kickstart".into(), "-k".into(), format!("gui/{uid}/{LABEL}")])
    } else {
        if !ctx.home.join(".config/systemd/user/herdlingd.service").exists() {
            return None;
        }
        Some(vec!["systemctl".into(), "--user".into(), "restart".into(), "herdlingd.service".into()])
    }
}

/// Restarts `herdlingd serve` so it runs the new binary. The rpc process is not part of the
/// service, so this does not stop it. Returns false when there is no service or the command failed.
fn restart_service(ctx: &UpdateCtx) -> bool {
    match restart_command(ctx) {
        Some(cmd) => ctx.runner.run(&cmd).is_ok(),
        None => false,
    }
}
