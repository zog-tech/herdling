//! Fake herdr with event subscriptions, shared by the subscribe and serve tests.
#![allow(dead_code)]

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::mpsc;

/// Commands the test sends to the fake herdr.
pub enum Push {
    /// Delivered to every subscription connection with a matching subscription.
    Event(Value),
    /// Closes the first subscription connection (the lifecycle one).
    Drop,
}

fn event_name(v: &Value) -> String {
    v["event"].as_str().unwrap_or("").replace('.', "_")
}

/// Counts open connections while alive.
struct OpenGuard(Arc<AtomicUsize>);
impl Drop for OpenGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// A `pane.agent_status_changed` event line as herdr sends it.
pub fn status_ev(pane: &str, status: &str) -> Value {
    json!({"event": "pane.agent_status_changed",
           "data": {"type": "pane_agent_status_changed", "pane_id": pane, "workspace_id": "w1", "agent_status": status}})
}

/// Fake herdr whose `session.snapshot` lists `panes`. See [`spawn_fake_snapshot`].
pub fn spawn_fake_opts(
    path: &Path,
    panes: &[&str],
    reject: &[&str],
) -> (mpsc::UnboundedSender<Push>, mpsc::UnboundedReceiver<Value>, Arc<AtomicUsize>) {
    let snapshot = json!({"snapshot": {"panes": panes.iter().map(|p| json!({"pane_id": p})).collect::<Vec<_>>()}});
    spawn_fake_snapshot(path, snapshot, reject)
}

/// Fake herdr: accepts many connections. `session.snapshot` returns `snapshot`;
/// `events.subscribe` is acknowledged, its params are sent to the returned receiver,
/// and pushed events reach the connections whose subscriptions match, like herdr does
/// (a subscription with a `pane_id` only matches events of that pane). An
/// `events.subscribe` that names a pane in `reject` fails with `pane_not_found`. The
/// returned counter holds the number of open connections.
pub fn spawn_fake_snapshot(
    path: &Path,
    snapshot: Value,
    reject: &[&str],
) -> (mpsc::UnboundedSender<Push>, mpsc::UnboundedReceiver<Value>, Arc<AtomicUsize>) {
    let open = Arc::new(AtomicUsize::new(0));
    let open2 = open.clone();
    let reject: Vec<String> = reject.iter().map(|s| s.to_string()).collect();
    let listener = UnixListener::bind(path).unwrap();
    let (push_tx, mut push_rx) = mpsc::unbounded_channel::<Push>();
    let (req_tx, req_rx) = mpsc::unbounded_channel::<Value>();
    let (bus, _) = tokio::sync::broadcast::channel::<Option<Value>>(64);
    let bus2 = bus.clone();
    tokio::spawn(async move {
        while let Some(p) = push_rx.recv().await {
            match p {
                Push::Event(v) => {
                    let _ = bus2.send(Some(v));
                }
                Push::Drop => {
                    let _ = bus2.send(None);
                }
            }
        }
    });
    tokio::spawn(async move {
        let mut first = true;
        loop {
            let Ok((stream, _)) = listener.accept().await else { return };
            let req_tx = req_tx.clone();
            let snapshot = snapshot.clone();
            let mut bus_rx = bus.subscribe();
            let is_first = std::mem::replace(&mut first, false);
            open2.fetch_add(1, Ordering::SeqCst);
            let guard = OpenGuard(open2.clone());
            let reject = reject.clone();
            tokio::spawn(async move {
                let _guard = guard;
                let (r, mut w) = stream.into_split();
                let mut lines = BufReader::new(r).lines();
                let mut subs: Vec<Value> = vec![];
                let mut main = false;
                loop {
                    tokio::select! {
                        line = lines.next_line() => {
                            let Ok(Some(line)) = line else { return };
                            let req: Value = serde_json::from_str(&line).unwrap();
                            let asked = req["params"]["subscriptions"].as_array().cloned().unwrap_or_default();
                            let rejected = req["method"] == "events.subscribe"
                                && asked.iter().any(|s| s["pane_id"].as_str().is_some_and(|p| reject.iter().any(|r| r == p)));
                            if rejected {
                                let _ = req_tx.send(req.clone());
                                let e = json!({"id": req["id"], "error": {"code": "pane_not_found", "message": "no such pane"}});
                                if w.write_all(format!("{e}\n").as_bytes()).await.is_err() { return; }
                                continue;
                            }
                            let result = match req["method"].as_str().unwrap() {
                                "session.snapshot" => snapshot.clone(),
                                "events.subscribe" => {
                                    subs = req["params"]["subscriptions"].as_array().unwrap().clone();
                                    main = is_first;
                                    let _ = req_tx.send(req.clone());
                                    json!({"type": "subscription_started"})
                                }
                                _ => json!({}),
                            };
                            let ack = json!({"id": req["id"], "result": result});
                            if w.write_all(format!("{ack}\n").as_bytes()).await.is_err() { return; }
                        }
                        ev = bus_rx.recv() => {
                            match ev {
                                Ok(Some(v)) => {
                                    let name = event_name(&v);
                                    let pane = v["data"]["pane_id"].as_str();
                                    let hit = subs.iter().any(|s| {
                                        s["type"].as_str().unwrap_or("").replace('.', "_") == name
                                            && s["pane_id"].as_str().is_none_or(|p| Some(p) == pane)
                                    });
                                    if hit && w.write_all(format!("{v}\n").as_bytes()).await.is_err() { return; }
                                }
                                Ok(None) => { if main { return; } }
                                Err(_) => return,
                            }
                        }
                    }
                }
            });
        }
    });
    (push_tx, req_rx, open)
}
