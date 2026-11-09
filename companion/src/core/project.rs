//! The herdr-core terminals as entries of a herdr 1 `session.snapshot`, so every app build
//! shows them. Pure: the terminal records and the herdr-app layout document come in.
//!
//! - Ids start with [`PREFIX`]: panes `hc:<address>` (`hc:t7`), workspaces `hc:space:<id>`,
//!   tabs `hc:tab:<id>`. Each entry has `backend: "core"`.
//! - Spaces and tabs come from the herdr-app document (`doc.get {name: "herdr-app"}`:
//!   `{spaces: [{id, name, folder, tabs: [{id, name, root}]}]}`, herdr-app `src/mirror.rs`).
//!   A terminal in no tab goes to the workspace [`LOOSE_WORKSPACE`].
//! - Only live terminals of this machine count. Addresses of other machines (`box/t7`) are left out.
//! - A terminal is an agent only when its program reports an OSC 7501 status.

use std::collections::HashSet;

use serde_json::{json, Map, Value};

use crate::types::AgentStatus;

/// The prefix of every core id.
pub const PREFIX: &str = "hc:";
/// The workspace of the terminals that are in no herdr-app space.
pub const LOOSE_WORKSPACE: &str = "hc:loose";
/// The one tab of [`LOOSE_WORKSPACE`].
pub const LOOSE_TAB: &str = "hc:loose:tab";
/// Labels of the loose workspace and its tab.
pub const LOOSE_WORKSPACE_LABEL: &str = "Herdr 2 terminals";
pub const LOOSE_TAB_LABEL: &str = "Terminals";
/// The value of the `backend` field.
pub const BACKEND: &str = "core";
/// The name of the layout document of herdr-app.
pub const LAYOUT_DOC: &str = "herdr-app";

/// True for an id of a core entry.
pub fn is_core_id(id: &str) -> bool {
    id.starts_with(PREFIX)
}

/// The pane id of a terminal address.
pub fn pane_id(address: &str) -> String {
    format!("{PREFIX}{address}")
}

/// The terminal address of a core pane id. None for other ids, workspace and tab ids, and
/// addresses of other machines.
pub fn address(pane_id: &str) -> Option<&str> {
    let a = pane_id.strip_prefix(PREFIX)?;
    (!a.is_empty() && !a.contains(':') && !a.contains('/')).then_some(a)
}

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.trim().is_empty())
}

/// True for a live terminal of this machine.
pub fn counts(t: &Value) -> bool {
    let local = text(t, "address").is_some_and(|a| !a.contains('/'));
    local && t.get("state").and_then(Value::as_str).is_none_or(|s| s == "live")
}

/// The Herdling status of a 7501 status record. None when the record is missing or null.
/// `blocked` and `error` both ask for the user.
pub fn map_status(status: Option<&Value>) -> Option<AgentStatus> {
    let state = status?.get("state")?.as_str()?;
    Some(match state {
        "idle" => AgentStatus::Idle,
        "working" => AgentStatus::Working,
        "done" => AgentStatus::Done,
        "blocked" | "error" => AgentStatus::Blocked,
        _ => AgentStatus::Unknown,
    })
}

fn status_word(s: AgentStatus) -> &'static str {
    match s {
        AgentStatus::Idle => "idle",
        AgentStatus::Working => "working",
        AgentStatus::Blocked => "blocked",
        AgentStatus::Done => "done",
        AgentStatus::Unknown => "unknown",
    }
}

/// The status of terminal `t` as an agent. None when it is not an agent.
pub fn agent_status(t: &Value) -> Option<AgentStatus> {
    map_status(t.get("status").filter(|s| !s.is_null()))
}

/// The agent kind: the reported app as a Herdling kind when it is a known one, else the app in
/// lower case, else the name of the foreground process.
pub fn agent_kind(t: &Value) -> Option<String> {
    let app = t.get("status").and_then(|s| text(s, "app")).map(|a| a.trim().to_lowercase());
    if let Some(app) = app {
        for known in ["claude", "codex", "opencode", "gemini", "omp"] {
            if app.contains(known) {
                return Some(known.into());
            }
        }
        return Some(app);
    }
    t.get("foreground").and_then(|f| text(f, "name")).map(String::from)
}

/// The cwd now: the folder of the foreground process, else the start folder.
fn cwd_now(t: &Value) -> Option<&str> {
    t.get("foreground").and_then(|f| text(f, "cwd")).or_else(|| text(t, "cwd"))
}

/// The title of the terminal: the 7501 title, else the terminal title.
fn title(t: &Value) -> Option<&str> {
    t.get("status").and_then(|s| text(s, "title")).or_else(|| text(t, "title"))
}

/// Push title and body for terminal `t`. Title: the terminal name, else the 7501 title, else
/// the app, else the address. Body: the app and the 7501 message.
pub fn push_text(t: &Value) -> (String, String) {
    let status = t.get("status").unwrap_or(&Value::Null);
    let app = text(status, "app");
    let title = text(t, "name")
        .or_else(|| text(status, "title"))
        .or(app)
        .or_else(|| text(t, "address"))
        .unwrap_or("terminal")
        .to_string();
    let body = [app.filter(|a| *a != title), text(status, "msg")].into_iter().flatten().collect::<Vec<_>>().join(" · ");
    (title, body)
}

/// Unix seconds when the current status began, when the core says.
pub fn status_since(t: &Value) -> Option<i64> {
    t.get("status_ms").and_then(Value::as_u64).map(|ms| (ms / 1000) as i64)
}

/// The terminal addresses of a herdr-app layout node, in tree order (blocks, then floats).
fn layout_terminals(node: &Value, out: &mut Vec<String>) {
    match node {
        Value::Object(m) => {
            if let Some(t) = m.get("content").and_then(|c| c.get("terminal")).and_then(Value::as_str) {
                out.push(t.to_string());
            }
            for (k, v) in m {
                if k != "content" {
                    layout_terminals(v, out);
                }
            }
        }
        Value::Array(a) => a.iter().for_each(|v| layout_terminals(v, out)),
        _ => {}
    }
}

/// Snapshot entries of the core.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Projection {
    pub workspaces: Vec<Value>,
    pub tabs: Vec<Value>,
    pub panes: Vec<Value>,
    pub agents: Vec<Value>,
}

impl Projection {
    /// A `session.snapshot` result with these entries only.
    pub fn snapshot(&self) -> Value {
        json!({ "snapshot": {
            "workspaces": self.workspaces, "tabs": self.tabs, "panes": self.panes, "agents": self.agents,
        }})
    }
}

/// The status that sums up `statuses`: blocked, then working, done, idle; else unknown.
fn sum_status(statuses: &[AgentStatus]) -> AgentStatus {
    for s in [AgentStatus::Blocked, AgentStatus::Working, AgentStatus::Done, AgentStatus::Idle] {
        if statuses.contains(&s) {
            return s;
        }
    }
    AgentStatus::Unknown
}

/// The pane entry of terminal `t`.
pub fn pane_entry(t: &Value, tab: &str, ws: &str) -> Value {
    let addr = text(t, "address").unwrap_or("");
    let mut p = json!({
        "pane_id": pane_id(addr),
        "tab_id": tab,
        "workspace_id": ws,
        "label": text(t, "name"),
        "agent": agent_status(t).and(agent_kind(t)),
        "cwd": text(t, "cwd"),
        "foreground_cwd": t.get("foreground").and_then(|f| text(f, "cwd")),
        "terminal_title_stripped": title(t),
        "backend": BACKEND,
    });
    if let Some(s) = agent_status(t) {
        p["agent_status"] = json!(status_word(s));
    }
    p
}

/// The agent entry of terminal `t`, when it is an agent.
pub fn agent_entry(t: &Value, tab: &str, ws: &str) -> Option<Value> {
    let status = agent_status(t)?;
    let addr = text(t, "address")?;
    let seq = t.get("status_ms").and_then(Value::as_u64).or_else(|| t.get("turn").and_then(Value::as_u64)).unwrap_or(0);
    Some(json!({
        "pane_id": pane_id(addr),
        "tab_id": tab,
        "workspace_id": ws,
        "agent": agent_kind(t),
        "display_agent": t.get("status").and_then(|s| text(s, "app")),
        "agent_status": status_word(status),
        "cwd": cwd_now(t),
        "state_change_seq": seq,
        "terminal_title_stripped": title(t),
        "name": text(t, "name"),
        "backend": BACKEND,
    }))
}

/// The snapshot entries of `terminals` (records of `terminal.list` or of a subscription
/// snapshot), placed by the herdr-app `doc` (the `value` of `doc.get`) when there is one.
pub fn project(terminals: &[Value], doc: Option<&Value>) -> Projection {
    let live: Vec<&Value> = terminals.iter().filter(|t| counts(t)).collect();
    let by_addr = |a: &str| live.iter().copied().find(|t| text(t, "address") == Some(a));
    let mut placed: HashSet<String> = HashSet::new();
    let mut out = Projection::default();
    let spaces = doc.and_then(|d| d.get("spaces")).and_then(Value::as_array).cloned().unwrap_or_default();
    for (si, space) in spaces.iter().enumerate() {
        let Some(sid) = text(space, "id") else { continue };
        let ws = format!("{PREFIX}space:{sid}");
        let label = text(space, "name")
            .map(String::from)
            .or_else(|| text(space, "folder").and_then(|f| f.trim_end_matches('/').rsplit('/').next()).map(String::from))
            .unwrap_or_else(|| format!("Space {}", si + 1));
        let tabs = space.get("tabs").and_then(Value::as_array).cloned().unwrap_or_default();
        let mut ws_statuses = Vec::new();
        let mut tab_count = 0;
        for (ti, tab) in tabs.iter().enumerate() {
            let Some(tid) = text(tab, "id") else { continue };
            tab_count += 1;
            let tab_id = format!("{PREFIX}tab:{tid}");
            let mut addrs = Vec::new();
            layout_terminals(tab.get("root").unwrap_or(&Value::Null), &mut addrs);
            let mut statuses = Vec::new();
            for a in addrs {
                let Some(t) = by_addr(&a) else { continue };
                if !placed.insert(a) {
                    continue;
                }
                out.panes.push(pane_entry(t, &tab_id, &ws));
                if let Some(agent) = agent_entry(t, &tab_id, &ws) {
                    statuses.extend(agent_status(t));
                    out.agents.push(agent);
                }
            }
            let label = text(tab, "name").map(String::from).unwrap_or_else(|| format!("Tab {}", ti + 1));
            out.tabs.push(json!({
                "tab_id": tab_id, "workspace_id": ws, "label": label, "number": ti + 1,
                "agent_status": status_word(sum_status(&statuses)), "backend": BACKEND,
            }));
            ws_statuses.extend(statuses);
        }
        out.workspaces.push(json!({
            "workspace_id": ws, "label": label, "number": si + 1, "tab_count": tab_count,
            "agent_status": status_word(sum_status(&ws_statuses)), "backend": BACKEND,
        }));
    }
    let loose: Vec<&Value> = live.iter().copied().filter(|t| text(t, "address").is_some_and(|a| !placed.contains(a))).collect();
    if !loose.is_empty() {
        let mut statuses = Vec::new();
        for t in loose {
            out.panes.push(pane_entry(t, LOOSE_TAB, LOOSE_WORKSPACE));
            if let Some(agent) = agent_entry(t, LOOSE_TAB, LOOSE_WORKSPACE) {
                statuses.extend(agent_status(t));
                out.agents.push(agent);
            }
        }
        let sum = status_word(sum_status(&statuses));
        out.tabs.push(json!({
            "tab_id": LOOSE_TAB, "workspace_id": LOOSE_WORKSPACE, "label": LOOSE_TAB_LABEL, "number": 1,
            "agent_status": sum, "backend": BACKEND,
        }));
        out.workspaces.push(json!({
            "workspace_id": LOOSE_WORKSPACE, "label": LOOSE_WORKSPACE_LABEL, "number": spaces.len() + 1,
            "tab_count": 1, "agent_status": sum, "backend": BACKEND,
        }));
    }
    out
}

/// Adds the core entries to a herdr 1 `session.snapshot` result. The herdr 1 fields stay as
/// they are; the four lists get the core entries at the end.
pub fn merge_into(herdr: Value, core: &Projection) -> Value {
    let mut herdr = herdr;
    let has_inner = herdr.get("snapshot").is_some_and(Value::is_object);
    let snap = if has_inner { &mut herdr["snapshot"] } else { &mut herdr };
    let Some(obj) = snap.as_object_mut() else { return core.snapshot() };
    for (key, extra) in [("workspaces", &core.workspaces), ("tabs", &core.tabs), ("panes", &core.panes), ("agents", &core.agents)] {
        let list = obj.entry(key).or_insert_with(|| Value::Array(vec![]));
        if let Some(a) = list.as_array_mut() {
            a.extend(extra.iter().cloned());
        }
    }
    herdr
}

/// `session.snapshot` of both backends. Each side fails on its own: with no core (`None`) the
/// herdr 1 answer is returned as it is; with herdr 1 down and the core up, the core part alone.
pub fn merge_snapshots<E>(herdr: Result<Value, E>, core: Option<Projection>) -> Result<Value, E> {
    match (herdr, core) {
        (Ok(h), None) => Ok(h),
        (Ok(h), Some(c)) => Ok(merge_into(h, &c)),
        (Err(_), Some(c)) => Ok(c.snapshot()),
        (Err(e), None) => Err(e),
    }
}

/// The herdr 1 `pane.get` answer for terminal `t`.
pub fn pane_get(t: &Value) -> Value {
    let mut pane = pane_entry(t, "", "");
    if let Some(m) = pane.as_object_mut() {
        m.remove("tab_id");
        m.remove("workspace_id");
    }
    json!({ "type": "pane_info", "pane": pane })
}

/// The herdr 1 `pane.process_info` answer for terminal `t`: the program of the terminal stands
/// for the shell, and the foreground process group leader for the foreground.
pub fn process_info(t: &Value) -> Value {
    let addr = text(t, "address").unwrap_or("");
    let fg = t.get("foreground").filter(|f| f.is_object());
    let mut info = Map::new();
    info.insert("pane_id".into(), json!(pane_id(addr)));
    info.insert("shell_pid".into(), t.get("pid").cloned().unwrap_or(Value::Null));
    info.insert("foreground_process_group_id".into(), fg.and_then(|f| f.get("pid")).cloned().unwrap_or(Value::Null));
    let procs: Vec<Value> = fg
        .map(|f| vec![json!({ "pid": f.get("pid"), "name": f.get("name"), "argv": f.get("argv") })])
        .unwrap_or_default();
    info.insert("foreground_processes".into(), Value::Array(procs));
    json!({ "type": "pane_process_info", "process_info": info })
}
