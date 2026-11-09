//! Core notifications as herdr 1 event lines, so the app stream of `herdr.subscribe` carries
//! them with `hc:` pane ids. Pure.
//!
//! | core | herdr 1 line |
//! |---|---|
//! | `status` with a status | `pane.agent_status_changed` |
//! | `status` cleared | `pane.agent_detected` with `released: true` |
//! | `created`, `restarted` | `pane.created` |
//! | `finished`, `removed` | `pane.closed` |
//! | `lost`, `doc` of herdr-app, `missed` | [`refetch_hint`] |
//!
//! Other events (`title`, `labels`, `foreground`, `size`, `turn`, `keep`) give nothing: the
//! app reads them at its next snapshot. Terminals of other machines give nothing.

use serde_json::{json, Value};

use super::client::Notice;
use super::project::{self, LAYOUT_DOC};

/// An event that makes every app read the snapshot again, and that no other part acts on.
pub fn refetch_hint() -> Value {
    json!({ "event": "layout.updated", "data": { "type": "layout_updated", "backend": project::BACKEND } })
}

/// The local terminal address of event params, when the event is about one.
fn local_terminal(params: &Value) -> Option<&str> {
    if params.get("machine").is_some_and(|m| !m.is_null()) {
        return None;
    }
    params.get("terminal").and_then(Value::as_str).filter(|a| !a.is_empty() && !a.contains('/'))
}

/// The herdr 1 line for one core notification, if any.
pub fn translate(n: &Notice) -> Option<Value> {
    let params = match n {
        Notice::Heartbeat(_) => return None,
        Notice::Missed(_) => return Some(refetch_hint()),
        Notice::Event(p) => p,
    };
    let data = params.get("data").unwrap_or(&Value::Null);
    let kind = params.get("type").and_then(Value::as_str).unwrap_or("");
    if kind == "doc" {
        let local = params.get("machine").is_none_or(Value::is_null);
        let ours = data.get("name").and_then(Value::as_str) == Some(LAYOUT_DOC);
        return (local && ours).then(refetch_hint);
    }
    let pane = project::pane_id(local_terminal(params)?);
    match kind {
        "status" => Some(match project::map_status(data.get("status").filter(|s| !s.is_null())) {
            Some(s) => json!({ "event": "pane.agent_status_changed", "data": {
                "type": "pane_agent_status_changed", "pane_id": pane, "agent_status": s, "backend": project::BACKEND,
            }}),
            None => json!({ "event": "pane.agent_detected", "data": {
                "type": "pane_agent_detected", "pane_id": pane, "agent": null, "released": true, "backend": project::BACKEND,
            }}),
        }),
        "created" | "restarted" => Some(json!({ "event": "pane.created", "data": {
            "type": "pane_created", "pane": { "pane_id": pane, "backend": project::BACKEND },
        }})),
        "finished" | "removed" => Some(json!({ "event": "pane.closed", "data": {
            "type": "pane_closed", "pane_id": pane, "backend": project::BACKEND,
        }})),
        "lost" => Some(refetch_hint()),
        _ => None,
    }
}
