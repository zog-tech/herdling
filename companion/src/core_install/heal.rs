//! Self-heal of a computer with no herdr-core.
//!
//! herdlingd 0.1.9 does not know `requires_core`: its `update.apply` puts 0.2.0 in place and
//! restarts `serve`, and nothing installs the core. 0.2.0 needs the core, so the app would stay
//! dark. Thus when `serve` starts, and when `rpc` gets `hello` and no core answers, herdlingd
//! installs the pinned core (the maintainer decided that herdlingd always installs a missing
//! core). It is the same verified path as `core.install`, under the same lock: it never
//! downgrades and never touches a core of a package manager, because it runs only when no core
//! is found at all.
//!
//! The state file `core-heal.json` (next to the install lock) tells `hello` and the
//! `herdr_unavailable` errors what happens: an install runs, or the last one failed and why.
//! The rules are pure ([`plan`], [`view`], [`unavailable_text`]); [`run`] does the I/O.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{find_core, install, CoreInstallCtx, INSTALL_BUDGET};
use crate::types::{CoreInstall, RpcError};

/// The name of the state file.
pub const FILE: &str = "core-heal.json";

/// A failed heal waits this long before `hello` tries again. `serve` tries at each start.
pub const RETRY: Duration = Duration::from_secs(10 * 60);

/// An "installing" state older than this is from a process that ended during the install.
pub fn stale_after() -> Duration {
    INSTALL_BUDGET + Duration::from_secs(30)
}

/// The content of the state file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Saved {
    Installing { at_ms: u64 },
    Failed { at_ms: u64, error: String },
}

/// What `hello` and the errors say about the core.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum View {
    /// Nothing to say: the core answers, it is installed, or this herdlingd does not need it.
    Quiet,
    /// herdlingd installs Herdr 2 now.
    Installing { version: String },
    /// The last install failed with this message.
    Failed { error: String },
    /// No core is installed, and no install ran yet.
    Missing,
}

/// Who asks for a heal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// `serve` starts: try at once, also after an earlier failure.
    Serve,
    /// `hello` of an app: try again only [`RETRY`] after a failure.
    Hello,
}

/// True when a heal should start now. Only a required pin and no core found at all.
pub fn plan(required: bool, core_found: bool, saved: Option<&Saved>, now_ms: u64, trigger: Trigger) -> bool {
    if !required || core_found {
        return false;
    }
    match saved {
        Some(Saved::Installing { at_ms }) => now_ms.saturating_sub(*at_ms) > stale_after().as_millis() as u64,
        Some(Saved::Failed { at_ms, .. }) => {
            trigger == Trigger::Serve || now_ms.saturating_sub(*at_ms) >= RETRY.as_millis() as u64
        }
        None => true,
    }
}

/// The view for `hello` and the errors.
pub fn view(required: bool, core_answers: bool, core_found: bool, saved: Option<&Saved>, now_ms: u64, pin: &str) -> View {
    if !required || core_answers {
        return View::Quiet;
    }
    match saved {
        Some(Saved::Installing { at_ms }) if now_ms.saturating_sub(*at_ms) <= stale_after().as_millis() as u64 => {
            View::Installing { version: pin.to_string() }
        }
        Some(Saved::Failed { error, .. }) if !core_found => View::Failed { error: error.clone() },
        _ if !core_found => View::Missing,
        _ => View::Quiet,
    }
}

/// The text of a view for the user, or None for [`View::Quiet`].
pub fn text(v: &View) -> Option<String> {
    match v {
        View::Quiet => None,
        View::Installing { version } => {
            Some(format!("Installing Herdr 2 (herdr-core {version}) on this computer. This takes a minute. Then Herdling shows its terminals."))
        }
        View::Failed { error } => Some(format!(
            "herdlingd could not install Herdr 2 (herdr-core): {error}. On the computer, run: herdlingd core install"
        )),
        View::Missing => Some("Herdr 2 (herdr-core) is not installed on this computer. On the computer, run: herdlingd core install".into()),
    }
}

/// The `hello.core_setup` field: `{state, message}`, or None for [`View::Quiet`].
pub fn hello_field(v: &View) -> Option<Value> {
    let state = match v {
        View::Quiet => return None,
        View::Installing { .. } => "installing",
        View::Failed { .. } => "failed",
        View::Missing => "missing",
    };
    Some(json!({ "state": state, "message": text(v) }))
}

/// The message of a `herdr_unavailable` error: the view text when there is one (old apps show
/// this message), else the message as it is.
pub fn unavailable_text(message: &str, v: &View) -> String {
    match text(v) {
        Some(t) => t,
        None => message.to_string(),
    }
}

/// The state file in `dir`.
pub fn path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

/// Reads the state file. A missing or broken file is no state.
pub fn load(dir: &Path) -> Option<Saved> {
    serde_json::from_slice(&fs::read(path(dir)).ok()?).ok()
}

fn save(dir: &Path, s: &Saved) {
    let _ = fs::create_dir_all(dir);
    if let Ok(body) = serde_json::to_vec(s) {
        let tmp = dir.join(format!(".{FILE}.{}", std::process::id()));
        if fs::write(&tmp, body).is_ok() {
            let _ = fs::rename(&tmp, path(dir));
        }
    }
}

fn clear(dir: &Path) {
    let _ = fs::remove_file(path(dir));
}

/// Milliseconds since the epoch.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Installs the pinned core when [`plan`] says so. Blocking: call it from a blocking task.
/// Ok(None): nothing to do (a core is there, the pin is not required, or another install runs).
pub fn run(ctx: &CoreInstallCtx, trigger: Trigger) -> Result<Option<CoreInstall>, RpcError> {
    let dir = &ctx.lock_dir;
    if !plan(ctx.pin.required, find_core(ctx).is_some(), load(dir).as_ref(), now_ms(), trigger) {
        return Ok(None);
    }
    save(dir, &Saved::Installing { at_ms: now_ms() });
    match install(ctx, &ctx.pin) {
        Ok(r) => {
            clear(dir);
            Ok(Some(r))
        }
        // Another install holds the lock. The "installing" state stays: an install runs. It
        // goes stale after the install budget.
        Err(e) if e.code == "busy" => Ok(None),
        Err(e) => {
            save(dir, &Saved::Failed { at_ms: now_ms(), error: e.message.clone() });
            Err(e)
        }
    }
}

/// The view of this computer now, for `hello` and the errors. Only reads.
pub fn current(ctx: &CoreInstallCtx, core_answers: bool) -> View {
    if !ctx.pin.required || core_answers {
        return View::Quiet;
    }
    view(true, false, find_core(ctx).is_some(), load(&ctx.lock_dir).as_ref(), now_ms(), &ctx.pin.version)
}
