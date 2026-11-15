//! Pure rules of the Herdr 2 actions: where a new terminal goes and which labels it gets, the
//! new space and tab ids, the agent command line, the terminals of a tab or space, the
//! `agent.explain` answer, renames and the group list. `core::live` does the calls.
//!
//! herdlingd changes only the labels `herdling.group`, `herdling.name`, `herdr.space` and
//! `herdr.tab`. It never writes the herdr-app layout document.

use serde_json::{json, Map, Value};

use super::groups::GROUP_LABEL;
use super::project::{self, address, agent_kind, agent_status, Projection, PREFIX};
use crate::types::RpcError;

/// The label that renames a task from the phone.
pub const NAME_LABEL: &str = "herdling.name";
/// The Herdr app labels that put a terminal in a space and a tab.
pub const SPACE_LABEL: &str = "herdr.space";
pub const TAB_LABEL: &str = "herdr.tab";

/// Lines of the screen that `explain` shows as evidence.
const EVIDENCE_LINES: usize = 12;

/// Why an action cannot run. It becomes the RPC error.
#[derive(Debug, Clone, PartialEq)]
pub struct ActionError {
    pub code: String,
    pub message: String,
}

impl ActionError {
    fn new(code: &str, message: impl Into<String>) -> ActionError {
        ActionError { code: code.into(), message: message.into() }
    }
    /// `<kind>_not_found` for the id `id`.
    pub fn not_found(kind: &str, id: &str) -> ActionError {
        ActionError::new(&format!("{kind}_not_found"), format!("no {kind} {id}"))
    }
    pub fn unsupported(message: impl Into<String>) -> ActionError {
        ActionError::new(super::route::UNSUPPORTED, message)
    }
    pub fn bad(message: impl Into<String>) -> ActionError {
        ActionError::new("bad_request", message)
    }
}

impl From<ActionError> for RpcError {
    fn from(e: ActionError) -> RpcError {
        RpcError { code: e.code, message: e.message }
    }
}

/// An id as the Herdr app makes them: `prefix` and 32 lower-case hex digits.
pub fn new_id(prefix: &str, bytes: [u8; 16]) -> String {
    let mut s = String::with_capacity(prefix.len() + 32);
    s.push_str(prefix);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// A new space id and a new tab id.
#[derive(Debug, Clone, PartialEq)]
pub struct NewIds {
    pub space: String,
    pub tab: String,
}

/// New random ids (`sp…`, `tb…`).
pub fn fresh_ids() -> NewIds {
    NewIds { space: new_id("sp", rand::random()), tab: new_id("tb", rand::random()) }
}

/// Where a new terminal goes.
#[derive(Debug, Clone, PartialEq)]
pub enum Place {
    /// A Herdr app space (its id, not the workspace id).
    Space(String),
    /// A new Herdr app space.
    NewSpace,
    /// A fallback group named by the `herdling.group` label.
    LabelGroup { key: String, label: String },
    /// A repo or folder group: the folder of the terminal places it.
    Folder { key: String },
}

/// The id after `prefix`, when it is a plain id (no `:` or `/`).
fn plain_after<'a>(id: &'a str, prefix: &str) -> Option<&'a str> {
    id.strip_prefix(prefix).filter(|s| !s.is_empty() && !s.contains([':', '/']))
}

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

/// The place of the workspace id `workspace_id`. None is a new space.
pub fn place_of(workspace_id: Option<&str>, p: &Projection) -> Result<Place, ActionError> {
    let Some(id) = workspace_id else { return Ok(Place::NewSpace) };
    if let Some(space) = plain_after(id, &format!("{PREFIX}space:")) {
        return Ok(Place::Space(space.into()));
    }
    let not_found = || ActionError::not_found("workspace", id);
    let key = plain_after(id, &format!("{PREFIX}g:")).ok_or_else(not_found)?;
    let ws = p.workspaces.iter().find(|w| text(w, "workspace_id") == Some(id)).ok_or_else(not_found)?;
    let label = text(ws, "label").unwrap_or(key).to_string();
    let source = p.panes.iter().find(|e| text(e, "workspace_id") == Some(id)).and_then(|e| text(e, "group_source"));
    Ok(match source {
        Some("label") => Place::LabelGroup { key: key.into(), label },
        _ => Place::Folder { key: key.into() },
    })
}

/// The labels of a new terminal at `place`. A new tab id each time: each agent is its own tab.
pub fn place_labels(place: &Place, ids: &NewIds) -> Map<String, Value> {
    let mut m = Map::new();
    match place {
        Place::Space(s) => {
            m.insert(SPACE_LABEL.into(), json!(s));
            m.insert(TAB_LABEL.into(), json!(ids.tab));
        }
        Place::NewSpace => {
            m.insert(SPACE_LABEL.into(), json!(ids.space));
            m.insert(TAB_LABEL.into(), json!(ids.tab));
        }
        Place::LabelGroup { label, .. } => {
            m.insert(GROUP_LABEL.into(), json!(label));
        }
        Place::Folder { .. } => {}
    }
    m
}

/// The workspace and tab ids that the projection gives the new terminal `addr` at `place`.
/// For a folder group they hold while the terminal stays in the same folder.
pub fn placed_ids(place: &Place, ids: &NewIds, addr: &str) -> (String, String) {
    match place {
        Place::Space(s) => (format!("{PREFIX}space:{s}"), format!("{PREFIX}tab:{}", ids.tab)),
        Place::NewSpace => (format!("{PREFIX}space:{}", ids.space), format!("{PREFIX}tab:{}", ids.tab)),
        Place::LabelGroup { key, .. } | Place::Folder { key } => (format!("{PREFIX}g:{key}"), format!("{PREFIX}task:{addr}")),
    }
}

/// The program of a new terminal: the login shell of the user, as the Herdr app starts it.
/// Empty (the core's own shell) when `shell` is not an absolute path.
pub fn shell_argv(shell: Option<&str>) -> Vec<String> {
    match shell.filter(|s| s.starts_with('/')) {
        Some(s) => vec![s.to_string(), "-l".to_string()],
        None => vec![],
    }
}

/// The `terminal.run` params of a new shell. `keep` as the Herdr app sets it; `no_parent` so
/// a herdlingd that runs in a core terminal does not make the new shell its helper. With no
/// `cwd` the core picks the folder.
pub fn run_params(cwd: Option<&str>, labels: Map<String, Value>, argv: Vec<String>) -> Value {
    let mut p = json!({ "argv": argv, "labels": labels, "keep": true, "no_parent": true });
    if let Some(c) = cwd {
        p["cwd"] = json!(c);
    }
    p
}

/// The herdr 1 answer of `workspace.create` or `tab.create` (`kind`: `workspace_created` or
/// `tab_created`) for the new pane `pane`.
pub fn created(kind: &str, ws: &str, tab: &str, pane: &str) -> Value {
    json!({
        "type": kind,
        "workspace": { "workspace_id": ws },
        "tab": { "tab_id": tab, "workspace_id": ws },
        "root_pane": { "pane_id": pane, "tab_id": tab, "workspace_id": ws },
    })
}

/// `s` as one shell word. Plain words stay as they are; others go in single quotes.
pub fn shell_quote(s: &str) -> String {
    let plain = |c: char| c.is_ascii_alphanumeric() || "_-./=:@%+,".contains(c);
    if !s.is_empty() && s.chars().all(plain) {
        return s.to_string();
    }
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// The command line that starts an agent of `kind` with `args`, as the user types it.
pub fn agent_line(kind: &str, args: &[String]) -> Result<String, ActionError> {
    let program = crate::agents::AGENT_BINS
        .iter()
        .find(|(k, _)| *k == kind)
        .and_then(|(_, bins)| bins.first())
        .ok_or_else(|| ActionError::bad(format!("herdlingd does not know how to start the agent kind \"{kind}\"")))?;
    let mut line = shell_quote(program);
    for a in args {
        line.push(' ');
        line.push_str(&shell_quote(a));
    }
    Ok(line)
}

/// A tab or a workspace of the projection.
#[derive(Debug, Clone, PartialEq)]
pub enum Scope {
    Tab(String),
    Workspace(String),
}

/// The terminal addresses in `scope`, in projection order.
pub fn members(p: &Projection, scope: &Scope) -> Result<Vec<String>, ActionError> {
    let (key, id, kind) = match scope {
        Scope::Tab(id) => ("tab_id", id, "tab"),
        Scope::Workspace(id) => ("workspace_id", id, "workspace"),
    };
    let list: Vec<String> = p
        .panes
        .iter()
        .filter(|e| text(e, key) == Some(id.as_str()))
        .filter_map(|e| text(e, "pane_id").and_then(address).map(String::from))
        .collect();
    let known = match scope {
        Scope::Tab(_) => p.tabs.iter().any(|t| text(t, "tab_id") == Some(id.as_str())),
        Scope::Workspace(_) => p.workspaces.iter().any(|w| text(w, "workspace_id") == Some(id.as_str())),
    };
    if !known {
        return Err(ActionError::not_found(kind, id));
    }
    Ok(list)
}

/// The herdr 1 `workspace.get` answer for the core workspace `id`.
pub fn workspace_get(p: &Projection, id: &str) -> Result<Value, ActionError> {
    let w = p.workspaces.iter().find(|w| text(w, "workspace_id") == Some(id)).ok_or_else(|| ActionError::not_found("workspace", id))?;
    Ok(json!({ "type": "workspace_info", "workspace": w }))
}

/// The herdr 1 `agent.explain` answer for terminal `t` with the screen text `screen`. A core
/// agent reports its own status (OSC 7501), so there are no screen rules: one rule `osc-7501`
/// stands for the report, with the end of the screen as evidence.
pub fn explain(t: &Value, screen: &str) -> Value {
    let lines: Vec<&str> = screen.lines().map(str::trim_end).filter(|l| !l.trim().is_empty()).collect();
    let preview = lines[lines.len().saturating_sub(EVIDENCE_LINES)..].join("\n");
    let kind = agent_kind(t);
    let Some(status) = agent_status(t) else {
        return json!({ "type": "agent_explain", "explain": {
            "agent": kind, "state": "unknown", "matched_rule": null, "evaluated_rules": [],
            "screen_detection_skipped": false,
            "fallback_reason": "this terminal reports no agent status (OSC 7501), so Herdr 2 shows it as a terminal",
        }});
    };
    let state = project::status_word(status);
    let msg = t.pointer("/status/msg").and_then(Value::as_str).filter(|m| !m.trim().is_empty());
    json!({ "type": "agent_explain", "explain": {
        "agent": kind,
        "state": state,
        "manifest_source": "Herdr 2 (herdr-core)",
        "matched_rule": { "id": "osc-7501", "region": "status report", "state": state },
        "evaluated_rules": [{ "id": "osc-7501", "matched": true, "region": "status report", "state": state,
                              "evidence": { "region_preview": preview } }],
        "screen_detection_skipped": true,
        "screen_detection_skip_reason": "the agent reports its own status to Herdr 2 (OSC 7501)",
        "warning": msg.map(|m| format!("Status message: {m}")),
    }})
}

/// The labels of a task rename. An empty or missing name removes the label.
pub fn rename_labels(name: Option<&str>) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert(NAME_LABEL.into(), json!(name.map(str::trim).unwrap_or("")));
    m
}

/// True when the projection puts terminal `addr` in a Herdr app space.
pub fn in_space(addr: &str, p: &Projection) -> bool {
    let pane = project::pane_id(addr);
    p.panes.iter().any(|e| text(e, "pane_id") == Some(pane.as_str()) && text(e, "group_source") == Some("space"))
}

/// The `groups.list` answer: one entry per workspace of the projection, with counts.
pub fn groups(p: &Projection) -> Value {
    let list: Vec<Value> = p
        .workspaces
        .iter()
        .filter_map(|w| {
            let id = text(w, "workspace_id")?;
            let count = |list: &[Value]| list.iter().filter(|e| text(e, "workspace_id") == Some(id)).count();
            let source = p.panes.iter().find(|e| text(e, "workspace_id") == Some(id)).and_then(|e| text(e, "group_source"));
            let space = plain_after(id, &format!("{PREFIX}space:"));
            let mut g = json!({
                "workspace_id": id,
                "label": w.get("label"),
                "source": source.unwrap_or(if space.is_some() { "space" } else { "folder" }),
                "terminals": count(&p.panes),
                "agents": count(&p.agents),
                "agent_status": w.get("agent_status"),
            });
            if let Some(s) = space {
                g["space_id"] = json!(s);
            }
            Some(g)
        })
        .collect();
    json!({ "groups": list })
}

/// Adds the core workspaces to a herdr 1 `workspace.list` answer. With no herdr 1 answer, the
/// core workspaces alone.
pub fn merge_workspace_list(herdr: Option<Value>, p: &Projection) -> Value {
    let mut out = herdr.unwrap_or_else(|| json!({ "type": "workspace_list", "workspaces": [] }));
    if let Some(m) = out.as_object_mut() {
        let list = m.entry("workspaces").or_insert_with(|| json!([]));
        if let Some(a) = list.as_array_mut() {
            a.extend(p.workspaces.iter().cloned());
        }
    }
    out
}

/// The longest group name that `pane.move` and `herdlingd group` accept, in characters.
pub const MAX_GROUP: usize = 64;

/// Checks a group name: trimmed, at most [`MAX_GROUP`] characters, no control characters.
/// An empty name is allowed: it removes the label.
pub fn group_name(name: &str) -> Result<String, ActionError> {
    let n = name.trim();
    if n.chars().count() > MAX_GROUP || n.chars().any(char::is_control) {
        return Err(ActionError::bad(format!("a group name has at most {MAX_GROUP} characters and no control characters")));
    }
    Ok(n.to_string())
}

/// Where `pane.move` puts a terminal.
#[derive(Debug, Clone, PartialEq)]
pub enum MoveTarget {
    /// A workspace id: a Herdr app space, or a label group.
    Workspace(String),
    NewSpace,
    /// A `herdling.group` name. Empty removes the label.
    Group(String),
}

/// The target of `pane.move` params: exactly one of `workspace_id`, `new_space: true`, `group`.
pub fn move_target(params: &Value) -> Result<MoveTarget, ActionError> {
    let ws = params.get("workspace_id").and_then(Value::as_str);
    let new = params.get("new_space").and_then(Value::as_bool) == Some(true);
    let group = params.get("group").and_then(Value::as_str);
    match (ws, new, group) {
        (Some(w), false, None) => Ok(MoveTarget::Workspace(w.to_string())),
        (None, true, None) => Ok(MoveTarget::NewSpace),
        (None, false, Some(g)) => Ok(MoveTarget::Group(group_name(g)?)),
        _ => Err(ActionError::bad("pane.move needs exactly one of workspace_id, new_space or group")),
    }
}

/// The labels that move terminal `addr` to `target`. Only a terminal in no Herdr app space
/// moves: whether the Herdr app moves a terminal that it holds is not known.
pub fn move_labels(addr: &str, target: &MoveTarget, p: &Projection, ids: &NewIds) -> Result<Map<String, Value>, ActionError> {
    let pane = project::pane_id(addr);
    if !p.panes.iter().any(|e| text(e, "pane_id") == Some(pane.as_str())) {
        return Err(ActionError::not_found("pane", &pane));
    }
    if in_space(addr, p) {
        return Err(ActionError::unsupported("this terminal is in a Herdr app space; move it in the Herdr app"));
    }
    match target {
        MoveTarget::NewSpace => Ok(place_labels(&Place::NewSpace, ids)),
        MoveTarget::Group(name) => {
            let mut m = Map::new();
            m.insert(GROUP_LABEL.into(), json!(name));
            Ok(m)
        }
        MoveTarget::Workspace(id) => match place_of(Some(id), p)? {
            Place::Folder { .. } => Err(ActionError::unsupported("a repo or folder group follows the folder of the terminal; give a group name instead")),
            place => Ok(place_labels(&place, ids)),
        },
    }
}

/// The workspace and tab ids of pane `pane` in the projection.
pub fn where_is(p: &Projection, pane: &str) -> Option<(String, String)> {
    let e = p.panes.iter().find(|e| text(e, "pane_id") == Some(pane))?;
    Some((text(e, "workspace_id")?.to_string(), text(e, "tab_id")?.to_string()))
}
