#[path = "support/fake_herdr.rs"]
mod fake_herdr;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use zogsshd::commands::{self, Command};
use zogsshd::rpc::{self, Ctx};

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn find<'a>(list: &'a [Command], name: &str) -> Option<&'a Command> {
    list.iter().find(|c| c.name == name)
}

#[test]
fn user_skill_and_nested_command() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    write(&h.join(".claude/skills/deploy/SKILL.md"), "---\nname: deploy-app\ndescription: \"Ship the app\"\n---\n# Deploy\n");
    write(&h.join(".claude/skills/plain/SKILL.md"), "No frontmatter here.\n");
    write(&h.join(".claude/commands/git/sync.md"), "\n\nPull and push the branch.\nMore text.\n");
    write(&h.join(".claude/commands/fix.md"), "---\ndescription: >\n  Fix the\n  failing test\n---\nBody\n");
    write(&h.join(".claude/commands/notes.txt"), "not a command");

    let list = commands::list(h, None);
    let skill = find(&list, "deploy-app").unwrap();
    assert_eq!(skill.description.as_deref(), Some("Ship the app"));
    assert_eq!(skill.source, "user");
    assert_eq!(find(&list, "plain").unwrap().description, None);
    let nested = find(&list, "git:sync").unwrap();
    assert_eq!(nested.description.as_deref(), Some("Pull and push the branch."));
    assert_eq!(find(&list, "fix").unwrap().description.as_deref(), Some("Fix the failing test"));
    assert!(find(&list, "notes").is_none());
    assert_eq!(find(&list, "clear").unwrap().source, "builtin");

    let names: Vec<&str> = list.iter().map(|c| c.name.as_str()).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted);
}

#[test]
fn project_beats_user_and_walks_up_to_the_git_root() {
    let home = tempfile::tempdir().unwrap();
    let work = tempfile::tempdir().unwrap();
    let h = home.path();
    let root = work.path().join("repo");
    let cwd = root.join("pkg/sub");
    std::fs::create_dir_all(root.join(".git")).unwrap();
    std::fs::create_dir_all(&cwd).unwrap();
    write(&h.join(".claude/commands/ship.md"), "User ship\n");
    write(&root.join(".claude/commands/ship.md"), "Repo ship\n");
    write(&root.join(".claude/commands/lint.md"), "Repo lint\n");
    write(&cwd.join(".claude/commands/lint.md"), "Sub lint\n");
    write(&root.join(".claude/skills/check/SKILL.md"), "---\ndescription: Check it\n---\n");
    // Above the git root: not used.
    write(&work.path().join(".claude/commands/outside.md"), "Outside\n");
    // A project command can also replace a built-in.
    write(&root.join(".claude/commands/review.md"), "Our review\n");

    let list = commands::list(h, Some(&cwd));
    let ship = find(&list, "ship").unwrap();
    assert_eq!((ship.source, ship.description.as_deref()), ("project", Some("Repo ship")));
    assert_eq!(find(&list, "lint").unwrap().description.as_deref(), Some("Sub lint"));
    assert_eq!(find(&list, "check").unwrap().source, "project");
    assert!(find(&list, "outside").is_none());
    assert_eq!(find(&list, "review").unwrap().source, "project");
    assert_eq!(list.iter().filter(|c| c.name == "ship").count(), 1);
}

#[test]
fn enabled_plugins_get_a_prefix() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    let on = h.join("plugin-cache/tools/1.0.0");
    let off = h.join("plugin-cache/other/1.0.0");
    write(&on.join("skills/brainstorm/SKILL.md"), "---\nname: brainstorm\ndescription: Think first\n---\n");
    write(&on.join("commands/run/all.md"), "---\ndescription: Run all\n---\n");
    write(&off.join("skills/hidden/SKILL.md"), "---\nname: hidden\n---\n");
    write(
        &h.join(".claude/settings.json"),
        &json!({"enabledPlugins": {"tools@market": true, "other@market": false, "missing@market": true}}).to_string(),
    );
    write(
        &h.join(".claude/plugins/installed_plugins.json"),
        &json!({"version": 2, "plugins": {
            "tools@market": [{"scope": "user", "installPath": on}],
            "other@market": [{"scope": "user", "installPath": off}],
        }})
        .to_string(),
    );

    let list = commands::list(h, None);
    let skill = find(&list, "tools:brainstorm").unwrap();
    assert_eq!((skill.source, skill.description.as_deref()), ("plugin", Some("Think first")));
    assert_eq!(find(&list, "tools:run:all").unwrap().description.as_deref(), Some("Run all"));
    assert!(find(&list, "other:hidden").is_none());
    assert!(!list.iter().any(|c| c.name.starts_with("missing:")));
}

#[test]
fn missing_dirs_give_the_builtins_only() {
    let home = tempfile::tempdir().unwrap();
    let list = commands::list(home.path(), Some(&home.path().join("no/such/dir")));
    assert!(!list.is_empty());
    assert!(list.iter().all(|c| c.source == "builtin"));
    assert!(find(&list, "compact").is_some());
}

#[test]
fn bad_frontmatter_and_bad_json_are_skipped() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    // No closing `---`: the folder name is used and there is no description.
    write(&h.join(".claude/skills/broken/SKILL.md"), "---\nname: [unclosed\ndescription: x\n");
    // A name with a space cannot be typed: the folder name is used.
    write(&h.join(".claude/skills/spaced/SKILL.md"), "---\nname: two words\n---\n");
    write(&h.join(".claude/skills/binary/SKILL.md"), "\u{0}\u{1}\u{ff}garbage");
    std::fs::create_dir_all(h.join(".claude/skills/empty")).unwrap();
    write(&h.join(".claude/commands/unclosed.md"), "---\ndescription: never closed\n");
    write(&h.join(".claude/settings.json"), "{ not json");

    let list = commands::list(h, None);
    assert_eq!(find(&list, "broken").unwrap().description, None);
    assert!(find(&list, "spaced").is_some());
    assert!(find(&list, "binary").is_some());
    assert!(find(&list, "empty").is_none());
    assert_eq!(find(&list, "unclosed").unwrap().description, None);
}

#[test]
fn list_is_capped() {
    let home = tempfile::tempdir().unwrap();
    for i in 0..(commands::MAX_COMMANDS + 20) {
        write(&home.path().join(format!(".claude/commands/c{i:04}.md")), "x\n");
    }
    assert_eq!(commands::list(home.path(), None).len(), commands::MAX_COMMANDS);
}

async fn call(sock: PathBuf, home: PathBuf, params: Value) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(1 << 20);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, Ctx::new(sock, home)));
    let req = json!({"id": 1, "method": "commands.list", "params": params});
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    serde_json::from_str(&BufReader::new(client_rx).lines().next_line().await.unwrap().unwrap()).unwrap()
}

#[tokio::test]
async fn rpc_resolves_the_cwd_from_the_pane() {
    let home = tempfile::tempdir().unwrap();
    let proj = tempfile::tempdir().unwrap();
    write(&proj.path().join(".claude/commands/here.md"), "From the pane folder\n");
    let sock = home.path().join("herdr.sock");
    let mut m = HashMap::new();
    m.insert("pane.get".to_string(), json!({"type": "pane_get", "pane": {"pane_id": "w1:p1", "cwd": proj.path()}}));
    fake_herdr::spawn(&sock, m);

    let r = call(sock.clone(), home.path().into(), json!({"pane_id": "w1:p1"})).await;
    let list = r["result"]["commands"].as_array().unwrap();
    let here = list.iter().find(|c| c["name"] == "here").unwrap();
    assert_eq!(here["source"], "project");
    assert_eq!(here["description"], "From the pane folder");

    // No herdr: still the built-ins, no error.
    let r = call(home.path().join("none.sock"), home.path().into(), json!({"pane_id": "w1:p1"})).await;
    assert!(r["result"]["commands"].as_array().unwrap().iter().any(|c| c["name"] == "clear"));
}
