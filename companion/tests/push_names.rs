use serde_json::json;
use zogsshd::push::describe;

fn snap(agent_extra: serde_json::Value, pane_label: Option<&str>, tabs: usize) -> serde_json::Value {
    let mut agent = json!({
        "pane_id": "w1:p1", "tab_id": "w1:t1", "workspace_id": "w1",
        "agent": "claude", "terminal_title_stripped": "Fix the login flow"
    });
    for (k, v) in agent_extra.as_object().unwrap() {
        agent[k] = v.clone();
    }
    let tab_list: Vec<_> =
        (1..=tabs).map(|i| json!({"tab_id": format!("w1:t{i}"), "workspace_id": "w1", "label": format!("tab{i}")})).collect();
    json!({
        "agents": [agent],
        "panes": [{"pane_id": "w1:p1", "label": pane_label}],
        "workspaces": [{"workspace_id": "w1", "label": "api", "tab_count": tabs}],
        "tabs": tab_list,
    })
}

#[test]
fn agent_name_wins() {
    let (title, body) = describe(&snap(json!({"name": "reviewer"}), Some("left"), 2), "w1:p1");
    assert_eq!(title, "reviewer");
    assert_eq!(body, "claude · Fix the login flow");
}

#[test]
fn pane_label_comes_next() {
    assert_eq!(describe(&snap(json!({}), Some("left"), 1), "w1:p1").0, "left");
}

#[test]
fn workspace_label_alone_with_one_tab() {
    assert_eq!(describe(&snap(json!({}), None, 1), "w1:p1").0, "api");
}

#[test]
fn workspace_and_tab_label_with_more_tabs() {
    assert_eq!(describe(&snap(json!({"name": null}), None, 2), "w1:p1").0, "api · tab1");
}

#[test]
fn terminal_title_when_no_workspace_and_pane_id_when_no_agent() {
    let s = json!({"agents": [{"pane_id": "w1:p1", "agent": "codex", "terminal_title_stripped": "Build"}]});
    assert_eq!(describe(&s, "w1:p1"), ("Build".to_string(), "codex".to_string()));
    assert_eq!(describe(&s, "w9:p9"), ("w9:p9".to_string(), String::new()));
}
