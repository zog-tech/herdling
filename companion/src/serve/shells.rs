//! Checks the shell panes that the phone watches (`shell.watch`) and sends one push when the
//! command in a pane finishes. The rules are in [`crate::shell_watch`]; this module does the I/O.
//!
//! The core loop (`core_watch`) checks each watched pane with `terminal.get`.

use std::path::PathBuf;

use serde_json::Value;

use super::core_watch::deliver;
use super::ServeCtx;
use crate::config;
use crate::core::client::CoreError;
use crate::core::endpoint::CoreSocket;
use crate::core::{groups, project};
use crate::push;
use crate::rpc::HERDR_TIMEOUT;
use crate::shell_watch::{self, Probe, Step, Watch};

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

/// One round: checks every live watch, saves the changes and sends the pushes of the finished
/// commands. A missing watch file costs one `stat`. Returns the panes of the watches that the
/// round read, for [`shell_watch::Nudge`]. `None` when the watch file cannot be read.
pub async fn poll(ctx: &ServeCtx, client: &reqwest::Client, sock: &CoreSocket) -> Option<Vec<String>> {
    let path = shell_watch::path(&ctx.home);
    if !path.exists() {
        return Some(Vec::new());
    }
    let now = crate::proxy::now_secs();
    let watches = blocking(path.clone(), move |p| shell_watch::list(&p, now)).await?;
    let panes: Vec<String> = watches.iter().map(|w| w.pane_id.clone()).collect();
    if !watches.is_empty() {
        check(ctx, client, sock, path, now, watches).await;
    }
    Some(panes)
}

/// Checks `watches` once and sends the pushes of the finished commands.
async fn check(ctx: &ServeCtx, client: &reqwest::Client, sock: &CoreSocket, path: PathBuf, now: u64, watches: Vec<Watch>) {
    let mut results: Vec<(Watch, Option<Watch>)> = Vec::new();
    let mut finished: Vec<(Watch, String, Option<String>)> = Vec::new();
    for w in watches {
        let probe = core_probe(crate::core::live::record(sock, HERDR_TIMEOUT, &w.pane_id).await);
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
    for (w, command, cwd) in finished {
        let (title, body) = shell_watch::push_text(cwd.as_deref(), &command);
        let msgs = push::shell_messages(&cfg, w.device_id.as_deref(), &w.pane_id, &title, &body, false);
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
