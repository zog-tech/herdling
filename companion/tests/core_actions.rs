//! The pure rules of the Herdr 2 actions: new ids, placement labels, the agent command line,
//! the members of a tab or space, the explain answer, renames and the group list.

use herdlingd::core::actions::{self, NewIds, Place, Scope};
use herdlingd::core::groups::{RepoInfo, Repos};
use herdlingd::core::project::{self, Projection};
use serde_json::{json, Map, Value};

fn agent(addr: &str, folder: &str, labels: Value) -> Value {
    json!({"address": addr, "name": null, "cwd": folder, "state": "live", "labels": labels, "pid": 10,
           "status": {"state": "working", "app": "Claude Code", "title": format!("task {addr}"), "msg": "m"},
           "status_ms": 1000, "title": "term"})
}

fn shell(addr: &str, folder: &str) -> Value {
    json!({"address": addr, "cwd": folder, "state": "live", "labels": {}, "status": null, "title": "zsh"})
}

fn doc() -> Value {
    json!({"spaces": [{"id": "s1", "name": "api", "tabs": [
        {"id": "a", "name": "main", "root": {"type": "row", "children": [
            {"type": "block", "content": {"terminal": "t1"}}, {"type": "block", "content": {"terminal": "t2"}}]}},
        {"id": "b", "name": "side", "root": {"type": "block", "content": {"terminal": "t3"}}},
    ]}]})
}

/// t1, t2 (tab a) and t3 (tab b) in space s1; t4 in the label group "Clips"; t5 in repo "proj".
fn projection() -> Projection {
    let repos = Repos::from([(
        "/home/sam/proj".to_string(),
        Some(RepoInfo { root: "/home/sam/proj".into(), name: "proj".into(), branch: None }),
    )]);
    let terminals = vec![
        agent("t1", "/home/sam/api", json!({})),
        shell("t2", "/home/sam/api"),
        agent("t3", "/home/sam/api", json!({})),
        agent("t4", "/home/sam/clips", json!({"herdling.group": "Clips"})),
        agent("t5", "/home/sam/proj", json!({})),
    ];
    project::project(&terminals, Some(&doc()), &repos)
}

fn ids() -> NewIds {
    NewIds { space: "spNEW".into(), tab: "tbNEW".into() }
}

fn map(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

#[test]
fn new_ids_look_like_the_herdr_app_ids() {
    assert_eq!(actions::new_id("sp", [0xab; 16]), format!("sp{}", "ab".repeat(16)));
    let f = actions::fresh_ids();
    assert!(f.space.starts_with("sp") && f.space.len() == 34, "{}", f.space);
    assert!(f.tab.starts_with("tb") && f.tab.len() == 34, "{}", f.tab);
    assert!(f.tab[2..].chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    assert_ne!(actions::fresh_ids().space, f.space);
}

#[test]
fn place_from_workspace_ids() {
    let p = projection();
    assert_eq!(actions::place_of(None, &p).unwrap(), Place::NewSpace);
    assert_eq!(actions::place_of(Some("hc:space:s1"), &p).unwrap(), Place::Space("s1".into()));
    assert_eq!(actions::place_of(Some("hc:space:s9"), &p).unwrap(), Place::Space("s9".into()), "a space the app knows soon");
    assert_eq!(actions::place_of(Some("hc:g:clips"), &p).unwrap(), Place::LabelGroup { key: "clips".into(), label: "Clips".into() });
    assert_eq!(actions::place_of(Some("hc:g:proj"), &p).unwrap(), Place::Folder { key: "proj".into() });
    for bad in ["hc:g:none", "hc:loose", "hc:space:", "hc:space:a/b", "w1", "hc:t1"] {
        assert_eq!(actions::place_of(Some(bad), &p).unwrap_err().code, "workspace_not_found", "{bad}");
    }
}

#[test]
fn place_labels_set_only_the_needed_labels() {
    let l = actions::place_labels(&Place::Space("s1".into()), &ids());
    assert_eq!(l, map(json!({"herdr.space": "s1", "herdr.tab": "tbNEW"})));
    let l = actions::place_labels(&Place::NewSpace, &ids());
    assert_eq!(l, map(json!({"herdr.space": "spNEW", "herdr.tab": "tbNEW"})));
    let l = actions::place_labels(&Place::LabelGroup { key: "clips".into(), label: "Clips".into() }, &ids());
    assert_eq!(l, map(json!({"herdling.group": "Clips"})));
    assert!(actions::place_labels(&Place::Folder { key: "proj".into() }, &ids()).is_empty());
}

#[test]
fn placed_ids_match_the_projection() {
    assert_eq!(actions::placed_ids(&Place::Space("s1".into()), &ids(), "t9"), ("hc:space:s1".into(), "hc:tab:tbNEW".into()));
    assert_eq!(actions::placed_ids(&Place::NewSpace, &ids(), "t9"), ("hc:space:spNEW".into(), "hc:tab:tbNEW".into()));
    let g = Place::LabelGroup { key: "clips".into(), label: "Clips".into() };
    assert_eq!(actions::placed_ids(&g, &ids(), "t9"), ("hc:g:clips".into(), "hc:task:t9".into()));
}

#[test]
fn run_params_and_shell() {
    assert_eq!(actions::shell_argv(Some("/bin/zsh")), ["/bin/zsh", "-l"]);
    assert!(actions::shell_argv(Some("zsh")).is_empty(), "a relative shell is not used");
    assert!(actions::shell_argv(None).is_empty());
    let r = actions::run_params(Some("/home/sam/proj"), map(json!({"herdr.space": "s1"})), vec!["/bin/zsh".into(), "-l".into()]);
    assert_eq!(r, json!({"argv": ["/bin/zsh", "-l"], "cwd": "/home/sam/proj", "labels": {"herdr.space": "s1"},
                         "keep": true, "no_parent": true}));
    assert_eq!(actions::run_params(None, Map::new(), vec![]).get("cwd"), None);
}

#[test]
fn created_has_the_herdr_one_shape() {
    let c = actions::created("tab_created", "hc:space:s1", "hc:tab:tb1", "hc:t9");
    assert_eq!(c["type"], "tab_created");
    assert_eq!(c["workspace"]["workspace_id"], "hc:space:s1");
    assert_eq!(c["tab"]["tab_id"], "hc:tab:tb1");
    assert_eq!(c["root_pane"]["pane_id"], "hc:t9");
}

#[test]
fn agent_line_quotes_each_argument() {
    let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(actions::agent_line("claude", &a(&["--resume", "abc-1"])).unwrap(), "claude --resume abc-1");
    assert_eq!(actions::agent_line("codex", &a(&["resume", "a b"])).unwrap(), "codex resume 'a b'");
    assert_eq!(actions::agent_line("kiro", &[]).unwrap(), "kiro-cli");
    assert_eq!(actions::shell_quote("it's"), r"'it'\''s'");
    assert_eq!(actions::shell_quote(""), "''");
    assert_eq!(actions::shell_quote("$(rm -rf ~)"), "'$(rm -rf ~)'");
    assert_eq!(actions::shell_quote("--model=opus/x.1"), "--model=opus/x.1");
    assert_eq!(actions::agent_line("nope", &[]).unwrap_err().code, "bad_request");
    assert_eq!(actions::agent_line("shell", &[]).unwrap_err().code, "bad_request");
}

#[test]
fn members_of_tab_and_workspace() {
    let p = projection();
    assert_eq!(actions::members(&p, &Scope::Tab("hc:tab:a".into())).unwrap(), ["t1", "t2"]);
    assert_eq!(actions::members(&p, &Scope::Tab("hc:task:t4".into())).unwrap(), ["t4"]);
    assert_eq!(actions::members(&p, &Scope::Workspace("hc:space:s1".into())).unwrap(), ["t1", "t2", "t3"]);
    assert_eq!(actions::members(&p, &Scope::Workspace("hc:g:clips".into())).unwrap(), ["t4"]);
    assert_eq!(actions::members(&p, &Scope::Tab("hc:tab:none".into())).unwrap_err().code, "tab_not_found");
    assert_eq!(actions::members(&p, &Scope::Tab("hc:loose:tab".into())).unwrap_err().code, "tab_not_found");
    assert_eq!(actions::members(&p, &Scope::Workspace("hc:loose".into())).unwrap_err().code, "workspace_not_found");
}

#[test]
fn workspace_get_answers_from_the_projection() {
    let p = projection();
    let w = actions::workspace_get(&p, "hc:space:s1").unwrap();
    assert_eq!(w["workspace"]["workspace_id"], "hc:space:s1");
    assert_eq!(w["workspace"]["label"], "api");
    assert_eq!(actions::workspace_get(&p, "hc:g:gone").unwrap_err().code, "workspace_not_found");
}

#[test]
fn explain_has_the_herdr_one_shape() {
    let t = agent("t1", "/home/sam/api", json!({}));
    let e = actions::explain(&t, "line 1\n\nAllow edit?\n❯ 1. Yes\n");
    assert_eq!(e["type"], "agent_explain");
    let x = &e["explain"];
    assert_eq!(x["agent"], "claude");
    assert_eq!(x["state"], "working");
    assert_eq!(x["screen_detection_skipped"], true);
    assert_eq!(x["matched_rule"]["id"], "osc-7501");
    assert_eq!(x["evaluated_rules"][0]["matched"], true);
    let preview = x["evaluated_rules"][0]["evidence"]["region_preview"].as_str().unwrap();
    assert!(preview.ends_with("❯ 1. Yes"), "{preview}");
    let s = actions::explain(&shell("t2", "/home/sam"), "$ ");
    assert_eq!(s["explain"]["state"], "unknown");
    assert_eq!(s["explain"]["matched_rule"], Value::Null);
    assert!(s["explain"]["fallback_reason"].as_str().unwrap().contains("7501"));
}

#[test]
fn rename_labels_trim_and_remove() {
    assert_eq!(actions::rename_labels(Some("  fix login ")), map(json!({"herdling.name": "fix login"})));
    assert_eq!(actions::rename_labels(Some("  ")), map(json!({"herdling.name": ""})));
    assert_eq!(actions::rename_labels(None), map(json!({"herdling.name": ""})));
}

#[test]
fn in_space_and_groups_list() {
    let p = projection();
    assert!(actions::in_space("t1", &p));
    assert!(!actions::in_space("t4", &p));
    assert!(!actions::in_space("t99", &p));
    let g = actions::groups(&p);
    let list = g["groups"].as_array().unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list[0], json!({"workspace_id": "hc:space:s1", "label": "api", "source": "space", "space_id": "s1",
                                "terminals": 3, "agents": 2, "agent_status": "working"}));
    assert_eq!(list[1]["source"], "label");
    assert_eq!(list[1].get("space_id"), None);
    assert_eq!(list[2]["source"], "repo");
    assert_eq!(list[2]["terminals"], 1);
}
