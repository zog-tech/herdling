//! The herdr-core terminals as entries of a herdr 1 `session.snapshot`, so every app build
//! shows them. Pure: the terminal records and the herdr-app layout document come in.
//!
//! - Ids start with [`PREFIX`]: panes `hc:<address>` (`hc:t7`), workspaces `hc:space:<id>` and
//!   `hc:g:<group key>`, tabs `hc:tab:<id>` and `hc:task:<address>`. Each entry has
//!   `backend: "core"`.
//! - Each terminal is placed once, by the first rule that applies:
//!   1. The herdr-app document (`doc.get {name: "herdr-app"}`:
//!      `{spaces: [{id, name, folder, tabs: [{id, name, root}]}]}`, herdr-app `src/mirror.rs`).
//!   2. The `herdr.space` and `herdr.tab` labels, for a terminal that no document tab holds.
//!      A space or tab that the document has is reused.
//!   3. A helper goes into the tab of its parent, when rule 3 or 4 placed the parent.
//!   4. All other terminals: one task tab each, in the workspace of their group
//!      ([`groups::fallback_group`]: the label, the repo or the folder).
//! - Core agent and pane entries also have `group`, `group_source` and, when the repo is known,
//!   `repo`, `repo_root` and `branch`.
//! - Only live terminals of this machine count. Addresses of other machines (`box/t7`) are left out.
//! - A terminal is an agent only when its program reports an OSC 7501 status.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::{json, Map, Value};

use super::groups::{self, folder_of, label_space, live_parent, task_name, GroupSource, Repos};
use crate::types::AgentStatus;

/// The prefix of every core id.
pub const PREFIX: &str = "hc:";
/// The agent kinds that the app knows by name. Their entries have no `display_agent`.
const KNOWN_KINDS: [&str; 5] = ["claude", "codex", "opencode", "gemini", "omp"];
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

pub(crate) fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
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
        for known in KNOWN_KINDS {
            if app.contains(known) {
                return Some(known.into());
            }
        }
        return Some(app);
    }
    t.get("foreground").and_then(|f| text(f, "name")).map(String::from)
}

/// The cwd now: the folder of the foreground process, else the start folder.
pub(crate) fn cwd_now(t: &Value) -> Option<&str> {
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
        "label": task_name(t),
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
    let kind = agent_kind(t);
    let known = kind.as_deref().is_some_and(|k| KNOWN_KINDS.contains(&k));
    let display = t.get("status").and_then(|s| text(s, "app")).filter(|_| !known);
    Some(json!({
        "pane_id": pane_id(addr),
        "tab_id": tab,
        "workspace_id": ws,
        "agent": kind,
        "display_agent": display,
        "agent_status": status_word(status),
        "cwd": cwd_now(t),
        "state_change_seq": seq,
        "terminal_title_stripped": title(t),
        "name": task_name(t),
        "backend": BACKEND,
    }))
}

/// The group fields of a placed terminal.
#[derive(Clone)]
struct Grouping {
    label: String,
    source: GroupSource,
}

/// Adds `group`, `group_source` and the known repo fields of terminal `t` to `entry`.
fn add_group_fields(entry: &mut Value, t: &Value, g: &Grouping, repos: &Repos) {
    let Some(m) = entry.as_object_mut() else { return };
    m.insert("group".into(), json!(g.label));
    m.insert("group_source".into(), json!(g.source.word()));
    if let Some(Some(r)) = folder_of(t).and_then(|f| repos.get(f)) {
        m.insert("repo".into(), json!(r.name));
        m.insert("repo_root".into(), json!(r.root));
        if let Some(b) = &r.branch {
            m.insert("branch".into(), json!(b));
        }
    }
}

/// The last part of the folder of `t`.
fn folder_name(t: &Value) -> Option<String> {
    folder_of(t)?.trim_end_matches('/').rsplit('/').next().filter(|s| !s.is_empty()).map(String::from)
}

/// The first terminal of `space` in tree order that is live on this machine.
fn first_terminal<'a>(space: &Value, by_addr: &impl Fn(&str) -> Option<&'a Value>) -> Option<&'a Value> {
    let mut addrs = Vec::new();
    for tab in space.get("tabs").and_then(Value::as_array)? {
        layout_terminals(tab.get("root").unwrap_or(&Value::Null), &mut addrs);
    }
    addrs.iter().find_map(|a| by_addr(a))
}

/// The label of the own tab of terminal `t`: the task name, else the agent kind, else the address.
fn task_label(t: &Value) -> String {
    task_name(t).or_else(|| agent_kind(t)).or_else(|| text(t, "address").map(String::from)).unwrap_or_default()
}

struct TabAcc {
    id: String,
    label: String,
    statuses: Vec<AgentStatus>,
}

struct WsAcc {
    id: String,
    label: String,
    tabs: Vec<TabAcc>,
}

/// Collects the entries. Workspaces and tabs keep the order of first use.
struct Builder<'r> {
    repos: &'r Repos,
    ws: Vec<WsAcc>,
    panes: Vec<Value>,
    agents: Vec<Value>,
}

impl Builder<'_> {
    /// The index of workspace `id`. A new workspace gets `label`.
    fn ws(&mut self, id: String, label: impl FnOnce() -> String) -> usize {
        if let Some(i) = self.ws.iter().position(|w| w.id == id) {
            return i;
        }
        self.ws.push(WsAcc { id, label: label(), tabs: Vec::new() });
        self.ws.len() - 1
    }

    /// The index of tab `id` in workspace `wi`. A new tab gets `label`.
    fn tab(&mut self, wi: usize, id: String, label: impl FnOnce() -> String) -> usize {
        let tabs = &mut self.ws[wi].tabs;
        if let Some(i) = tabs.iter().position(|t| t.id == id) {
            return i;
        }
        tabs.push(TabAcc { id, label: label(), statuses: Vec::new() });
        tabs.len() - 1
    }

    /// Adds the pane and agent entries of terminal `t` to tab `ti` of workspace `wi`.
    fn place(&mut self, t: &Value, wi: usize, ti: usize, g: &Grouping) {
        let (ws, tab) = (&self.ws[wi].id, &self.ws[wi].tabs[ti].id);
        let mut pane = pane_entry(t, tab, ws);
        add_group_fields(&mut pane, t, g, self.repos);
        let agent = agent_entry(t, tab, ws);
        self.panes.push(pane);
        if let Some(mut agent) = agent {
            add_group_fields(&mut agent, t, g, self.repos);
            self.ws[wi].tabs[ti].statuses.extend(agent_status(t));
            self.agents.push(agent);
        }
    }

    fn finish(self) -> Projection {
        let mut out = Projection { panes: self.panes, agents: self.agents, ..Projection::default() };
        for (wi, w) in self.ws.into_iter().enumerate() {
            let mut ws_statuses = Vec::new();
            let tab_count = w.tabs.len();
            for (ti, tab) in w.tabs.into_iter().enumerate() {
                out.tabs.push(json!({
                    "tab_id": tab.id, "workspace_id": w.id, "label": tab.label, "number": ti + 1,
                    "agent_status": status_word(sum_status(&tab.statuses)), "backend": BACKEND,
                }));
                ws_statuses.extend(tab.statuses);
            }
            out.workspaces.push(json!({
                "workspace_id": w.id, "label": w.label, "number": wi + 1, "tab_count": tab_count,
                "agent_status": status_word(sum_status(&ws_statuses)), "backend": BACKEND,
            }));
        }
        out
    }
}

/// The distinct folders ([`groups::folder_of`]) of the live terminals of this machine, sorted.
pub fn folders(terminals: &[Value]) -> Vec<String> {
    let set: BTreeSet<&str> = terminals.iter().filter(|t| counts(t)).filter_map(folder_of).collect();
    set.into_iter().map(String::from).collect()
}

/// The snapshot entries of `terminals` (records of `terminal.list` or of a subscription
/// snapshot), placed by the herdr-app `doc` (the `value` of `doc.get`) when there is one, and
/// grouped with the repo facts `repos`. See the module doc for the placement rules.
pub fn project(terminals: &[Value], doc: Option<&Value>, repos: &Repos) -> Projection {
    let live: Vec<&Value> = terminals.iter().filter(|t| counts(t)).collect();
    let by_addr = |a: &str| live.iter().copied().find(|t| text(t, "address") == Some(a));
    let mut placed: HashSet<String> = HashSet::new();
    let mut b = Builder { repos, ws: Vec::new(), panes: Vec::new(), agents: Vec::new() };

    // Rule 1: the layout document.
    let spaces = doc.and_then(|d| d.get("spaces")).and_then(Value::as_array).cloned().unwrap_or_default();
    for (si, space) in spaces.iter().enumerate() {
        let Some(sid) = text(space, "id") else { continue };
        let first = first_terminal(space, &by_addr);
        let last = |f: &str| f.trim_end_matches('/').rsplit('/').next().filter(|s| !s.is_empty()).map(String::from);
        // The Herdr app names an unnamed space by the folder it shows now, and writes that
        // name into the `where` label of each terminal. The `folder` of the document is stale.
        let label = text(space, "name")
            .map(String::from)
            .or_else(|| first.and_then(label_space).and_then(|l| l.name))
            .or_else(|| first.and_then(folder_name))
            .or_else(|| text(space, "folder").and_then(last))
            .unwrap_or_else(|| format!("Space {}", si + 1));
        let g = Grouping { label: label.clone(), source: GroupSource::Space };
        let wi = b.ws(format!("{PREFIX}space:{sid}"), || label);
        let tabs = space.get("tabs").and_then(Value::as_array).cloned().unwrap_or_default();
        for (ti, tab) in tabs.iter().enumerate() {
            let Some(tid) = text(tab, "id") else { continue };
            let tab_label = text(tab, "name").map(String::from).unwrap_or_else(|| format!("Tab {}", ti + 1));
            let tix = b.tab(wi, format!("{PREFIX}tab:{tid}"), || tab_label);
            let mut addrs = Vec::new();
            layout_terminals(tab.get("root").unwrap_or(&Value::Null), &mut addrs);
            for a in addrs {
                let Some(t) = by_addr(&a) else { continue };
                if placed.insert(a) {
                    b.place(t, wi, tix, &g);
                }
            }
        }
    }

    // Rule 2: the `herdr.space` label of a terminal that no document tab holds, as right after
    // the phone starts an agent. A space or tab of the document is reused, never added twice.
    for &t in &live {
        let Some(addr) = text(t, "address") else { continue };
        let Some(ls) = label_space(t).filter(|_| !placed.contains(addr)) else { continue };
        let wi = b.ws(format!("{PREFIX}space:{}", ls.space), || {
            ls.name.clone().or_else(|| folder_name(t)).unwrap_or_else(|| groups::NO_FOLDER_LABEL.into())
        });
        let tab_id = ls.tab.as_ref().map_or_else(|| format!("{PREFIX}task:{addr}"), |tab| format!("{PREFIX}tab:{tab}"));
        let tix = b.tab(wi, tab_id, || task_label(t));
        let g = Grouping { label: b.ws[wi].label.clone(), source: GroupSource::Space };
        placed.insert(addr.to_string());
        b.place(t, wi, tix, &g);
    }

    // Rules 3 and 4. A helper whose parent rules 3 or 4 place waits for the parent.
    let rest: Vec<&Value> = live.iter().copied().filter(|t| text(t, "address").is_some_and(|a| !placed.contains(a))).collect();
    let in_rest = |p: &Value| rest.iter().any(|r| std::ptr::eq(*r, p));
    let mut tasks: HashMap<String, (usize, usize, Grouping)> = HashMap::new();
    let mut waiting: Vec<(&Value, String)> = Vec::new();
    let own_task = |b: &mut Builder, t: &Value, tasks: &mut HashMap<String, (usize, usize, Grouping)>| {
        let addr = text(t, "address").unwrap_or_default().to_string();
        let group = groups::fallback_group(t, repos);
        let wi = b.ws(format!("{PREFIX}g:{}", group.key), || group.label.clone());
        let tix = b.tab(wi, format!("{PREFIX}task:{addr}"), || task_label(t));
        let g = Grouping { label: b.ws[wi].label.clone(), source: group.source };
        b.place(t, wi, tix, &g);
        tasks.insert(addr, (wi, tix, g));
    };
    for &t in &rest {
        match live_parent(t, &live).filter(|p| in_rest(p)).and_then(|p| text(p, "address")) {
            Some(parent) => waiting.push((t, parent.to_string())),
            None => own_task(&mut b, t, &mut tasks),
        }
    }
    // Place helpers whose parent has a tab, until no more can be placed (helpers of helpers).
    loop {
        let before = waiting.len();
        waiting.retain(|(t, parent)| {
            let Some((wi, tix, g)) = tasks.get(parent) else { return true };
            let (wi, tix, g) = (*wi, *tix, g.clone());
            b.place(t, wi, tix, &g);
            tasks.insert(text(t, "address").unwrap_or_default().to_string(), (wi, tix, g));
            false
        });
        if waiting.is_empty() || waiting.len() == before {
            break;
        }
    }
    // A loop of parents (t1 → t2 → t1): each helper gets its own task.
    for (t, _) in waiting {
        own_task(&mut b, t, &mut tasks);
    }
    b.finish()
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
