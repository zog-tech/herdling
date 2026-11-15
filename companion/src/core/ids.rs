//! The ids of Herdr 2 entries in the herdr 1 shapes of the app RPC (herdlingd 0.2.0 and later).
//!
//! | Kind | Id |
//! |---|---|
//! | pane (terminal) | the terminal address: no `:` and no `/` (`t7`) |
//! | workspace of a Herdr app space | `space:<space id>` |
//! | workspace of a fallback group | `g:<group key>` |
//! | tab of a Herdr app tab | `tab:<tab id>` |
//! | task tab (one terminal) | `task:<address>` |
//!
//! A pane id has no `:`, and every other id has a kind word and a `:`, so the kinds never
//! collide. herdlingd 0.1.x put `hc:` before each id. An input id loses that prefix once, so the
//! saved state of an app that talked to 0.1.x names the same entry. The old `hc:loose` becomes
//! `loose`, which names nothing.

use serde_json::Value;

/// The prefix of the ids of herdlingd 0.1.x.
pub const LEGACY_PREFIX: &str = "hc:";

/// The keys of the RPC params that hold an entry id.
pub const ID_KEYS: [&str; 4] = ["pane_id", "target", "tab_id", "workspace_id"];

/// `id` without the legacy `hc:` prefix (removed once).
pub fn strip_legacy(id: &str) -> &str {
    id.strip_prefix(LEGACY_PREFIX).unwrap_or(id)
}

/// Removes the legacy prefix from each id key of `params`, and of `params.params` (the inner
/// params of `herdr.call`).
pub fn strip_params(params: &mut Value) {
    fn one(v: &mut Value) {
        let Some(m) = v.as_object_mut() else { return };
        for k in ID_KEYS {
            if let Some(Value::String(s)) = m.get_mut(k) {
                if let Some(rest) = s.strip_prefix(LEGACY_PREFIX) {
                    *s = rest.to_string();
                }
            }
        }
    }
    one(params);
    if let Some(inner) = params.get_mut("params") {
        one(inner);
    }
}

/// True for a plain id part: not empty, no `:` and no `/`.
fn plain(s: &str) -> bool {
    !s.is_empty() && !s.contains([':', '/'])
}

/// The pane id of the terminal address `addr`.
pub fn pane(addr: &str) -> String {
    addr.to_string()
}

/// The workspace id of the Herdr app space `id`.
pub fn space_ws(id: &str) -> String {
    format!("space:{id}")
}

/// The workspace id of the fallback group `key`.
pub fn group_ws(key: &str) -> String {
    format!("g:{key}")
}

/// The tab id of the Herdr app tab `id`.
pub fn space_tab(id: &str) -> String {
    format!("tab:{id}")
}

/// The tab id of the task tab of terminal `addr`.
pub fn task_tab(addr: &str) -> String {
    format!("task:{addr}")
}

/// The terminal address of a pane id. None for ids of other kinds and for addresses of other
/// machines (they contain `/`).
pub fn address(id: &str) -> Option<&str> {
    let a = strip_legacy(id);
    plain(a).then_some(a)
}

/// A workspace id, parsed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Workspace<'a> {
    Space(&'a str),
    Group(&'a str),
}

/// The kind and the inner id of a workspace id. None for other ids.
pub fn workspace(id: &str) -> Option<Workspace<'_>> {
    let id = strip_legacy(id);
    if let Some(s) = id.strip_prefix("space:").filter(|s| plain(s)) {
        return Some(Workspace::Space(s));
    }
    id.strip_prefix("g:").filter(|s| plain(s)).map(Workspace::Group)
}

/// A tab id, parsed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab<'a> {
    Space(&'a str),
    Task(&'a str),
}

/// The kind and the inner id of a tab id. None for other ids.
pub fn tab(id: &str) -> Option<Tab<'_>> {
    let id = strip_legacy(id);
    if let Some(s) = id.strip_prefix("tab:").filter(|s| plain(s)) {
        return Some(Tab::Space(s));
    }
    id.strip_prefix("task:").filter(|s| plain(s)).map(Tab::Task)
}
