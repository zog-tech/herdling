//! Keeps the order of typing calls to one pane. The rpc loop runs each request in its own
//! task, so two `herdr.call`s that type into the same pane could reach herdr in either order.
//! The loop takes a [`Turn`] for each typing call while it reads the line, in arrival order.
//! The task waits for its turn before it calls herdr, and gives the turn on when it ends.
//! The app can then send keys and lines without waiting for each reply.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::sync::oneshot;

/// One FIFO lane per pane. Shared by every clone.
#[derive(Clone, Default)]
pub struct InputOrder {
    /// The pane id and the end signal of the last turn taken for it.
    tails: Arc<Mutex<HashMap<String, oneshot::Receiver<()>>>>,
}

/// A place in the lane of one pane. Dropping it lets the next turn run.
pub struct Turn {
    prev: Option<oneshot::Receiver<()>>,
    _done: oneshot::Sender<()>,
}

impl Turn {
    /// Waits until every earlier turn of the same pane ended (finished, failed or was aborted).
    pub async fn wait(&mut self) {
        if let Some(prev) = self.prev.as_mut() {
            // An error means the sender was dropped: the earlier turn ended.
            let _ = prev.await;
            self.prev = None;
        }
    }
}

impl InputOrder {
    /// Takes the next turn for `pane`. Call it in arrival order, before the request task starts.
    pub fn take(&self, pane: &str) -> Turn {
        let (tx, rx) = oneshot::channel();
        let prev = self.tails.lock().unwrap().insert(pane.to_string(), rx);
        Turn { prev, _done: tx }
    }

    /// The turn for an rpc request, when it is a `herdr.call` that types into a pane or a `pane.answer`.
    pub fn take_for(&self, method: &str, params: &Value) -> Option<Turn> {
        if method == "pane.answer" {
            let pane = params.get("pane_id").and_then(Value::as_str).filter(|p| !p.is_empty())?;
            return Some(self.take(pane));
        }
        if method != "herdr.call" {
            return None;
        }
        let herdr_method = params.get("method").and_then(Value::as_str)?;
        let empty = Value::Null;
        let herdr_params = params.get("params").unwrap_or(&empty);
        let pane = input_pane(herdr_method, herdr_params)?;
        Some(self.take(pane))
    }
}

/// herdr methods that type into a pane, with the param that names the pane.
const INPUT_METHODS: &[(&str, &str)] = &[
    ("pane.send_text", "pane_id"),
    ("pane.send_keys", "pane_id"),
    ("pane.send_input", "pane_id"),
    ("agent.prompt", "target"),
    ("agent.send_keys", "target"),
];

/// The pane that a `herdr.call` of `method` with `params` types into, if it is input.
pub fn input_pane<'a>(method: &str, params: &'a Value) -> Option<&'a str> {
    let (_, key) = INPUT_METHODS.iter().find(|(m, _)| *m == method)?;
    params.get(*key).and_then(Value::as_str).filter(|p| !p.is_empty())
}
