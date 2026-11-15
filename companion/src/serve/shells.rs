//! Checks the shell panes that the phone watches (`shell.watch`) and sends one push when the
//! command in a pane finishes. The rules are in [`crate::shell_watch`]; this module does the I/O.
//!
//! The herdr 1 loop checks the herdr 1 panes with `pane.process_info`. The core loop
//! (`core_watch`) checks the Herdr 2 panes (`hc:` ids) with `terminal.get`. Each loop checks only
//! its own watches.

use std::path::PathBuf;

use serde_json::{json, Value};

use super::watch::{deliver, snapshot};
use super::ServeCtx;
use crate::config;
use crate::core::client::CoreError;
use crate::core::endpoint::CoreSocket;
use crate::core::{groups, project};
use crate::herdr::{self, HerdrError};
use crate::push;
use crate::rpc::HERDR_TIMEOUT;
use crate::shell_watch::{self, Probe, Step, Watch};

/// One round: checks every live watch, saves the changes and sends the pushes of the finished
/// commands. A missing watch file costs one `stat`. While the user is `at_desk`, devices with
/// `quiet_at_desk` get nothing. Returns the panes of the watches that the round read, for
/// [`shell_watch::Nudge`]. `None` when the watch file cannot be read.
/// Which panes a round checks, and how.
#[derive(Clone, Copy)]
pub enum Backend<'a> {
    /// herdr 1 panes, with `pane.process_info`.
    Herdr,
    /// Herdr 2 panes (`hc:` ids), with `terminal.get` on this core.
    Core(&'a CoreSocket),
}

impl Backend<'_> {
    fn owns(&self, pane: &str) -> bool {
        project::is_core_id(pane) == matches!(self, Backend::Core(_))
    }
}

/// The check result from a core `terminal.get` answer. A terminal that the core does not know,
/// or that is not live, is gone. The folder of a busy command is the foreground folder.
pub fn core_probe(r: Result<Value, CoreError>) -> Probe {
    let t = match r {
        Ok(t) => t,
        Err(e) if matches!(e.kind(), Some("not_found" | "finished")) => return Probe::Gone,
        Err(_) => return Probe::Unknown,
    };
    if t.get("state").and_then(Value::as_str).is_some_and(|s| s != "live") {
        return Probe::Gone;
    }
    let info = project::process_info(&t);
    match shell_watch::probe(info.get("process_info").unwrap_or(&Value::Null)) {
        Probe::Busy { command, cwd } => Probe::Busy { command, cwd: cwd.or_else(|| groups::folder_of(&t).map(String::from)) },
        p => p,
    }
}

pub async fn poll(ctx: &ServeCtx, client: &reqwest::Client, at_desk: bool, backend: Backend<'_>) -> Option<Vec<String>> {
    let path = shell_watch::path(&ctx.home);
    if !path.exists() {
        return Some(Vec::new());
    }
    let now = crate::proxy::now_secs();
    let all = blocking(path.clone(), move |p| shell_watch::list(&p, now)).await?;
    let watches: Vec<Watch> = all.into_iter().filter(|w| backend.owns(&w.pane_id)).collect();
    let panes: Vec<String> = watches.iter().map(|w| w.pane_id.clone()).collect();
    if !watches.is_empty() {
        check(ctx, client, at_desk, backend, path, now, watches).await;
    }
    Some(panes)
}

/// Checks `watches` once and sends the pushes of the finished commands.
async fn check(ctx: &ServeCtx, client: &reqwest::Client, at_desk: bool, backend: Backend<'_>, path: PathBuf, now: u64, watches: Vec<Watch>) {
    // herdr not there: try again next round. Expired watches still go.
    let mut herdr = match backend {
        Backend::Herdr => herdr::Client::connect(&ctx.herdr_socket, HERDR_TIMEOUT).await.ok(),
        Backend::Core(_) => None,
    };
    let mut results: Vec<(Watch, Option<Watch>)> = Vec::new();
    let mut finished: Vec<(Watch, String, Option<String>)> = Vec::new();
    for w in watches {
        let probe = match (backend, herdr.as_mut()) {
            (Backend::Core(sock), _) => {
                let r = crate::core::live::record(sock, HERDR_TIMEOUT, &w.pane_id).await;
                core_probe(r)
            }
            (Backend::Herdr, Some(c)) => match c.call("pane.process_info", json!({ "pane_id": w.pane_id })).await {
                Ok(r) => shell_watch::probe(r.get("process_info").unwrap_or(&r)),
                Err(HerdrError::Remote { code, .. }) if code == "pane_not_found" => Probe::Gone,
                Err(_) => Probe::Unknown,
            },
            (Backend::Herdr, None) => Probe::Unknown,
        };
        match shell_watch::step(&w, &probe, now) {
            Step::Keep => {}
            Step::Update(n) => results.push((w, Some(n))),
            Step::Drop => results.push((w, None)),
            Step::Finished { command, cwd } => {
                results.push((w.clone(), None));
                finished.push((w, command, cwd));
            }
        }
    }
    if results.is_empty() {
        return;
    }
    let items = results.clone();
    let Some(applied) = blocking(path, move |p| shell_watch::apply(&p, now, &items)).await else { return };
    // Only a finished watch that this round removed sends a push, so a push never goes out twice.
    let sent: Vec<&Watch> = results.iter().zip(&applied).filter(|(_, ok)| **ok).map(|((w, _), _)| w).collect();
    let finished: Vec<_> = finished.into_iter().filter(|(w, _, _)| sent.contains(&w)).collect();
    if finished.is_empty() {
        return;
    }
    let cfg = match config::load(&ctx.config_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("herdlingd serve: config: {e:#}");
            return;
        }
    };
    // The folder of a core pane comes with its probe; herdr 1 gives it in the snapshot.
    let snap = match backend {
        Backend::Herdr => snapshot(ctx).await.unwrap_or(Value::Null),
        Backend::Core(_) => Value::Null,
    };
    for (w, command, cwd) in finished {
        let folder = pane_folder(&snap, &w.pane_id).or(cwd);
        let (title, body) = shell_watch::push_text(folder.as_deref(), &command);
        let msgs = push::shell_messages(&cfg, w.device_id.as_deref(), &w.pane_id, &title, &body, at_desk);
        if msgs.is_empty() && at_desk {
            eprintln!("herdlingd serve: user is at the computer, skipped the command push for pane {}", w.pane_id);
        }
        deliver(ctx, client, &msgs).await;
    }
}

/// Runs a file operation on the watch file off the async threads. `None` on an error (logged).
async fn blocking<T: Send + 'static>(
    path: PathBuf,
    f: impl FnOnce(PathBuf) -> std::io::Result<T> + Send + 'static,
) -> Option<T> {
    match tokio::task::spawn_blocking(move || f(path)).await {
        Ok(Ok(v)) => Some(v),
        Ok(Err(e)) => {
            eprintln!("herdlingd serve: shell watches: {e}");
            None
        }
        Err(_) => None,
    }
}

/// The folder of `pane` in the snapshot: `cwd`, else `foreground_cwd`.
fn pane_folder(snap: &Value, pane: &str) -> Option<String> {
    let p = snap.get("panes")?.as_array()?.iter().find(|p| p.get("pane_id").and_then(Value::as_str) == Some(pane))?;
    ["cwd", "foreground_cwd"]
        .iter()
        .find_map(|k| p.get(*k).and_then(Value::as_str).filter(|s| !s.trim().is_empty()))
        .map(String::from)
}
