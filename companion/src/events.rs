//! herdr event subscription: lifecycle events on one connection plus
//! `pane.agent_status_changed` per pane (herdr needs a pane id for that type).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio::task::{AbortHandle, JoinSet};

use crate::herdr::{self, HerdrError};

/// Event types sent when the caller names none. Only types that need no extra
/// parameters (pane.output_matched, pane.agent_status_changed and pane.scroll_changed
/// need a pane id, so they are left out).
pub const DEFAULT_EVENTS: &[&str] = &[
    "workspace.created", "workspace.updated", "workspace.metadata_updated", "workspace.renamed",
    "workspace.moved", "workspace.reordered", "workspace.closed", "workspace.focused",
    "worktree.created", "worktree.opened", "worktree.removed",
    "tab.created", "tab.closed", "tab.focused", "tab.renamed", "tab.moved",
    "pane.created", "pane.closed", "pane.updated", "pane.focused", "pane.moved",
    "pane.exited", "pane.agent_detected", "layout.updated",
];

/// Queued status events before the status readers wait.
const STATUS_CAPACITY: usize = 1024;

/// One subscription. Dropping it closes every herdr connection it holds.
pub struct EventStream {
    lifecycle: herdr::Client,
    status: StatusConns,
    status_tx: mpsc::Sender<Value>,
    status_rx: mpsc::Receiver<Value>,
    with_status: bool,
    socket: PathBuf,
    timeout: Duration,
}

impl EventStream {
    /// The next event line. `None` when herdr closed the lifecycle connection.
    pub async fn next(&mut self) -> Option<Value> {
        loop {
            let retry_at = self.status.retry_at;
            let retry = async {
                match retry_at {
                    Some(at) => tokio::time::sleep_until(at).await,
                    None => std::future::pending().await,
                }
            };
            tokio::select! {
                ev = self.lifecycle.next_event() => {
                    let ev = ev.ok().flatten()?;
                    if self.with_status {
                        if let Some(pane) = new_pane_id(&ev) {
                            if !self.status.covers(pane) {
                                let pane = pane.to_string();
                                if let Ok(sc) = status_connection(&self.socket, self.timeout, std::slice::from_ref(&pane)).await {
                                    self.status.add(sc, vec![pane], self.status_tx.clone());
                                }
                            }
                        } else if let Some(pane) = closed_pane_id(&ev) {
                            self.status.pane_closed(pane);
                        }
                    }
                    return Some(ev);
                }
                // The stream holds a sender, so the channel never closes.
                Some(ev) = self.status_rx.recv() => return Some(ev),
                Some(id) = self.status.ended_rx.recv() => self.status.reader_ended(id, tokio::time::Instant::now()),
                _ = retry => {
                    let panes = self.status.take_lost();
                    for (sc, served) in open_status_connections(&self.socket, self.timeout, &panes).await {
                        self.status.add(sc, served, self.status_tx.clone());
                    }
                }
            }
        }
    }
}

/// Subscribes to `events`. With `None`, the lifecycle events plus the status changes
/// of every pane (known now or created later). Errors of the lifecycle subscription
/// are returned; status connections that fail are left out.
pub async fn subscribe(socket: &Path, timeout: Duration, events: Option<Vec<String>>) -> Result<EventStream, HerdrError> {
    let with_status = events.is_none();
    let types = events.unwrap_or_else(|| DEFAULT_EVENTS.iter().map(|s| s.to_string()).collect());
    let subscriptions: Vec<Value> = types.iter().map(|t| json!({ "type": t })).collect();
    let mut lifecycle = herdr::Client::connect(socket, timeout).await?;
    lifecycle.call("events.subscribe", json!({ "subscriptions": subscriptions })).await?;

    // Panes known now. The lifecycle subscription is already active, so a pane created
    // after this snapshot arrives as an event and gets covered in `next`.
    let (status_tx, status_rx) = mpsc::channel(STATUS_CAPACITY);
    let mut status = StatusConns::default();
    if with_status {
        let panes = snapshot_panes(socket, timeout).await;
        for (sc, served) in open_status_connections(socket, timeout, &panes).await {
            status.add(sc, served, status_tx.clone());
        }
    }
    Ok(EventStream { lifecycle, status, status_tx, status_rx, with_status, socket: socket.into(), timeout })
}

/// Opens a herdr connection that streams `pane.agent_status_changed` for `panes`.
async fn status_connection(socket: &Path, timeout: Duration, panes: &[String]) -> Result<herdr::Client, HerdrError> {
    let mut c = herdr::Client::connect(socket, timeout).await?;
    let subs: Vec<Value> =
        panes.iter().map(|p| json!({ "type": "pane.agent_status_changed", "pane_id": p })).collect();
    c.call("events.subscribe", json!({ "subscriptions": subs })).await?;
    Ok(c)
}

/// Pane ids of the current `session.snapshot`. Empty when herdr cannot answer.
async fn snapshot_panes(socket: &Path, timeout: Duration) -> Vec<String> {
    let Ok(mut c) = herdr::Client::connect(socket, timeout).await else { return vec![] };
    let Ok(r) = c.call("session.snapshot", json!({})).await else { return vec![] };
    let snap = r.get("snapshot").unwrap_or(&r);
    snap.get("panes")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|p| p.get("pane_id").and_then(Value::as_str).map(String::from)).collect())
        .unwrap_or_default()
}

/// Event name with `.` replaced by `_` (herdr uses both spellings).
pub fn event_name(ev: &Value) -> Option<String> {
    ev.get("event").and_then(Value::as_str).map(|n| n.replace('.', "_"))
}

/// Pane id of a `pane_created` / `pane_agent_detected` event line, if it is one.
fn new_pane_id(ev: &Value) -> Option<&str> {
    let data = ev.get("data")?;
    match event_name(ev)?.as_str() {
        "pane_created" => data.get("pane").and_then(|p| p.get("pane_id")).and_then(Value::as_str),
        "pane_agent_detected" => data.get("pane_id").and_then(Value::as_str),
        _ => None,
    }
}

/// Pane id of a `pane_closed` event line, if it is one.
pub fn closed_pane_id(ev: &Value) -> Option<&str> {
    if event_name(ev)? != "pane_closed" {
        return None;
    }
    ev.get("data")?.get("pane_id").and_then(Value::as_str)
}

/// Status connections for `panes`: one connection for all of them, or, when herdr
/// rejects that (for example one pane closed meanwhile), one per pane. Panes whose
/// connection fails are left out.
async fn open_status_connections(socket: &Path, timeout: Duration, panes: &[String]) -> Vec<(herdr::Client, Vec<String>)> {
    if panes.is_empty() {
        return vec![];
    }
    if let Ok(c) = status_connection(socket, timeout, panes).await {
        return vec![(c, panes.to_vec())];
    }
    let mut set = JoinSet::new();
    for pane in panes {
        let (socket, pane) = (socket.to_path_buf(), pane.clone());
        set.spawn(async move {
            status_connection(&socket, timeout, std::slice::from_ref(&pane)).await.ok().map(|c| (c, vec![pane]))
        });
    }
    let mut out = vec![];
    while let Some(r) = set.join_next().await {
        if let Ok(Some(conn)) = r {
            out.push(conn);
        }
    }
    out
}

/// Wait before the panes of a status connection that herdr closed are subscribed again.
/// It also limits the retries when herdr closes the new connection at once.
const RESUBSCRIBE_DELAY: Duration = Duration::from_secs(1);

/// The status connections of one stream. Dropping it aborts all of them.
struct StatusConns {
    readers: JoinSet<()>,
    /// Connection id to its reader and the panes it still serves.
    conns: HashMap<u64, (AbortHandle, HashSet<String>)>,
    by_pane: HashMap<String, u64>,
    next: u64,
    /// A reader sends its connection id here when herdr closes the connection.
    ended_tx: mpsc::UnboundedSender<u64>,
    ended_rx: mpsc::UnboundedReceiver<u64>,
    /// Open panes whose connection herdr closed. They are subscribed again at `retry_at`.
    lost: HashSet<String>,
    retry_at: Option<tokio::time::Instant>,
}

impl Default for StatusConns {
    fn default() -> Self {
        let (ended_tx, ended_rx) = mpsc::unbounded_channel();
        StatusConns {
            readers: JoinSet::new(),
            conns: HashMap::new(),
            by_pane: HashMap::new(),
            next: 0,
            ended_tx,
            ended_rx,
            lost: HashSet::new(),
            retry_at: None,
        }
    }
}

impl StatusConns {
    fn covers(&self, pane: &str) -> bool {
        self.by_pane.contains_key(pane)
    }

    /// Forwards the events of `c` into `tx` until herdr closes it.
    fn add(&mut self, mut c: herdr::Client, panes: Vec<String>, tx: mpsc::Sender<Value>) {
        while self.readers.try_join_next().is_some() {}
        self.next += 1;
        let (id, ended) = (self.next, self.ended_tx.clone());
        let handle = self.readers.spawn(async move {
            while let Ok(Some(ev)) = c.next_event().await {
                if tx.send(ev).await.is_err() {
                    return;
                }
            }
            let _ = ended.send(id);
        });
        for p in &panes {
            self.lost.remove(p);
            self.by_pane.insert(p.clone(), id);
        }
        self.conns.insert(id, (handle, panes.into_iter().collect()));
    }

    /// Forgets `pane`. A connection that serves no open pane any more is closed.
    fn pane_closed(&mut self, pane: &str) {
        self.lost.remove(pane);
        let Some(id) = self.by_pane.remove(pane) else { return };
        let Some((handle, panes)) = self.conns.get_mut(&id) else { return };
        panes.remove(pane);
        if panes.is_empty() {
            handle.abort();
            self.conns.remove(&id);
        }
    }

    /// herdr closed connection `id`. Its panes are no longer covered, and they are
    /// subscribed again after `RESUBSCRIBE_DELAY`.
    fn reader_ended(&mut self, id: u64, now: tokio::time::Instant) {
        let Some((_, panes)) = self.conns.remove(&id) else { return };
        for p in panes {
            self.by_pane.remove(&p);
            self.lost.insert(p);
        }
        if !self.lost.is_empty() && self.retry_at.is_none() {
            self.retry_at = Some(now + RESUBSCRIBE_DELAY);
        }
    }

    /// The lost panes that no new connection covers yet, in a stable order. Ends the wait.
    /// A pane whose new connection fails is left out until herdr reports it again.
    fn take_lost(&mut self) -> Vec<String> {
        self.retry_at = None;
        let mut panes: Vec<String> = self.lost.drain().filter(|p| !self.by_pane.contains_key(p)).collect();
        panes.sort();
        panes
    }
}
