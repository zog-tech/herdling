//! Tests of the pure group rules for Herdr 2 terminals.

use herdlingd::core::groups::*;
use serde_json::{json, Value};

fn rec(v: Value) -> Value {
    let mut base = json!({
        "address": "t1", "name": null, "state": "live", "labels": {}, "title": null, "status": null,
    });
    for (k, val) in v.as_object().unwrap() {
        base[k] = val.clone();
    }
    base
}

fn repos(folder: &str, info: Option<RepoInfo>) -> Repos {
    let mut r = Repos::new();
    r.insert(folder.into(), info);
    r
}

fn proj() -> RepoInfo {
    RepoInfo { root: "/home/sam/proj".into(), name: "proj".into(), branch: Some("main".into()) }
}

#[test]
fn label_wins_over_repo() {
    let t = rec(json!({"cwd": "/home/sam/proj/api", "labels": {"herdling.group": "Clips"}}));
    let g = fallback_group(&t, &repos("/home/sam/proj/api", Some(proj())));
    assert_eq!(g, Group { key: "clips".into(), label: "Clips".into(), source: GroupSource::Label });
}

#[test]
fn repo_then_folder() {
    let t = rec(json!({"cwd": "/home/sam/proj/api"}));
    let g = fallback_group(&t, &repos("/home/sam/proj/api", Some(proj())));
    assert_eq!((g.source, g.label.as_str()), (GroupSource::Repo, "proj"));
    let t = rec(json!({"cwd": "/home/sam/scratch"}));
    let g = fallback_group(&t, &repos("/home/sam/scratch", None));
    assert_eq!((g.source, g.label.as_str()), (GroupSource::Folder, "scratch"));
}

#[test]
fn no_folder_gives_terminals() {
    let g = fallback_group(&rec(json!({})), &Repos::new());
    assert_eq!((g.label.as_str(), g.key.as_str(), g.source), ("Terminals", "terminals", GroupSource::Folder));
}

#[test]
fn foreground_folder_wins() {
    let t = rec(json!({"cwd": "/home/sam/a", "foreground": {"cwd": "/home/sam/b"}}));
    assert_eq!(folder_of(&t), Some("/home/sam/b"));
}

#[test]
fn space_label_and_where_name() {
    let t = rec(json!({"labels": {"herdr.space": "sp1", "herdr.tab": "tb1", "where": "web app / 2"}}));
    assert_eq!(label_space(&t), Some(LabelSpace { space: "sp1".into(), tab: Some("tb1".into()), name: Some("web app".into()) }));
    let t = rec(json!({"labels": {"herdr.space": "", "herdr.tab": "tb1"}}));
    assert_eq!(label_space(&t), None);
    let t = rec(json!({"labels": {"herdr.space": "sp1", "where": "herdling / 1"}}));
    assert_eq!(label_space(&t).unwrap().name.as_deref(), Some("herdling"));
}

#[test]
fn task_name_order() {
    let t = rec(json!({"name": " Fix login ", "status": {"title": "st"}, "title": "tt"}));
    assert_eq!(task_name(&t).as_deref(), Some("Fix login"));
    let t = rec(json!({"status": {"title": "st"}, "title": "tt"}));
    assert_eq!(task_name(&t).as_deref(), Some("st"));
    let t = rec(json!({"name": "", "status": {"title": " "}, "title": "tt"}));
    assert_eq!(task_name(&t).as_deref(), Some("tt"));
    assert_eq!(task_name(&rec(json!({"title": ""}))), None);
}

#[test]
fn group_key_normalizes() {
    assert_eq!(group_key("  Web App! "), "web-app-");
    assert_eq!(group_key("a_b.c-d  e"), "a_b.c-d-e");
    assert_eq!(group_key(""), "terminals");
    assert_eq!(group_key("   "), "terminals");
}

#[test]
fn helper_parent_rules() {
    let agent = |a: &str, parent: Option<&str>| {
        rec(json!({"address": a, "parent": parent, "status": {"state": "working", "app": "Claude Code"}}))
    };
    let parent = agent("t1", None);
    let plain = rec(json!({"address": "t1"}));
    let child = agent("t2", Some("t1"));

    assert_eq!(live_parent(&child, &[&parent, &child]).map(|p| p["address"].clone()), Some(json!("t1")));
    assert!(live_parent(&child, &[&plain, &child]).is_none());
    assert!(live_parent(&agent("t2", Some("box/t1")), &[&parent]).is_none());
    assert!(live_parent(&child, &[&child]).is_none());
    let own = agent("t1", Some("t1"));
    assert!(live_parent(&own, &[&own]).is_none());
}

#[test]
fn generic_title_is_not_a_task_name() {
    let t = rec(json!({"title": "Claude Code", "status": {"state": "working", "app": "claude-code"}}));
    assert_eq!(task_name(&t), None);
    let t = rec(json!({"status": {"state": "working", "app": "claude-code", "title": "claude_code"}, "title": "Claude Code"}));
    assert_eq!(task_name(&t), None);
}

#[test]
fn real_title_is_a_task_name() {
    let t = rec(json!({"title": "Fix the login form", "status": {"state": "working", "app": "claude-code"}}));
    assert_eq!(task_name(&t).as_deref(), Some("Fix the login form"));
    let t = rec(json!({"title": "Claude Code", "status": {"state": "working", "app": "claude-code", "title": "Fix it"}}));
    assert_eq!(task_name(&t).as_deref(), Some("Fix it"));
}

#[test]
fn a_name_equal_to_the_app_is_skipped() {
    let t = rec(json!({"name": "Claude-Code", "title": "Add tests", "status": {"state": "working", "app": "claude-code"}}));
    assert_eq!(task_name(&t).as_deref(), Some("Add tests"));
}

#[test]
fn where_name_is_the_part_before_the_last_separator() {
    assert_eq!(where_name(&rec(json!({"labels": {"where": "web app / 1"}}))).as_deref(), Some("web app"));
    assert_eq!(where_name(&rec(json!({"labels": {"where": " solo "}}))).as_deref(), Some("solo"));
    assert_eq!(where_name(&rec(json!({"labels": {"where": "solo"}}))).as_deref(), Some("solo"));
    assert_eq!(where_name(&rec(json!({"labels": {"where": " / 1"}}))), None);
    assert_eq!(where_name(&rec(json!({"labels": {}}))), None);
}
