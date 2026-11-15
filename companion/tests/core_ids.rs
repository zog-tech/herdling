//! The plain ids of Herdr 2 entries (herdlingd 0.2.0) and the strip of the legacy `hc:` prefix.

use herdlingd::core::ids::{self, Tab, Workspace};
use serde_json::json;

#[test]
fn each_kind_has_its_own_form() {
    assert_eq!(ids::pane("t7"), "t7");
    assert_eq!(ids::space_ws("sp3"), "space:sp3");
    assert_eq!(ids::group_ws("api"), "g:api");
    assert_eq!(ids::space_tab("tb9"), "tab:tb9");
    assert_eq!(ids::task_tab("t7"), "task:t7");
    assert_eq!(ids::address("t7"), Some("t7"));
    assert_eq!(ids::workspace("space:sp3"), Some(Workspace::Space("sp3")));
    assert_eq!(ids::workspace("g:api"), Some(Workspace::Group("api")));
    assert_eq!(ids::tab("tab:tb9"), Some(Tab::Space("tb9")));
    assert_eq!(ids::tab("task:t7"), Some(Tab::Task("t7")));
}

#[test]
fn kinds_never_collide() {
    // A Herdr app space with the id "t1" is a workspace, never a pane.
    let ws = ids::space_ws("t1");
    assert_eq!(ws, "space:t1");
    assert_eq!(ids::address(&ws), None);
    assert_eq!(ids::tab(&ws), None);
    assert_eq!(ids::workspace(&ids::task_tab("t1")), None);
    assert_eq!(ids::workspace("t1"), None);
    assert_eq!(ids::tab("t1"), None);
    // A herdr 1 id names nothing.
    assert_eq!(ids::address("w1:p1"), None);
    assert_eq!(ids::workspace("w1"), None);
    assert_eq!(ids::tab("w1:t1"), None);
}

#[test]
fn legacy_prefix_is_stripped_once() {
    assert_eq!(ids::strip_legacy("hc:t7"), "t7");
    assert_eq!(ids::strip_legacy("hc:hc:t7"), "hc:t7");
    assert_eq!(ids::strip_legacy("t7"), "t7");
    assert_eq!(ids::address("hc:t7"), Some("t7"));
    assert_eq!(ids::address("hc:hc:t7"), None);
    assert_eq!(ids::workspace("hc:space:sp1"), Some(Workspace::Space("sp1")));
    assert_eq!(ids::workspace("hc:g:api"), Some(Workspace::Group("api")));
    assert_eq!(ids::tab("hc:tab:tb1"), Some(Tab::Space("tb1")));
    assert_eq!(ids::tab("hc:task:t1"), Some(Tab::Task("t1")));
    let mut p = json!({ "method": "pane.read", "pane_id": "hc:t1", "params": { "pane_id": "hc:t2", "target": "hc:t3", "tab_id": "hc:task:t4", "workspace_id": "hc:g:api", "cwd": "hc:x" } });
    ids::strip_params(&mut p);
    assert_eq!(p["pane_id"], "t1");
    assert_eq!(p["params"], json!({ "pane_id": "t2", "target": "t3", "tab_id": "task:t4", "workspace_id": "g:api", "cwd": "hc:x" }));
}

#[test]
fn loose_names_nothing() {
    let id = ids::strip_legacy("hc:loose");
    assert_eq!(id, "loose");
    assert_eq!(ids::workspace(id), None);
    assert_eq!(ids::tab(id), None);
    // As a pane id it has the form of an address; the core knows no terminal "loose".
    assert_eq!(ids::address(id), Some("loose"));
}

#[test]
fn address_rejects_ids_of_other_kinds_and_machines() {
    assert_eq!(ids::address(""), None);
    assert_eq!(ids::address("hc:"), None);
    assert_eq!(ids::address("space:sp1"), None);
    assert_eq!(ids::address("task:t1"), None);
    assert_eq!(ids::address("box/t1"), None);
    assert_eq!(ids::workspace("space:a:b"), None);
    assert_eq!(ids::workspace("space:"), None);
    assert_eq!(ids::tab("task:box/t1"), None);
}
