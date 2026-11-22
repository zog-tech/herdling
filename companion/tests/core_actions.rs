//! The pure rules of the Herdr 2 actions: new ids, placement labels, the agent command line,
//! the members of a tab or space, the explain answer, renames and the group list.

use herdlingd::core::actions::{self, NewIds, Place, Scope, ShellFamily};
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
    assert_eq!(actions::place_of(Some("space:s1"), &p).unwrap(), Place::Space("s1".into()));
    assert_eq!(actions::place_of(Some("space:s9"), &p).unwrap(), Place::Space("s9".into()), "a space the app knows soon");
    assert_eq!(actions::place_of(Some("g:clips"), &p).unwrap(), Place::LabelGroup { key: "clips".into(), label: "Clips".into() });
    assert_eq!(actions::place_of(Some("g:proj"), &p).unwrap(), Place::Folder { key: "proj".into() });
    for bad in ["g:none", "loose", "space:", "space:a/b", "w1", "t1"] {
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
    assert_eq!(actions::placed_ids(&Place::Space("s1".into()), &ids(), "t9"), ("space:s1".into(), "tab:tbNEW".into()));
    assert_eq!(actions::placed_ids(&Place::NewSpace, &ids(), "t9"), ("space:spNEW".into(), "tab:tbNEW".into()));
    let g = Place::LabelGroup { key: "clips".into(), label: "Clips".into() };
    assert_eq!(actions::placed_ids(&g, &ids(), "t9"), ("g:clips".into(), "task:t9".into()));
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
    let c = actions::created("tab_created", "space:s1", "tab:tb1", "t9");
    assert_eq!(c["type"], "tab_created");
    assert_eq!(c["workspace"]["workspace_id"], "space:s1");
    assert_eq!(c["tab"]["tab_id"], "tab:tb1");
    assert_eq!(c["root_pane"]["pane_id"], "t9");
}

#[test]
fn agent_line_quotes_each_argument() {
    let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let posix = ShellFamily::Posix;
    assert_eq!(actions::agent_line("claude", &a(&["--resume", "abc-1"]), posix).unwrap(), "claude --resume abc-1");
    assert_eq!(actions::agent_line("codex", &a(&["resume", "a b"]), posix).unwrap(), "codex resume 'a b'");
    assert_eq!(actions::agent_line("kiro", &[], posix).unwrap(), "kiro-cli");
    assert_eq!(actions::agent_line("nope", &[], posix).unwrap_err().code, "bad_request");
    assert_eq!(actions::agent_line("shell", &[], posix).unwrap_err().code, "bad_request");
}

#[test]
fn the_shell_family_comes_from_the_program_name() {
    for (shell, family) in [
        (Some("/bin/zsh"), ShellFamily::Posix),
        (Some("/usr/bin/bash"), ShellFamily::Posix),
        (Some("-zsh"), ShellFamily::Posix),
        (Some("sh"), ShellFamily::Posix),
        (Some("/opt/homebrew/bin/fish"), ShellFamily::Fish),
        (Some("/usr/local/bin/nu"), ShellFamily::Nu),
        (Some("/usr/bin/xonsh"), ShellFamily::Other),
        (Some("/bin/tcsh"), ShellFamily::Other),
        (Some(""), ShellFamily::Other),
        (None, ShellFamily::Other),
    ] {
        assert_eq!(ShellFamily::of(shell), family, "{shell:?}");
    }
}

#[test]
fn posix_quoting() {
    let q = |s: &str| actions::quote_for(ShellFamily::Posix, s).unwrap();
    assert_eq!(q("it's"), r"'it'\''s'");
    assert_eq!(q(r"a\b"), r"'a\b'");
    assert_eq!(q(""), "''");
    assert_eq!(q("$(rm -rf ~)"), "'$(rm -rf ~)'");
    // zsh expands `=cmd` at the start of a word, so such a word is quoted.
    assert_eq!(q("=ls"), "'=ls'");
}

#[test]
fn fish_quoting_escapes_backslash_and_quote() {
    let q = |s: &str| actions::quote_for(ShellFamily::Fish, s).unwrap();
    assert_eq!(q("plain-word"), "plain-word");
    assert_eq!(q("a b"), "'a b'");
    assert_eq!(q("it's"), r"'it\'s'");
    assert_eq!(q(r"a\b"), r"'a\\b'");
    // The POSIX form of this argument ends the quote early in fish and runs `rm`.
    assert_eq!(q(r"x\'; rm -rf ~; echo '"), r"'x\\\'; rm -rf ~; echo \''");
    assert_eq!(q("%self"), "'%self'");
    assert_eq!(actions::agent_line("codex", &[r"\'".to_string()], ShellFamily::Fish).unwrap(), r"codex '\\\''");
}

#[test]
fn nu_quoting_uses_double_quotes_with_escapes() {
    let q = |s: &str| actions::quote_for(ShellFamily::Nu, s).unwrap();
    assert_eq!(q("--model=opus/x.1"), "--model=opus/x.1");
    assert_eq!(q("a b"), r#""a b""#);
    assert_eq!(q(r#"say "hi" \ $(x)"#), r#""say \"hi\" \\ $(x)""#);
}

#[test]
fn other_shells_take_only_plain_words() {
    assert_eq!(actions::quote_for(ShellFamily::Other, "--resume").unwrap(), "--resume");
    assert_eq!(actions::quote_for(ShellFamily::Other, "abc-1").unwrap(), "abc-1");
    assert_eq!(actions::quote_for(ShellFamily::Other, "a b").unwrap_err().code, "bad_request");
    assert_eq!(actions::agent_line("codex", &["a b".into()], ShellFamily::Other).unwrap_err().code, "bad_request");
}

#[test]
fn control_characters_are_refused_in_every_shell() {
    for family in [ShellFamily::Posix, ShellFamily::Fish, ShellFamily::Nu, ShellFamily::Other] {
        for bad in ["a\nb", "a\rb", "\u{1b}[2J", "a\tb", "x\u{7f}"] {
            assert_eq!(actions::quote_for(family, bad).unwrap_err().code, "bad_request", "{family:?} {bad:?}");
        }
    }
    assert_eq!(actions::agent_line("claude", &["a\nrm -rf ~".into()], ShellFamily::Posix).unwrap_err().code, "bad_request");
}

#[test]
fn members_of_tab_and_workspace() {
    let p = projection();
    assert_eq!(actions::members(&p, &Scope::Tab("tab:a".into())).unwrap(), ["t1", "t2"]);
    assert_eq!(actions::members(&p, &Scope::Tab("task:t4".into())).unwrap(), ["t4"]);
    assert_eq!(actions::members(&p, &Scope::Workspace("space:s1".into())).unwrap(), ["t1", "t2", "t3"]);
    assert_eq!(actions::members(&p, &Scope::Workspace("g:clips".into())).unwrap(), ["t4"]);
    assert_eq!(actions::members(&p, &Scope::Tab("tab:none".into())).unwrap_err().code, "tab_not_found");
    assert_eq!(actions::members(&p, &Scope::Tab("loose:tab".into())).unwrap_err().code, "tab_not_found");
    assert_eq!(actions::members(&p, &Scope::Workspace("loose".into())).unwrap_err().code, "workspace_not_found");
}

#[test]
fn workspace_get_answers_from_the_projection() {
    let p = projection();
    let w = actions::workspace_get(&p, "space:s1").unwrap();
    assert_eq!(w["workspace"]["workspace_id"], "space:s1");
    assert_eq!(w["workspace"]["label"], "api");
    assert_eq!(actions::workspace_get(&p, "g:gone").unwrap_err().code, "workspace_not_found");
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
    assert_eq!(list[0], json!({"workspace_id": "space:s1", "label": "api", "source": "space", "space_id": "s1",
                                "terminals": 3, "agents": 2, "agent_status": "working"}));
    assert_eq!(list[1]["source"], "label");
    assert_eq!(list[1].get("space_id"), None);
    assert_eq!(list[2]["source"], "repo");
    assert_eq!(list[2]["terminals"], 1);
}

#[test]
fn move_target_needs_exactly_one() {
    use actions::MoveTarget;
    assert_eq!(actions::move_target(&json!({"workspace_id": "space:s1"})).unwrap(), MoveTarget::Workspace("space:s1".into()));
    assert_eq!(actions::move_target(&json!({"new_space": true})).unwrap(), MoveTarget::NewSpace);
    assert_eq!(actions::move_target(&json!({"group": " Clips "})).unwrap(), MoveTarget::Group("Clips".into()));
    assert_eq!(actions::move_target(&json!({"group": ""})).unwrap(), MoveTarget::Group(String::new()));
    for bad in [json!({}), json!({"new_space": true, "group": "x"}), json!({"group": "a\nb"}), json!({"group": "x".repeat(65)})] {
        assert_eq!(actions::move_target(&bad).unwrap_err().code, "bad_request", "{bad}");
    }
}

#[test]
fn move_labels_only_for_terminals_in_no_space() {
    use actions::MoveTarget;
    let p = projection();
    let l = actions::move_labels("t4", &MoveTarget::NewSpace, &p, &ids()).unwrap();
    assert_eq!(l, map(json!({"herdr.space": "spNEW", "herdr.tab": "tbNEW"})));
    let l = actions::move_labels("t5", &MoveTarget::Workspace("space:s1".into()), &p, &ids()).unwrap();
    assert_eq!(l, map(json!({"herdr.space": "s1", "herdr.tab": "tbNEW"})));
    let l = actions::move_labels("t5", &MoveTarget::Workspace("g:clips".into()), &p, &ids()).unwrap();
    assert_eq!(l, map(json!({"herdling.group": "Clips"})));
    let l = actions::move_labels("t5", &MoveTarget::Group("Web".into()), &p, &ids()).unwrap();
    assert_eq!(l, map(json!({"herdling.group": "Web"})));
    let e = actions::move_labels("t1", &MoveTarget::NewSpace, &p, &ids()).unwrap_err();
    assert_eq!(e.code, "unsupported", "a terminal in a space does not move");
    let e = actions::move_labels("t4", &MoveTarget::Workspace("g:proj".into()), &p, &ids()).unwrap_err();
    assert_eq!(e.code, "unsupported");
    assert_eq!(actions::move_labels("t99", &MoveTarget::NewSpace, &p, &ids()).unwrap_err().code, "pane_not_found");
}

/// The workspace id of pane `pane` in the projection.
fn ws_of(p: &Projection, pane: &str) -> String {
    actions::where_is(p, pane).unwrap().0
}

#[test]
fn close_members_with_the_panes_that_the_app_showed() {
    let p = projection();
    let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let space = Scope::Workspace("space:s1".into());
    // No list: the whole space, as before.
    assert_eq!(actions::close_members(&p, &space, None).unwrap(), ["t1", "t2", "t3"]);
    // A list: only the panes in both. A legacy `hc:` id counts; a pane of another space does not.
    assert_eq!(actions::close_members(&p, &space, Some(&ids(&["t1", "hc:t3", "t4", "t9"]))).unwrap(), ["t1", "t3"]);
    assert!(actions::close_members(&p, &space, Some(&[])).unwrap().is_empty());
    assert_eq!(actions::close_members(&p, &Scope::Tab("tab:a".into()), Some(&ids(&["t2"]))).unwrap(), ["t2"]);
    // A label group keeps its members until someone changes the label.
    assert_eq!(actions::close_members(&p, &Scope::Workspace("g:clips".into()), None).unwrap(), ["t4"]);
    // A repo group follows the folder of each terminal: with no list it is refused.
    let repo = Scope::Workspace(ws_of(&p, "t5"));
    let e = actions::close_members(&p, &repo, None).unwrap_err();
    assert_eq!(e.code, "unsupported");
    assert!(e.message.contains("one by one"), "{}", e.message);
    assert_eq!(actions::close_members(&p, &repo, Some(&ids(&["t5", "t1"]))).unwrap(), ["t5"]);
    // The task tab of such a group is one terminal: no list needed.
    assert_eq!(actions::close_members(&p, &Scope::Tab("task:t5".into()), None).unwrap(), ["t5"]);
    // Unknown ids stay errors.
    assert_eq!(actions::close_members(&p, &Scope::Workspace("g:gone".into()), Some(&ids(&["t1"]))).unwrap_err().code, "workspace_not_found");
}

#[test]
fn bash_zsh_and_ksh_run_the_agent_as_their_command() {
    let argv = |shell: &str, line: &str| actions::agent_argv(Some(shell), line);
    assert_eq!(
        argv("/bin/zsh", "claude --model 'a b'").unwrap(),
        ["/bin/zsh", "-l", "-i", "-c", "claude --model 'a b'; exec /bin/zsh -l"]
    );
    assert_eq!(argv("/usr/local/bin/bash", "codex").unwrap()[4], "codex; exec /usr/local/bin/bash -l");
    assert_eq!(argv("/bin/ksh", "codex").unwrap()[0], "/bin/ksh");
    // A shell path with a space is quoted for the second shell.
    assert_eq!(argv("/opt/my shells/zsh", "codex").unwrap()[4], "codex; exec '/opt/my shells/zsh' -l");
    // Other shells, and no absolute path: the command is typed.
    assert_eq!(argv("/usr/bin/fish", "codex"), None);
    assert_eq!(argv("/bin/sh", "codex"), None);
    assert_eq!(argv("/usr/bin/nu", "codex"), None);
    assert_eq!(argv("zsh", "codex"), None);
    assert_eq!(actions::agent_argv(None, "codex"), None);
}
