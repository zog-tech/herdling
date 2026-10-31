//! When does herdlingd start: at boot or only after the user logs in?
//!
//! herdlingd runs as a user service. On macOS a LaunchAgent starts at the user's login. On Linux
//! a systemd user unit starts at the user's login, or at boot when lingering is on. On macOS the
//! computer logs the user in at boot only with automatic login, and automatic login is not
//! possible while FileVault is on.
//!
//! `hello` reports the result as `boot`. `boot.check` reads it again. `mac.open_settings` opens
//! one allow-listed System Settings page on the Mac screen.
//!
//! Tests inject a [`SysRunner`]: no test runs a real system command.

use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::types::Boot;

/// A cached result is used for this long. The boot state changes rarely.
pub const CACHE_TTL: Duration = Duration::from_secs(300);

/// Runs a system command. Tests pass a fake.
pub trait SysRunner: Send + Sync {
    /// Runs `prog` with `args`. `None` when the program cannot start (for example, it is not installed).
    fn run(&self, prog: &str, args: &[&str]) -> Option<CmdOut>;
    /// True when the file exists.
    fn exists(&self, path: &Path) -> bool;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CmdOut {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// The real runner.
pub struct SystemRunner;

impl SysRunner for SystemRunner {
    fn run(&self, prog: &str, args: &[&str]) -> Option<CmdOut> {
        let out = Command::new(prog).args(args).output().ok()?;
        Some(CmdOut {
            success: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }
    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Macos,
    Linux,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(target_os = "macos") {
            Os::Macos
        } else {
            Os::Linux
        }
    }
}

/// The value of `Linger=` in `loginctl show-user <user> -p Linger`. `None` when the line is missing.
pub fn parse_linger(stdout: &str) -> Option<bool> {
    stdout.lines().find_map(|l| match l.trim().strip_prefix("Linger=")? {
        "yes" => Some(true),
        "no" => Some(false),
        _ => None,
    })
}

/// Reads `fdesetup status`. True when FileVault is on, being turned on, or turns on at the next
/// restart. `None` when the text is not known.
pub fn parse_filevault(stdout: &str) -> Option<bool> {
    let t = stdout.trim();
    if t.contains("FileVault is On") || t.contains("will be enabled") || t.contains("Encryption in progress") {
        return Some(true);
    }
    if t.contains("FileVault is Off") || t.contains("Decryption in progress") {
        return Some(false);
    }
    None
}

fn boot(starts_at: &str, reason: &str, how: String, user: &str) -> Boot {
    Boot {
        starts_at: starts_at.into(),
        how,
        reason: Some(reason.into()),
        user: (!user.is_empty()).then(|| user.to_string()),
    }
}

/// Finds out when herdlingd starts for `user`. Never fails: an unknown state is `unknown`.
pub fn detect(os: Os, user: &str, runner: &dyn SysRunner) -> Boot {
    match os {
        Os::Linux => detect_linux(user, runner),
        Os::Macos => detect_macos(user, runner),
    }
}

fn detect_linux(user: &str, runner: &dyn SysRunner) -> Boot {
    let enable = format!("Run this once on the computer: sudo loginctl enable-linger {user}");
    let linger = runner
        .run("loginctl", &["show-user", user, "-p", "Linger"])
        .filter(|o| o.success)
        .and_then(|o| parse_linger(&o.stdout))
        // loginctl can fail when the user has no session. The linger flag is a file.
        .or_else(|| (!user.is_empty() && runner.exists(&Path::new("/var/lib/systemd/linger").join(user))).then_some(true));
    match linger {
        Some(true) => boot("boot", "linger_on", "Lingering is on: herdlingd starts when the computer starts.".into(), user),
        Some(false) => boot("login", "linger_off", enable, user),
        None => boot("unknown", "no_loginctl", "Cannot read the linger state. On a systemd system, run: sudo loginctl enable-linger ".to_string() + user, user),
    }
}

fn detect_macos(user: &str, runner: &dyn SysRunner) -> Boot {
    let filevault = runner.run("/usr/bin/fdesetup", &["status"]).filter(|o| o.success).and_then(|o| parse_filevault(&o.stdout));
    if filevault == Some(true) {
        return boot(
            "login",
            "filevault_on",
            "FileVault is on, so macOS cannot log in automatically. Log in on the Mac once after each restart.".into(),
            user,
        );
    }
    let auto = runner
        .run("/usr/bin/defaults", &["read", "/Library/Preferences/com.apple.loginwindow", "autoLoginUser"])
        .map(|o| if o.success { o.stdout.trim().to_string() } else { String::new() });
    let turn_on = format!(
        "Turn on automatic login: System Settings > Users & Groups > Automatically log in as > {}.",
        if user.is_empty() { "your user" } else { user }
    );
    match auto {
        Some(a) if !a.is_empty() && a == user => {
            boot("boot", "auto_login_on", "Automatic login is on: herdlingd starts when the Mac starts.".into(), user)
        }
        Some(a) if !a.is_empty() => boot("login", "auto_login_other_user", format!("The Mac logs in {a} automatically, not {user}. {turn_on}"), user),
        Some(_) => boot("login", "auto_login_off", turn_on, user),
        None => boot("unknown", "no_defaults", turn_on, user),
    }
}

/// A cached boot state, shared by the clones of an rpc context.
#[derive(Clone, Default)]
pub struct BootCache(Arc<Mutex<Option<(Instant, Boot)>>>);

impl BootCache {
    /// The cached state when it is younger than [`CACHE_TTL`] and `fresh` is false, else a new one.
    pub fn get(&self, fresh: bool, make: impl FnOnce() -> Boot) -> Boot {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if !fresh {
            if let Some((at, b)) = g.as_ref() {
                if at.elapsed() < CACHE_TTL {
                    return b.clone();
                }
            }
        }
        let b = make();
        *g = Some((Instant::now(), b.clone()));
        b
    }
}

/// System Settings pages that `mac.open_settings` may open. Only these ids are accepted.
/// The URLs use the extension ids of System Settings on macOS 13 and later.
pub const MAC_PANES: &[(&str, &str)] = &[
    ("users_groups", "x-apple.systempreferences:com.apple.Users-Groups-Settings.extension"),
    ("sharing", "x-apple.systempreferences:com.apple.Sharing-Settings.extension"),
    ("filevault", "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?FileVault"),
];

/// The URL of an allow-listed pane id. `None` for any other id.
pub fn pane_url(pane: &str) -> Option<&'static str> {
    MAC_PANES.iter().find(|(id, _)| *id == pane).map(|(_, url)| *url)
}

#[derive(Debug, PartialEq, Eq)]
pub enum OpenError {
    UnsupportedPlatform,
    UnknownPane,
    Failed(String),
}

/// Opens an allow-listed System Settings page on the Mac screen with `open`.
pub fn open_settings(os: Os, pane: &str, runner: &dyn SysRunner) -> Result<&'static str, OpenError> {
    if os != Os::Macos {
        return Err(OpenError::UnsupportedPlatform);
    }
    let url = pane_url(pane).ok_or(OpenError::UnknownPane)?;
    match runner.run("/usr/bin/open", &[url]) {
        Some(o) if o.success => Ok(url),
        Some(o) => Err(OpenError::Failed(o.stderr.trim().chars().take(200).collect())),
        None => Err(OpenError::Failed("cannot start open".into())),
    }
}
