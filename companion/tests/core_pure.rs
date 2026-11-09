//! The pure parts of the herdr-core support: endpoint, projection, routing, events, the
//! tracker and the merge state machine.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use herdlingd::core::client::Notice;
use herdlingd::core::endpoint::{self, CoreSocket, Inputs};
use herdlingd::core::merge::{Action, Leg, Merge, Side};
use herdlingd::core::project::{self, Projection};
use herdlingd::core::route::{self, Shape};
use herdlingd::core::tracker::{Effect, Tracker};
use herdlingd::core::events::translate;
use herdlingd::types::AgentStatus;
use serde_json::{json, Value};

fn resolve(env: &[(&str, &str)], run_user: bool, config: Option<&str>) -> Option<CoreSocket> {
    let env: HashMap<String, String> = env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let var = |k: &str| env.get(k).cloned();
    let dir_exists = |p: &Path| run_user && p == Path::new("/run/user/501");
    let config = config.map(String::from);
    let read = |p: &Path| config.clone().filter(|_| p.ends_with("herdr-core/config.toml"));
    endpoint::resolve(Path::new("/home/sam"), &Inputs { var: &var, uid: 501, dir_exists: &dir_exists, read: &read })
}

fn paths(c: &CoreSocket) -> Vec<PathBuf> {
    c.candidates().to_vec()
}

#[test]
fn endpoint_default_is_the_state_folder() {
    // macOS, launchd and a forced SSH command: no runtime folder.
    let c = resolve(&[], false, None).unwrap();
    assert_eq!(paths(&c), vec![PathBuf::from("/home/sam/.local/state/herdr-core/default/default.sock")]);
}

#[test]
fn endpoint_runtime_folders_come_first() {
    let c = resolve(&[("XDG_RUNTIME_DIR", "/run/user/501")], true, None).unwrap();
    assert_eq!(
        paths(&c),
        vec![
            PathBuf::from("/run/user/501/herdr-core/default.sock"),
            PathBuf::from("/home/sam/.local/state/herdr-core/default/default.sock"),
        ]
    );
    // No XDG_RUNTIME_DIR, but /run/user/<uid> exists (some ssh logins).
    let c = resolve(&[], true, None).unwrap();
    assert_eq!(paths(&c)[0], PathBuf::from("/run/user/501/herdr-core/default.sock"));
}

#[test]
fn endpoint_session_state_and_overrides() {
    let c = resolve(&[("HC_SESSION", " dev "), ("XDG_STATE_HOME", "/st")], false, None).unwrap();
    assert_eq!(paths(&c), vec![PathBuf::from("/st/herdr-core/dev/dev.sock")]);
    let c = resolve(&[("HC_SOCKET", "/tmp/x.sock")], true, Some("socket = \"/cfg.sock\"")).unwrap();
    assert_eq!(paths(&c), vec![PathBuf::from("/tmp/x.sock")]);
    let c = resolve(&[], true, Some("socket = \"/cfg.sock\"")).unwrap();
    assert_eq!(paths(&c), vec![PathBuf::from("/cfg.sock")]);
    // A broken config is ignored, as hc does.
    let c = resolve(&[], false, Some("socket = [")).unwrap();
    assert_eq!(paths(&c).len(), 1);
    assert!(resolve(&[("HC_SESSION", "a/b")], false, None).is_none());
}

#[test]
fn endpoint_pick_takes_the_first_that_exists() {
    let c = resolve(&[("XDG_RUNTIME_DIR", "/r")], false, None).unwrap();
    let state = PathBuf::from("/home/sam/.local/state/herdr-core/default/default.sock");
    assert_eq!(c.pick(&|p| p == state), state);
    assert_eq!(c.pick(&|_| false), PathBuf::from("/r/herdr-core/default.sock"));
}

fn term(addr: &str, name: Option<&str>, state: Option<&str>) -> Value {
    json!({"address": addr, "name": name, "cwd": "/home/sam/proj", "state": "live", "labels": {}, "turn": 2,
           "status": state.map(|s| json!({"state": s, "app": "Claude Code", "title": "fix", "msg": "m"})),
           "status_ms": 5000, "title": "t", "pid": 10, "foreground": {"pid": 11, "name": "claude", "argv": ["claude"], "cwd": "/home/sam/proj/a"}})
}

fn ids(list: &[Value], key: &str) -> Vec<String> {
    list.iter().map(|v| v[key].as_str().unwrap().to_string()).collect()
}

#[test]
fn projection_places_terminals_by_the_layout_document() {
    let doc = json!({"spaces": [{"id": "s1", "name": "api", "folder": "/p/api", "tabs": [
        {"id": "a", "name": "main", "root": {"type": "row", "children": [
            {"type": "block", "content": {"terminal": "t1"}},
            {"type": "block", "content": {"terminal": "t9"}},
        ], "floating": [{"id": "f", "content": {"terminal": "t2"}}]}},
        {"id": "b", "root": {"type": "block", "content": {"mod": "files"}}},
    ]}]});
    let terminals = vec![
        term("t1", Some("api-agent"), Some("working")),
        term("t2", None, None),
        term("t3", None, Some("error")),
        term("box/t4", None, Some("working")),
        json!({"address": "t5", "state": "finished", "status": null}),
    ];
    let p = project::project(&terminals, Some(&doc));
    assert_eq!(ids(&p.workspaces, "workspace_id"), ["hc:space:s1", "hc:loose"]);
    assert_eq!(p.workspaces[0]["label"], "api");
    assert_eq!(p.workspaces[0]["agent_status"], "working");
    assert_eq!(p.workspaces[1]["label"], project::LOOSE_WORKSPACE_LABEL);
    assert_eq!(ids(&p.tabs, "tab_id"), ["hc:tab:a", "hc:tab:b", "hc:loose:tab"]);
    assert_eq!(p.tabs[1]["label"], "Tab 2");
    assert_eq!(ids(&p.panes, "pane_id"), ["hc:t1", "hc:t2", "hc:t3"]);
    assert_eq!(p.panes[1]["tab_id"], "hc:tab:a");
    assert_eq!(p.panes[1]["agent"], Value::Null, "no 7501 status: a terminal, not an agent");
    assert_eq!(ids(&p.agents, "pane_id"), ["hc:t1", "hc:t3"]);
    let a = &p.agents[0];
    assert_eq!(a["agent"], "claude");
    assert_eq!(a["display_agent"], "Claude Code");
    assert_eq!(a["name"], "api-agent");
    assert_eq!(a["cwd"], "/home/sam/proj/a");
    assert_eq!(a["state_change_seq"], 5000);
    assert_eq!(a["backend"], "core");
    assert_eq!(p.agents[1]["agent_status"], "blocked", "error asks for the user");
    assert!(p.panes.iter().chain(&p.tabs).chain(&p.workspaces).all(|e| e["backend"] == "core"));
}

#[test]
fn projection_without_a_document_puts_all_in_the_loose_workspace() {
    let p = project::project(&[term("t1", None, Some("done"))], None);
    assert_eq!(ids(&p.workspaces, "workspace_id"), ["hc:loose"]);
    assert_eq!(p.agents[0]["agent_status"], "done");
    assert_eq!(project::project(&[], None), Projection::default());
}

#[test]
fn status_map() {
    let m = |s: &str| project::map_status(Some(&json!({"state": s})));
    assert_eq!(m("idle"), Some(AgentStatus::Idle));
    assert_eq!(m("working"), Some(AgentStatus::Working));
    assert_eq!(m("done"), Some(AgentStatus::Done));
    assert_eq!(m("blocked"), Some(AgentStatus::Blocked));
    assert_eq!(m("error"), Some(AgentStatus::Blocked));
    assert_eq!(m("thinking"), Some(AgentStatus::Unknown));
    assert_eq!(project::map_status(None), None);
}

#[test]
fn snapshot_merge_each_side_alone() {
    let herdr = json!({"snapshot": {"version": "0.9.5", "agents": [{"pane_id": "w1:p1"}], "panes": [], "workspaces": [], "tabs": []}});
    let core = project::project(&[term("t1", None, Some("idle"))], None);
    // No core: exactly herdr 1.
    assert_eq!(project::merge_snapshots::<()>(Ok(herdr.clone()), None), Ok(herdr.clone()));
    let both = project::merge_snapshots::<()>(Ok(herdr.clone()), Some(core.clone())).unwrap();
    assert_eq!(both["snapshot"]["version"], "0.9.5");
    assert_eq!(ids(both["snapshot"]["agents"].as_array().unwrap(), "pane_id"), ["w1:p1", "hc:t1"]);
    let core_only = project::merge_snapshots(Err("down"), Some(core)).unwrap();
    assert_eq!(ids(core_only["snapshot"]["agents"].as_array().unwrap(), "pane_id"), ["hc:t1"]);
    assert_eq!(project::merge_snapshots::<&str>(Err("down"), None), Err("down"));
}

#[test]
fn push_text_uses_name_title_then_app() {
    assert_eq!(project::push_text(&term("t1", Some("api"), Some("done"))), ("api".into(), "Claude Code · m".into()));
    assert_eq!(project::push_text(&term("t1", None, Some("done"))), ("fix".into(), "Claude Code · m".into()));
    let bare = json!({"address": "t1", "status": {"state": "done", "app": "pi"}});
    assert_eq!(project::push_text(&bare), ("pi".into(), String::new()));
}

#[test]
fn ids_and_targets() {
    assert_eq!(project::address("hc:t7"), Some("t7"));
    assert_eq!(project::address("hc:space:s1"), None);
    assert_eq!(project::address("hc:box/t7"), None);
    assert_eq!(project::address("w1:p1"), None);
    assert_eq!(route::core_target(&json!({"pane_id": "hc:t1"})), Some("hc:t1"));
    assert_eq!(route::core_target(&json!({"target": "hc:t1", "text": "x"})), Some("hc:t1"));
    assert_eq!(route::core_target(&json!({"workspace_id": "hc:space:s"})), Some("hc:space:s"));
    assert_eq!(route::core_target(&json!({"pane_id": "w1:p1", "text": "hc:t1"})), None, "text never routes");
}

#[test]
fn text_keys_map_only_what_has_a_key() {
    let k = |t: &str| route::text_keys(t);
    assert_eq!(k("ls -a"), Some(vec!["l".into(), "s".into(), "space".into(), "-".into(), "a".into()]));
    assert_eq!(k("A\r"), Some(vec!["shift+a".into(), "enter".into()]));
    assert_eq!(k("\x03"), Some(vec!["ctrl+c".into()]));
    assert_eq!(k("\x1b[5~"), Some(vec!["pageup".into()]));
    assert_eq!(k("!"), None);
    assert_eq!(k("é"), None);
    assert_eq!(k(""), None);
}

#[test]
fn plan_translates_herdr_methods() {
    let p = |m: &str, params: Value| route::plan(m, &params, "hc:t1");
    let read = p("pane.read", json!({"source": "visible", "format": "ansi"})).unwrap();
    assert_eq!((read.method, read.params.clone()), ("terminal.read", json!({"terminal": "t1", "lines": 0})));
    let recent = p("pane.read", json!({"source": "recent", "lines": 5000})).unwrap();
    assert_eq!(recent.params["lines"], 1000);
    let line = p("pane.send_input", json!({"text": "ls", "keys": ["enter"]})).unwrap();
    assert_eq!((line.method, line.params), ("terminal.send", json!({"terminal": "t1", "text": "ls", "force": true})));
    let keys = p("pane.send_input", json!({"keys": ["Esc"]})).unwrap();
    assert_eq!((keys.method, keys.params), ("terminal.keys", json!({"terminal": "t1", "keys": ["esc"]})));
    let typed = p("pane.send_input", json!({"text": "y"})).unwrap();
    assert_eq!(typed.params["keys"], json!(["y"]));
    assert!(p("pane.send_input", json!({"text": "€"})).unwrap_err().0.contains("Enter"));
    let text = p("pane.send_text", json!({"text": "make\n"})).unwrap();
    assert_eq!(text.method, "terminal.send");
    let digit = p("pane.send_keys", json!({"keys": ["1"]})).unwrap();
    assert_eq!(digit.params, json!({"terminal": "t1", "keys": ["1"]}));
    let prompt = p("agent.prompt", json!({"target": "hc:t1", "text": "go"})).unwrap();
    assert_eq!(prompt.params, json!({"terminal": "t1", "text": "go"}));
    assert_eq!(p("pane.get", json!({})).unwrap().shape, Shape::PaneGet);
    assert_eq!(p("pane.process_info", json!({})).unwrap().shape, Shape::ProcessInfo);
    assert_eq!(p("pane.close", json!({})).unwrap().method, "terminal.kill");
    for m in ["pane.rename", "agent.start", "tab.create", "workspace.close", "agent.rename"] {
        assert!(p(m, json!({})).is_err(), "{m}");
    }
    assert!(route::plan("tab.create", &json!({}), "hc:space:s1").is_err(), "a workspace id has no terminal");
}

#[test]
fn shapes_match_herdr_one() {
    let r = route::shape(&Shape::Read { pane_id: "hc:t1".into() }, json!({"text": "hi", "complete": false, "how": "screen"}));
    assert_eq!(r["read"], json!({"pane_id": "hc:t1", "text": "hi", "revision": 0, "truncated": true, "format": "text"}));
    let t = term("t1", Some("n"), Some("working"));
    let g = route::shape(&Shape::PaneGet, t.clone());
    assert_eq!(g["pane"]["pane_id"], "hc:t1");
    assert_eq!(g["pane"]["agent_status"], "working");
    assert_eq!(g["pane"]["foreground_cwd"], "/home/sam/proj/a");
    let pi = route::shape(&Shape::ProcessInfo, t);
    assert_eq!(pi["process_info"]["shell_pid"], 10);
    assert_eq!(pi["process_info"]["foreground_process_group_id"], 11);
    assert_eq!(pi["process_info"]["foreground_processes"][0]["name"], "claude");
}

#[test]
fn events_translate_to_herdr_lines() {
    let ev = |kind: &str, data: Value| Notice::Event(json!({"seq": 1, "type": kind, "terminal": "t1", "data": data}));
    let s = translate(&ev("status", json!({"status": {"state": "error"}}))).unwrap();
    assert_eq!(s["event"], "pane.agent_status_changed");
    assert_eq!(s["data"]["pane_id"], "hc:t1");
    assert_eq!(s["data"]["agent_status"], "blocked");
    let cleared = translate(&ev("status", json!({"status": null}))).unwrap();
    assert_eq!(cleared["event"], "pane.agent_detected");
    assert_eq!(cleared["data"]["released"], true);
    assert_eq!(translate(&ev("created", json!({}))).unwrap()["event"], "pane.created");
    assert_eq!(translate(&ev("finished", json!({}))).unwrap()["event"], "pane.closed");
    assert_eq!(translate(&ev("removed", json!({}))).unwrap()["data"]["pane_id"], "hc:t1");
    assert_eq!(translate(&ev("lost", json!({}))).unwrap()["event"], "layout.updated");
    assert!(translate(&ev("title", json!({"title": "x"}))).is_none());
    assert!(translate(&ev("foreground", json!(null))).is_none());
    let remote = Notice::Event(json!({"type": "status", "terminal": "box/t1", "data": {"status": {"state": "done"}}}));
    assert!(translate(&remote).is_none());
    let doc = Notice::Event(json!({"type": "doc", "data": {"name": "herdr-app", "version": 2}}));
    assert_eq!(translate(&doc).unwrap()["event"], "layout.updated");
    let other_doc = Notice::Event(json!({"type": "doc", "data": {"name": "x"}}));
    assert!(translate(&other_doc).is_none());
    assert_eq!(translate(&Notice::Missed(json!({"seq": 9, "terminals": []}))).unwrap()["event"], "layout.updated");
    assert!(translate(&Notice::Heartbeat(3)).is_none());
}

#[test]
fn tracker_effects() {
    let mut t = Tracker::default();
    let start = t.reset(&[term("t2", None, Some("idle")), term("t1", None, Some("working")), term("t3", None, None)]);
    assert_eq!(start, vec![Effect::Observe("hc:t1".into(), AgentStatus::Working), Effect::Observe("hc:t2".into(), AgentStatus::Idle)]);
    let ev = |kind: &str, term: &str, data: Value| json!({"type": kind, "terminal": term, "data": data});
    assert_eq!(t.apply(&ev("status", "t1", json!({"status": {"state": "done"}}))), vec![Effect::Observe("hc:t1".into(), AgentStatus::Done)]);
    assert!(t.apply(&ev("status", "t1", json!({"status": null}))).is_empty(), "a cleared status keeps the notice");
    assert!(t.apply(&ev("status", "t9", json!({"status": {"state": "done"}}))).is_empty(), "unknown terminal");
    assert_eq!(t.apply(&ev("created", "t4", term("t4", None, Some("working")))), vec![Effect::Observe("hc:t4".into(), AgentStatus::Working)]);
    t.apply(&ev("title", "t4", json!({"title": "new"})));
    assert_eq!(t.record("hc:t4").unwrap()["title"], "new");
    assert_eq!(t.apply(&ev("finished", "t4", json!({}))), vec![Effect::Forget("hc:t4".into())]);
    assert!(t.record("hc:t4").is_none());
    assert!(t.apply(&ev("status", "box/t1", json!({"status": {"state": "done"}}))).is_empty());
}

#[test]
fn merge_state_machine() {
    assert!(Merge::start(Leg::Down, Leg::Down).is_none());
    assert!(Merge::start(Leg::Down, Leg::Off).is_none());
    // No core: the herdr 1 end closes the stream, as before.
    let mut m = Merge::start(Leg::Up, Leg::Off).unwrap();
    assert!(m.to_retry().is_empty());
    assert_eq!(m.ended(Side::Herdr), Action::Close);
    // Core absent at the start: retried; herdr 1 alone still closes.
    let mut m = Merge::start(Leg::Up, Leg::Down).unwrap();
    assert_eq!(m.to_retry(), vec![Side::Core]);
    assert_eq!(m.ended(Side::Herdr), Action::Close);
    // Both up: one end gives a hint and a retry, the reconnect gives a hint.
    let mut m = Merge::start(Leg::Up, Leg::Up).unwrap();
    assert_eq!(m.ended(Side::Core), Action::Hint);
    assert_eq!(m.to_retry(), vec![Side::Core]);
    assert_eq!(m.connected(Side::Core), Action::Hint);
    assert_eq!(m.connected(Side::Core), Action::None, "an impossible second connect");
    assert_eq!(m.ended(Side::Herdr), Action::Hint);
    assert_eq!(m.ended(Side::Herdr), Action::None, "an impossible second end");
    assert_eq!(m.ended(Side::Core), Action::Close);
}
