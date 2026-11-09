//! The core terminals that `serve` knows, kept up to date from a subscription snapshot and its
//! events (herdr-core `schema/README.md`, "Events": how to apply each event). Pure: it says
//! which statuses the debouncer must see and which panes it must forget.

use std::collections::HashMap;

use serde_json::Value;

use super::project;
use crate::types::AgentStatus;

/// What the caller does with the debouncer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// The agent in `pane` has `status` now.
    Observe(String, AgentStatus),
    /// The program of `pane` ended: drop its status and pending notice.
    Forget(String),
}

/// Live terminals of this machine, by address.
#[derive(Default)]
pub struct Tracker {
    terminals: HashMap<String, Value>,
}

fn observe(t: &Value) -> Option<Effect> {
    let addr = t.get("address").and_then(Value::as_str)?;
    Some(Effect::Observe(project::pane_id(addr), project::agent_status(t)?))
}

impl Tracker {
    /// Replaces every record with `terminals` (a subscription or `missed` snapshot). Returns
    /// the statuses of the agents, in address order.
    pub fn reset(&mut self, terminals: &[Value]) -> Vec<Effect> {
        self.terminals = terminals
            .iter()
            .filter(|t| project::counts(t))
            .filter_map(|t| Some((t.get("address")?.as_str()?.to_string(), t.clone())))
            .collect();
        let mut addrs: Vec<&String> = self.terminals.keys().collect();
        addrs.sort();
        addrs.into_iter().filter_map(|a| observe(&self.terminals[a])).collect()
    }

    /// The pane ids of the known terminals.
    pub fn panes(&self) -> Vec<String> {
        self.terminals.keys().map(|a| project::pane_id(a)).collect()
    }

    /// The record of core pane `pane`.
    pub fn record(&self, pane: &str) -> Option<&Value> {
        self.terminals.get(project::address(pane)?)
    }

    /// Applies one `event` notification (its params).
    pub fn apply(&mut self, params: &Value) -> Vec<Effect> {
        if params.get("machine").is_some_and(|m| !m.is_null()) {
            return vec![];
        }
        let Some(addr) = params.get("terminal").and_then(Value::as_str).filter(|a| !a.contains('/')) else {
            return vec![];
        };
        let data = params.get("data").cloned().unwrap_or(Value::Null);
        let pane = project::pane_id(addr);
        match params.get("type").and_then(Value::as_str).unwrap_or("") {
            "created" | "restarted" => {
                if !project::counts(&data) {
                    return vec![];
                }
                self.terminals.insert(addr.to_string(), data.clone());
                observe(&data).into_iter().collect()
            }
            "finished" | "removed" | "lost" => {
                self.terminals.remove(addr);
                vec![Effect::Forget(pane)]
            }
            "status" => {
                let Some(t) = self.terminals.get_mut(addr) else { return vec![] };
                if let Some(m) = t.as_object_mut() {
                    m.insert("status".into(), data.get("status").cloned().unwrap_or(Value::Null));
                }
                // A cleared status (null) is not a new state: the pending notice stays.
                observe(t).into_iter().collect()
            }
            key @ ("title" | "labels" | "foreground") => {
                if let Some(m) = self.terminals.get_mut(addr).and_then(Value::as_object_mut) {
                    let v = if key == "foreground" { data } else { data.get(key).cloned().unwrap_or(Value::Null) };
                    m.insert(key.into(), v);
                }
                vec![]
            }
            _ => vec![],
        }
    }
}
