//! Checks the shell panes that the phone watches (`shell.watch`) and sends one push when the
//! command in a pane finishes. The rules are in [`crate::shell_watch`]; this module does the I/O.

use std::path::PathBuf;

use serde_json::{json, Value};

use super::watch::{deliver, snapshot};
use super::ServeCtx;
use crate::config;
use crate::herdr::{self, HerdrError};
use crate::push;
use crate::rpc::HERDR_TIMEOUT;
use crate::shell_watch::{self, Probe, Step, Watch};

/// One round: checks every live watch, saves the changes and sends the pushes of the finished
/// commands. A missing watch file costs one `stat`. While the user is `at_desk`, devices with
/// `quiet_at_desk` get nothing. Returns the panes of the watches that the round read, for
/// [`shell_watch::Nudge`]. `None` when the watch file cannot be read.
pub async fn poll(ctx: &ServeCtx, client: &reqwest::Client, at_desk: bool) -> Option<Vec<String>> {
    let path = shell_watch::path(&ctx.home);
    if !path.exists() {
        return Some(Vec::new());
    }
    let now = crate::proxy::now_secs();
    let watches = blocking(path.clone(), move |p| shell_watch::list(&p, now)).await?;
    let panes: Vec<String> = watches.iter().map(|w| w.pane_id.clone()).collect();
    if !watches.is_empty() {
        check(ctx, client, at_desk, path, now, watches).await;
    }
    Some(panes)
}

/// Checks `watches` once and sends the pushes of the finished commands.
async fn check(ctx: &ServeCtx, client: &reqwest::Client, at_desk: bool, path: PathBuf, now: u64, watches: Vec<Watch>) {
    // herdr not there: try again next round. Expired watches still go.
    let mut herdr = herdr::Client::connect(&ctx.herdr_socket, HERDR_TIMEOUT).await.ok();
    let mut results: Vec<(Watch, Option<Watch>)> = Vec::new();
    let mut finished: Vec<(Watch, String, Option<String>)> = Vec::new();
    for w in watches {
        let probe = match herdr.as_mut() {
            Some(c) => match c.call("pane.process_info", json!({ "pane_id": w.pane_id })).await {
                Ok(r) => shell_watch::probe(r.get("process_info").unwrap_or(&r)),
                Err(HerdrError::Remote { code, .. }) if code == "pane_not_found" => Probe::Gone,
                Err(_) => Probe::Unknown,
            },
            None => Probe::Unknown,
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
    let snap = snapshot(ctx).await.unwrap_or(Value::Null);
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
