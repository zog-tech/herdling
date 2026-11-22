//! The "read" state of an agent, kept on the computer, so that it survives an app reinstall
//! and every phone sees the same state. Pure: the terminal record comes in.
//!
//! - `herdling.seen` (written by `agent.mark_seen`): the last turn whose result the user saw
//!   in Herdling. It only grows.
//! - `herdr.seen` (written by the Herdr desktop app, read only here): the same for the desktop.
//!   herdlingd never changes it.
//!
//! The core `turn` goes up each time the status leaves `working`. So the turn of a terminal is
//! always the last turn whose result (or question) shows, and the label never passes it.

use serde_json::{json, Map, Value};

/// The label that `agent.mark_seen` writes.
pub const SEEN_LABEL: &str = "herdling.seen";
/// The label that the Herdr desktop app writes.
pub const HERDR_SEEN_LABEL: &str = "herdr.seen";

/// The turn counter of terminal `t`, when the core sends one.
pub fn turn(t: &Value) -> Option<u64> {
    t.get("turn").and_then(Value::as_u64)
}

/// The turn in label `key` of terminal `t`. None when the label is missing or not a number.
pub fn label_turn(t: &Value, key: &str) -> Option<u64> {
    t.get("labels")?.get(key)?.as_str()?.trim().parse().ok()
}

/// What `agent.mark_seen` does with the label.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mark {
    /// Write `herdling.seen` with this turn.
    Write(u64),
    /// Write nothing. The value is the turn that the label holds now (0 when it has none).
    Keep(u64),
}

/// The mark for terminal `t` when the app says the user saw turn `sent`. The new value is never
/// higher than the current turn of `t` and never lower than the label.
pub fn mark(t: &Value, sent: u64) -> Mark {
    let old = label_turn(t, SEEN_LABEL).unwrap_or(0);
    let new = sent.min(turn(t).unwrap_or(0));
    if new > old {
        Mark::Write(new)
    } else {
        Mark::Keep(old)
    }
}

/// The labels for a [`Mark::Write`].
pub fn labels(turn: u64) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert(SEEN_LABEL.into(), json!(turn.to_string()));
    m
}

/// Adds `turn`, `seen_turn` and `herdr_seen_turn` of terminal `t` to an agent entry. A field is
/// left out when the value is not known.
pub fn add_fields(entry: &mut Value, t: &Value) {
    let Some(m) = entry.as_object_mut() else { return };
    if let Some(n) = turn(t) {
        m.insert("turn".into(), json!(n));
    }
    if let Some(n) = label_turn(t, SEEN_LABEL) {
        m.insert("seen_turn".into(), json!(n));
    }
    if let Some(n) = label_turn(t, HERDR_SEEN_LABEL) {
        m.insert("herdr_seen_turn".into(), json!(n));
    }
}
