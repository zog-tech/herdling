//! Watches agent statuses in herdr and sends Expo pushes for debounced notices.

use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::debounce::{Debouncer, Notice};
use super::ServeCtx;
use crate::config;
use crate::events::{self, EventStream};
use crate::herdr::{self, HerdrError};
use crate::push;
use crate::rpc::HERDR_TIMEOUT;
use crate::types::AgentStatus;

/// Waits between reconnect attempts, in seconds. The last value repeats.
const BACKOFF: [u64; 6] = [1, 2, 4, 8, 16, 30];
/// Bound for one Expo push request.
const PUSH_TIMEOUT: Duration = Duration::from_secs(10);
/// Events queued between the herdr stream and the watcher loop.
const QUEUE: usize = 1024;

/// Runs forever. Reconnects to herdr with backoff when it closes or is not there.
pub async fn watch(ctx: &ServeCtx) {
    let client = reqwest::Client::builder().timeout(PUSH_TIMEOUT).build().unwrap_or_default();
    let mut failures = 0usize;
    loop {
        match connect(ctx).await {
            Ok((stream, debouncer)) => {
                failures = 0;
                run_stream(ctx, &client, stream, debouncer).await;
                eprintln!("zogsshd serve: herdr closed the event stream, reconnecting");
            }
            Err(e) => eprintln!("zogsshd serve: herdr: {e}"),
        }
        let secs = BACKOFF[failures.min(BACKOFF.len() - 1)];
        failures += 1;
        tokio::time::sleep(Duration::from_secs(secs)).await;
    }
}

/// Subscribes, then takes the current statuses from a snapshot so that the first
/// event of each pane has a "from". A new debouncer per connection: pending notices
/// of a closed connection are dropped, so a herdr restart cannot send a duplicate.
async fn connect(ctx: &ServeCtx) -> Result<(EventStream, Debouncer), HerdrError> {
    let stream = events::subscribe(&ctx.herdr_socket, HERDR_TIMEOUT, None).await?;
    let mut debouncer = Debouncer::new(ctx.debounce);
    let now = Instant::now();
    if let Ok(snap) = snapshot(ctx).await {
        for agent in agents(&snap) {
            if let (Some(pane), Some(status)) = (str_field(agent, "pane_id"), status_field(agent)) {
                debouncer.observe(pane, status, now);
            }
        }
    }
    Ok((stream, debouncer))
}

async fn run_stream(ctx: &ServeCtx, client: &reqwest::Client, mut stream: EventStream, mut debouncer: Debouncer) {
    // `EventStream::next` is not safe to cancel, so a task reads it and the loop
    // below selects on the channel instead.
    let (tx, mut rx) = mpsc::channel::<Value>(QUEUE);
    let reader = tokio::spawn(async move {
        while let Some(ev) = stream.next().await {
            if tx.send(ev).await.is_err() {
                return;
            }
        }
    });
    loop {
        let deadline = debouncer.next_deadline();
        let wait = async {
            match deadline {
                Some(at) => tokio::time::sleep_until(tokio::time::Instant::from_std(at)).await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            ev = rx.recv() => match ev {
                Some(ev) => observe(&mut debouncer, &ev),
                None => break,
            },
            _ = wait => {}
        }
        for (pane, notice) in debouncer.due(Instant::now()) {
            send_notice(ctx, client, &pane, notice).await;
        }
    }
    reader.abort();
}

fn observe(debouncer: &mut Debouncer, ev: &Value) {
    if let Some(pane) = events::closed_pane_id(ev) {
        debouncer.forget(pane);
        return;
    }
    if events::event_name(ev).as_deref() != Some("pane_agent_status_changed") {
        return;
    }
    let Some(data) = ev.get("data") else { return };
    if let (Some(pane), Some(status)) = (str_field(data, "pane_id"), status_field(data)) {
        debouncer.observe(pane, status, Instant::now());
    }
}

/// Sends `notice` for `pane` to every device that wants it. Reads the config and a
/// fresh snapshot each time, so new devices and titles apply at once.
async fn send_notice(ctx: &ServeCtx, client: &reqwest::Client, pane: &str, notice: Notice) {
    let cfg = match config::load(&ctx.config_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("zogsshd serve: config: {e:#}");
            return;
        }
    };
    let snap = snapshot(ctx).await.unwrap_or(Value::Null);
    let (title, workspace) = describe(&snap, pane);
    let msgs = push::messages(&cfg, notice, pane, &title, &workspace);
    if msgs.is_empty() {
        return;
    }
    let gone = match push::send(client, &ctx.push_url, &msgs).await {
        Ok(gone) => gone,
        Err(e) => {
            eprintln!("zogsshd serve: push: {e:#}");
            return;
        }
    };
    if gone.is_empty() {
        return;
    }
    let path = ctx.config_path.clone();
    let cleared = tokio::task::spawn_blocking(move || {
        config::update(&path, |c| {
            for d in &mut c.devices {
                if d.expo_token.as_ref().is_some_and(|t| gone.contains(t)) {
                    d.expo_token = None;
                }
            }
        })
    })
    .await;
    if !matches!(cleared, Ok(Ok(()))) {
        eprintln!("zogsshd serve: could not remove unregistered push tokens");
    }
}

/// The inner `snapshot` object of `session.snapshot`. One connection per call.
async fn snapshot(ctx: &ServeCtx) -> Result<Value, HerdrError> {
    let mut c = herdr::Client::connect(&ctx.herdr_socket, HERDR_TIMEOUT).await?;
    let mut r = c.call("session.snapshot", json!({})).await?;
    Ok(match r.get_mut("snapshot") {
        Some(s) => s.take(),
        None => r,
    })
}

fn agents(snap: &Value) -> impl Iterator<Item = &Value> {
    snap.get("agents").and_then(Value::as_array).into_iter().flatten()
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

/// An unknown status string counts as `unknown`.
fn status_field(v: &Value) -> Option<AgentStatus> {
    let s = v.get("agent_status")?;
    Some(serde_json::from_value(s.clone()).unwrap_or(AgentStatus::Unknown))
}

/// Push title and workspace label of `pane`: the terminal title, else the agent kind,
/// else the pane id; the workspace label, else "".
fn describe(snap: &Value, pane: &str) -> (String, String) {
    let Some(agent) = agents(snap).find(|a| str_field(a, "pane_id") == Some(pane)) else {
        return (pane.to_string(), String::new());
    };
    let title = [str_field(agent, "terminal_title_stripped"), str_field(agent, "agent")]
        .into_iter()
        .flatten()
        .find(|s| !s.is_empty())
        .unwrap_or(pane)
        .to_string();
    let workspace = str_field(agent, "workspace_id")
        .and_then(|id| {
            snap.get("workspaces")
                .and_then(Value::as_array)?
                .iter()
                .find(|w| str_field(w, "workspace_id") == Some(id))
        })
        .and_then(|w| str_field(w, "label"))
        .unwrap_or("")
        .to_string();
    (title, workspace)
}
