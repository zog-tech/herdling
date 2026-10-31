#[path = "support/fake_herdr.rs"]
mod fake_herdr;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use herdlingd::commands::{self, Command};
use herdlingd::rpc::{self, Ctx};

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

fn codex(home: &Path, cwd: Option<&Path>) -> Vec<Command> {
    commands::codex_list(home, &home.join(".codex"), &home.join("etc-skills"), cwd)
}

#[test]
fn codex_builtins_have_no_trigger() {
    let home = tempfile::tempdir().unwrap();
    let list = codex(home.path(), None);
    assert_eq!(list.len(), 13);
    assert!(list.iter().all(|c| c.source == "builtin" && c.trigger.is_none()));
    assert!(find(&list, "permissions").is_some());
    assert!(find(&list, "clear").is_none());
}

#[test]
fn codex_prompts_are_top_level_md_files() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    write(&h.join(".codex/prompts/draft.md"), "---\ndescription: Draft a note\n---\nBody\n");
    write(&h.join(".codex/prompts/bare.md"), "No frontmatter\n");
    write(&h.join(".codex/prompts/sub/nested.md"), "Nested\n");
    write(&h.join(".codex/prompts/readme.txt"), "text\n");
    let list = codex(h, None);
    let p = find(&list, "prompts:draft").unwrap();
    assert_eq!((p.source, p.trigger, p.description.as_deref()), ("user", None, Some("Draft a note")));
    assert_eq!(find(&list, "prompts:bare").unwrap().description, None);
    assert!(find(&list, "prompts:nested").is_none());
    assert!(find(&list, "prompts:readme").is_none());
}

#[test]
fn codex_home_folder_can_move() {
    let home = tempfile::tempdir().unwrap();
    let alt = tempfile::tempdir().unwrap();
    write(&alt.path().join("prompts/moved.md"), "Moved\n");
    write(&home.path().join(".codex/prompts/old.md"), "Old\n");
    let list = commands::list_for(Some("codex"), &roots(home.path(), &home.path().join("none"), Some(alt.path())), None);
    assert!(find(&list, "prompts:moved").is_some());
    assert!(find(&list, "prompts:old").is_none());
    // Without `CODEX_HOME`: `~/.codex`.
    let list = commands::list_for(Some("codex"), &roots(home.path(), &home.path().join("none"), None), None);
    assert!(find(&list, "prompts:old").is_some());
}

#[test]
fn codex_skills_walk_up_to_the_git_root_and_beat_user_and_admin() {
    let home = tempfile::tempdir().unwrap();
    let work = tempfile::tempdir().unwrap();
    let h = home.path();
    let root = work.path().join("repo");
    let cwd = root.join("pkg/sub");
    std::fs::create_dir_all(root.join(".git")).unwrap();
    std::fs::create_dir_all(&cwd).unwrap();
    let skill = |dir: &Path, name: &str, desc: &str| {
        write(&dir.join(format!(".agents/skills/{name}/SKILL.md")), &format!("---\nname: {name}\ndescription: {desc}\n---\n"))
    };
    skill(h, "ship", "User ship");
    skill(h, "only-user", "User only");
    write(&h.join("etc-skills/ship/SKILL.md"), "---\nname: ship\ndescription: Admin ship\n---\n");
    write(&h.join("etc-skills/admin-only/SKILL.md"), "---\nname: admin-only\n---\n");
    skill(&root, "ship", "Repo ship");
    skill(&root, "lint", "Repo lint");
    skill(&cwd, "lint", "Sub lint");
    // Above the git root and Claude folders: not used.
    skill(work.path(), "outside", "Outside");
    write(&root.join(".claude/skills/claude-only/SKILL.md"), "---\nname: claude-only\n---\n");

    let list = codex(h, Some(&cwd));
    let ship = find(&list, "ship").unwrap();
    assert_eq!((ship.source, ship.trigger, ship.description.as_deref()), ("project", Some("$"), Some("Repo ship")));
    assert_eq!(find(&list, "lint").unwrap().description.as_deref(), Some("Sub lint"));
    assert_eq!(find(&list, "only-user").unwrap().source, "user");
    assert_eq!(find(&list, "admin-only").unwrap().trigger, Some("$"));
    assert!(find(&list, "outside").is_none());
    assert!(find(&list, "claude-only").is_none());
    assert_eq!(list.iter().filter(|c| c.name == "ship").count(), 1);
}

#[test]
fn codex_user_skill_beats_admin_and_home_is_not_a_project() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    write(&h.join(".agents/skills/ship/SKILL.md"), "---\ndescription: User ship\n---\n");
    write(&h.join("etc-skills/ship/SKILL.md"), "---\ndescription: Admin ship\n---\n");
    // With no git root, only `cwd` counts, not its parents.
    let cwd = h.join("loose/deep");
    write(&h.join("loose/.agents/skills/parent/SKILL.md"), "---\n---\n");
    write(&cwd.join(".agents/skills/here/SKILL.md"), "---\n---\n");
    let list = codex(h, Some(&cwd));
    assert_eq!(find(&list, "ship").unwrap().description.as_deref(), Some("User ship"));
    assert!(find(&list, "here").is_some());
    assert!(find(&list, "parent").is_none());
    // `cwd` = home: no project skills, the user skills once.
    let list = codex(h, Some(h));
    assert_eq!(list.iter().filter(|c| c.name == "ship").count(), 1);
}

#[test]
fn codex_follows_symlinked_skills_and_skips_unreadable_ones() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    write(&h.join("elsewhere/linked/SKILL.md"), "---\nname: linked\ndescription: Via link\n---\n");
    std::fs::create_dir_all(h.join(".agents/skills")).unwrap();
    std::os::unix::fs::symlink(h.join("elsewhere/linked"), h.join(".agents/skills/linked")).unwrap();
    std::fs::create_dir_all(h.join(".agents/skills/empty")).unwrap();
    let list = codex(h, None);
    assert_eq!(find(&list, "linked").unwrap().description.as_deref(), Some("Via link"));
    assert!(find(&list, "empty").is_none());
}

#[test]
fn kind_routing_and_claude_output_stays_the_same() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    write(&h.join(".claude/commands/mine.md"), "Mine\n");
    write(&h.join(".agents/skills/cx/SKILL.md"), "---\n---\n");
    let none = h.join("none");
    let claude = commands::list(h, None);
    for kind in [None, Some("claude"), Some("unknown")] {
        assert_eq!(commands::list_for(kind, &roots(h, &none, None), None), claude);
    }
    assert!(claude.iter().all(|c| c.trigger.is_none()));
    assert!(!serde_json::to_string(&claude).unwrap().contains("trigger"));
    let cx = commands::list_for(Some("codex"), &roots(h, &none, None), None);
    assert!(find(&cx, "mine").is_none());
    assert!(find(&cx, "cx").is_some());
    assert!(serde_json::to_string(&cx).unwrap().contains(r#""trigger":"$""#));
}

#[tokio::test]
async fn rpc_kind_param_and_pane_kind_pick_the_codex_list() {
    let home = tempfile::tempdir().unwrap();
    let proj = tempfile::tempdir().unwrap();
    write(&proj.path().join(".agents/skills/cx/SKILL.md"), "---\ndescription: Codex skill\n---\n");
    let sock = home.path().join("herdr.sock");
    let mut m = HashMap::new();
    m.insert("pane.get".to_string(), json!({"type": "pane_get", "pane": {"pane_id": "w1:p1", "cwd": proj.path(), "agent": "codex"}}));
    fake_herdr::spawn(&sock, m);

    // The kind from the pane.
    let r = call(sock.clone(), home.path().into(), json!({"pane_id": "w1:p1"})).await;
    let list = r["result"]["commands"].as_array().unwrap();
    let cx = list.iter().find(|c| c["name"] == "cx").unwrap();
    assert_eq!((cx["trigger"].as_str(), cx["source"].as_str()), (Some("$"), Some("project")));
    // The explicit kind wins over the pane kind.
    let r = call(sock.clone(), home.path().into(), json!({"pane_id": "w1:p1", "kind": "claude"})).await;
    let list = r["result"]["commands"].as_array().unwrap();
    assert!(list.iter().any(|c| c["name"] == "clear"));
    assert!(!list.iter().any(|c| c["name"] == "cx"));
    // The explicit kind works with no herdr.
    let r = call(home.path().join("none.sock"), home.path().into(), json!({"kind": "codex"})).await;
    assert!(r["result"]["commands"].as_array().unwrap().iter().any(|c| c["name"] == "permissions"));
}

fn roots<'a>(home: &'a Path, admin: &'a Path, codex_home: Option<&'a Path>) -> commands::Roots<'a> {
    commands::Roots { home, codex_home, admin_skills: admin, pi_agent_dir: None, xdg_config: None }
}

fn pi(home: &Path, cwd: Option<&Path>) -> Vec<Command> {
    commands::list_for(Some("pi"), &roots(home, &home.join("none"), None), cwd)
}

fn opencode(home: &Path, cwd: Option<&Path>) -> Vec<Command> {
    commands::list_for(Some("opencode"), &roots(home, &home.join("none"), None), cwd)
}

/// A temp repo with a `.git` folder and a `pkg/sub` folder below it.
fn repo() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("repo");
    let cwd = root.join("pkg/sub");
    std::fs::create_dir_all(root.join(".git")).unwrap();
    std::fs::create_dir_all(&cwd).unwrap();
    (work, root, cwd)
}

#[test]
fn pi_builtins_have_no_trigger() {
    let home = tempfile::tempdir().unwrap();
    let list = pi(home.path(), None);
    assert_eq!(list.len(), 23);
    assert!(list.iter().all(|c| c.source == "builtin" && c.trigger.is_none() && c.description.is_some()));
    assert!(find(&list, "scoped-models").is_some());
    assert!(find(&list, "clear").is_none());
}

#[test]
fn pi_skills_are_found_recursively_and_named_skill_colon() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    write(&h.join(".pi/agent/skills/deploy/SKILL.md"), "---\nname: ship-it\ndescription: Ship the app\n---\n");
    write(&h.join(".pi/agent/skills/group/inner/SKILL.md"), "---\ndescription: Deep one\n---\n");
    // A folder with `SKILL.md` is a skill: its subfolders are not searched.
    write(&h.join(".pi/agent/skills/deploy/refs/SKILL.md"), "---\ndescription: Not a skill\n---\n");
    // No description: not loaded.
    write(&h.join(".pi/agent/skills/nodesc/SKILL.md"), "---\nname: nodesc\n---\n");
    write(&h.join(".agents/skills/shared/SKILL.md"), "---\ndescription: Shared\n---\n");
    let list = pi(h, None);
    let s = find(&list, "skill:ship-it").unwrap();
    assert_eq!((s.source, s.trigger, s.description.as_deref()), ("user", None, Some("Ship the app")));
    assert_eq!(find(&list, "skill:inner").unwrap().description.as_deref(), Some("Deep one"));
    assert!(find(&list, "skill:refs").is_none());
    assert!(find(&list, "skill:nodesc").is_none());
    assert!(find(&list, "skill:shared").is_some());
    assert!(find(&list, "ship-it").is_none());
}

#[test]
fn pi_root_md_files_are_skills_only_under_pi_folders() {
    let home = tempfile::tempdir().unwrap();
    let (_w, root, cwd) = repo();
    let h = home.path();
    write(&h.join(".pi/agent/skills/note.md"), "---\ndescription: A root skill\n---\nBody\n");
    write(&h.join(".pi/agent/skills/plain.md"), "No frontmatter\n");
    write(&h.join(".pi/agent/skills/empty.md"), "---\nname: empty\ndescription:\n---\n");
    // Nested md files in a pi skills folder are not root files.
    write(&h.join(".pi/agent/skills/group/nested.md"), "---\ndescription: Nested\n---\n");
    write(&h.join(".agents/skills/ignored.md"), "---\ndescription: Ignored\n---\n");
    write(&cwd.join(".pi/skills/proj.md"), "---\ndescription: Project root skill\n---\n");
    write(&root.join(".agents/skills/ignored2.md"), "---\ndescription: Ignored\n---\n");
    let list = pi(h, Some(&cwd));
    assert_eq!(find(&list, "skill:note").unwrap().description.as_deref(), Some("A root skill"));
    assert_eq!(find(&list, "skill:proj").unwrap().source, "project");
    for gone in ["skill:plain", "skill:empty", "skill:nested", "skill:ignored", "skill:ignored2"] {
        assert!(find(&list, gone).is_none(), "{gone}");
    }
}

#[test]
fn pi_project_skills_walk_to_the_git_root_and_beat_user_ones() {
    let home = tempfile::tempdir().unwrap();
    let (work, root, cwd) = repo();
    let h = home.path();
    let skill = |dir: &Path, desc: &str| write(&dir.join("ship/SKILL.md"), &format!("---\ndescription: {desc}\n---\n"));
    skill(&h.join(".pi/agent/skills"), "User pi");
    skill(&h.join(".agents/skills"), "User agents");
    skill(&root.join(".agents/skills"), "Root agents");
    write(&root.join(".agents/skills/rootonly/SKILL.md"), "---\ndescription: Root only\n---\n");
    write(&work.path().join(".agents/skills/outside/SKILL.md"), "---\ndescription: Outside\n---\n");
    let list = pi(h, Some(&cwd));
    let ship = find(&list, "skill:ship").unwrap();
    assert_eq!((ship.source, ship.description.as_deref()), ("project", Some("Root agents")));
    assert!(find(&list, "skill:rootonly").is_some());
    assert!(find(&list, "skill:outside").is_none());
    assert_eq!(list.iter().filter(|c| c.name == "skill:ship").count(), 1);
    // A `.pi/skills` folder in `cwd` beats `.agents/skills` above it.
    skill(&cwd.join(".pi/skills"), "Sub pi");
    let list = pi(h, Some(&cwd));
    assert_eq!(find(&list, "skill:ship").unwrap().description.as_deref(), Some("Sub pi"));
    // Without the project: the user `.pi/agent` folder beats `~/.agents`.
    let list = pi(h, None);
    assert_eq!(find(&list, "skill:ship").unwrap().description.as_deref(), Some("User pi"));
}

#[test]
fn pi_prompts_are_named_by_file_and_beat_builtins() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    write(&h.join(".pi/agent/prompts/review.md"), "---\ndescription: Review staged changes\n---\nBody\n");
    write(&h.join(".pi/agent/prompts/bare.md"), "\n\nFirst line wins.\nMore.\n");
    write(&h.join(".pi/agent/prompts/sub/nested.md"), "Nested\n");
    write(&h.join(".pi/agent/prompts/notes.txt"), "text\n");
    write(&h.join(".pi/agent/prompts/model.md"), "---\ndescription: My model prompt\n---\n");
    let proj = h.join("work");
    write(&proj.join(".pi/prompts/review.md"), "---\ndescription: Project review\n---\n");
    let list = pi(h, Some(&proj));
    let r = find(&list, "review").unwrap();
    assert_eq!((r.source, r.trigger, r.description.as_deref()), ("project", None, Some("Project review")));
    assert_eq!(find(&list, "bare").unwrap().description.as_deref(), Some("First line wins."));
    assert!(find(&list, "nested").is_none() && find(&list, "notes").is_none());
    let m = find(&list, "model").unwrap();
    assert_eq!((m.source, m.description.as_deref()), ("user", Some("My model prompt")));
    assert_eq!(list.iter().filter(|c| c.name == "model").count(), 1);
}

#[test]
fn pi_agent_dir_can_move() {
    let home = tempfile::tempdir().unwrap();
    let alt = tempfile::tempdir().unwrap();
    write(&alt.path().join("prompts/moved.md"), "Moved\n");
    write(&home.path().join(".pi/agent/prompts/old.md"), "Old\n");
    let none = home.path().join("none");
    let mut r = roots(home.path(), &none, None);
    r.pi_agent_dir = Some(alt.path());
    let list = commands::list_for(Some("pi"), &r, None);
    assert!(find(&list, "moved").is_some() && find(&list, "old").is_none());
}

#[test]
fn pi_settings_paths_add_skills_and_prompts() {
    let home = tempfile::tempdir().unwrap();
    let extra = tempfile::tempdir().unwrap();
    let h = home.path();
    write(&h.join(".pi/agent/extra-skills/one/SKILL.md"), "---\ndescription: One\n---\n");
    write(&extra.path().join("two/SKILL.md"), "---\ndescription: Two\n---\n");
    write(&h.join("loose/three.md"), "---\nname: three\ndescription: Three\n---\n");
    write(&h.join(".pi/agent/extra-prompts/p1.md"), "P1\n");
    write(
        &h.join(".pi/agent/settings.json"),
        &format!(
            r#"{{
  // comment
  "skills": ["extra-skills", "{}", "~/loose/three.md", "!skipped", "*.glob",],
  "prompts": ["extra-prompts", "missing"],
}}"#,
            extra.path().display()
        ),
    );
    // A project settings file resolves against `.pi`.
    let proj = h.join("work");
    write(&proj.join(".pi/more/four/SKILL.md"), "---\ndescription: Four\n---\n");
    write(&proj.join(".pi/settings.json"), r#"{"skills": ["more"]}"#);
    let list = pi(h, Some(&proj));
    for n in ["skill:one", "skill:two", "skill:three", "skill:four", "p1"] {
        assert!(find(&list, n).is_some(), "{n}");
    }
    assert_eq!(find(&list, "skill:four").unwrap().source, "project");
    // A broken settings file is skipped.
    write(&h.join(".pi/agent/settings.json"), "{ not json");
    assert!(find(&pi(h, None), "skill:one").is_none());
}

#[test]
fn opencode_builtins_have_no_trigger() {
    let home = tempfile::tempdir().unwrap();
    let list = opencode(home.path(), None);
    assert_eq!(list.len(), 11);
    assert!(list.iter().all(|c| c.source == "builtin" && c.trigger.is_none()));
    assert!(find(&list, "connect").is_some() && find(&list, "clear").is_none());
}

#[test]
fn opencode_command_folders_in_both_spellings_with_nested_names() {
    let home = tempfile::tempdir().unwrap();
    let (_w, root, cwd) = repo();
    let h = home.path();
    write(&h.join(".config/opencode/command/test.md"), "---\ndescription: Run tests\n---\nBody\n");
    write(&h.join(".config/opencode/commands/git/sync.md"), "---\ndescription: Sync\n---\n");
    write(&h.join(".config/opencode/commands/nodesc.md"), "First body line is not used.\n");
    write(&h.join(".config/opencode/commands/readme.txt"), "text\n");
    write(&root.join(".opencode/commands/a/b/deep.md"), "---\ndescription: Deep\n---\n");
    write(&root.join(".opencode/command/lint.md"), "---\ndescription: Lint\n---\n");
    let list = opencode(h, Some(&cwd));
    let t = find(&list, "test").unwrap();
    assert_eq!((t.source, t.trigger, t.description.as_deref()), ("user", None, Some("Run tests")));
    assert_eq!(find(&list, "git/sync").unwrap().description.as_deref(), Some("Sync"));
    assert_eq!(find(&list, "nodesc").unwrap().description, None);
    assert!(find(&list, "readme").is_none());
    assert_eq!(find(&list, "a/b/deep").unwrap().source, "project");
    assert_eq!(find(&list, "lint").unwrap().source, "project");
}

#[test]
fn opencode_xdg_config_home_moves_the_global_folder() {
    let home = tempfile::tempdir().unwrap();
    let xdg = tempfile::tempdir().unwrap();
    write(&xdg.path().join("opencode/command/moved.md"), "Moved\n");
    write(&home.path().join(".config/opencode/command/old.md"), "Old\n");
    let none = home.path().join("none");
    let mut r = roots(home.path(), &none, None);
    r.xdg_config = Some(xdg.path());
    let list = commands::list_for(Some("opencode"), &r, None);
    assert!(find(&list, "moved").is_some() && find(&list, "old").is_none());
}

#[test]
fn opencode_config_command_object_with_jsonc() {
    let home = tempfile::tempdir().unwrap();
    let (_w, root, cwd) = repo();
    let h = home.path();
    write(
        &h.join(".config/opencode/opencode.jsonc"),
        r#"{
  // global config
  "$schema": "https://opencode.ai/config.json",
  "theme": "a // not a comment",
  /* block
     comment */
  "command": {
    "global-cmd": { "description": "From global, with \"quotes\"", "template": "x", },
    "nodesc": { "template": "y" },
  },
}"#,
    );
    write(&root.join("opencode.json"), r#"{"command": {"proj-cmd": {"description": "From project", "template": "z"}}}"#);
    // Broken file: skipped.
    write(&cwd.join("opencode.json"), r#"{"command": {"never": "#);
    // A file with no `command` object: skipped.
    write(&cwd.join("opencode.jsonc"), r#"{"theme": "x"}"#);
    let list = opencode(h, Some(&cwd));
    let g = find(&list, "global-cmd").unwrap();
    assert_eq!((g.source, g.description.as_deref()), ("user", Some("From global, with \"quotes\"")));
    assert_eq!(find(&list, "nodesc").unwrap().description, None);
    let p = find(&list, "proj-cmd").unwrap();
    assert_eq!((p.source, p.description.as_deref()), ("project", Some("From project")));
    assert!(find(&list, "never").is_none());
}

#[test]
fn opencode_project_beats_global_and_custom_beats_builtin() {
    let home = tempfile::tempdir().unwrap();
    let (_w, root, cwd) = repo();
    let h = home.path();
    write(&h.join(".config/opencode/command/ship.md"), "---\ndescription: Global ship\n---\n");
    write(&h.join(".config/opencode/command/compact.md"), "---\ndescription: My compact\n---\n");
    write(&root.join(".opencode/command/ship.md"), "---\ndescription: Repo ship\n---\n");
    write(&root.join("opencode.json"), r#"{"command": {"ship": {"description": "Config ship"}, "init": {"description": "My init"}}}"#);
    write(&cwd.join(".opencode/command/ship.md"), "---\ndescription: Sub ship\n---\n");
    let list = opencode(h, Some(&cwd));
    let ship = find(&list, "ship").unwrap();
    assert_eq!((ship.source, ship.description.as_deref()), ("project", Some("Sub ship")));
    assert_eq!(find(&list, "compact").unwrap().description.as_deref(), Some("My compact"));
    assert_eq!(find(&list, "init").unwrap().description.as_deref(), Some("My init"));
    for n in ["ship", "compact", "init"] {
        assert_eq!(list.iter().filter(|c| c.name == n && c.trigger.is_none()).count(), 1, "{n}");
    }
    // Without the project folders: the global command, then the built-in.
    let list = opencode(h, None);
    assert_eq!(find(&list, "ship").unwrap().description.as_deref(), Some("Global ship"));
    assert_eq!(find(&list, "init").unwrap().source, "builtin");
}

#[test]
fn opencode_walk_stops_at_the_git_root() {
    let home = tempfile::tempdir().unwrap();
    let (work, root, cwd) = repo();
    write(&work.path().join(".opencode/command/outside.md"), "Outside\n");
    write(&work.path().join(".claude/skills/outside-skill/SKILL.md"), "---\n---\n");
    write(&root.join(".opencode/command/inside.md"), "Inside\n");
    let list = opencode(home.path(), Some(&cwd));
    assert!(find(&list, "inside").is_some());
    assert!(find(&list, "outside").is_none() && find(&list, "outside-skill").is_none());
}

#[test]
fn opencode_skills_use_the_at_trigger_from_all_six_folders() {
    let home = tempfile::tempdir().unwrap();
    let (_w, root, cwd) = repo();
    let h = home.path();
    let skill = |dir: &Path, name: &str, desc: &str| {
        write(&dir.join(format!("skills/{name}/SKILL.md")), &format!("---\nname: {name}\ndescription: {desc}\n---\n"))
    };
    skill(&root.join(".opencode"), "p-oc", "Project opencode");
    skill(&root.join(".claude"), "p-claude", "Project claude");
    skill(&cwd.join(".agents"), "p-agents", "Project agents");
    skill(&h.join(".config/opencode"), "u-oc", "User opencode");
    skill(&h.join(".claude"), "u-claude", "User claude");
    skill(&h.join(".agents"), "u-agents", "User agents");
    skill(&root.join(".opencode"), "dup", "Project dup");
    skill(&h.join(".claude"), "dup", "User dup");
    // A skill and a command can share a name: both stay.
    write(&root.join(".opencode/command/p-oc.md"), "Same name\n");
    let list = opencode(h, Some(&cwd));
    for n in ["p-oc", "p-claude", "p-agents", "u-oc", "u-claude", "u-agents"] {
        let s = list.iter().find(|c| c.name == n && c.trigger == Some("@")).unwrap_or_else(|| panic!("{n}"));
        assert_eq!(s.source, if n.starts_with('p') { "project" } else { "user" });
    }
    let dup = list.iter().find(|c| c.name == "dup").unwrap();
    assert_eq!((dup.trigger, dup.description.as_deref()), (Some("@"), Some("Project dup")));
    assert!(list.iter().any(|c| c.name == "p-oc" && c.trigger.is_none()));
    // Skills never take the `/` trigger; built-ins keep none.
    assert!(find(&list, "skills").unwrap().trigger.is_none());
    assert!(serde_json::to_string(&list).unwrap().contains(r#""trigger":"@""#));
}

#[tokio::test]
async fn rpc_kind_param_picks_the_pi_and_opencode_lists() {
    let home = tempfile::tempdir().unwrap();
    let none = home.path().join("none.sock");
    let r = call(none.clone(), home.path().into(), json!({"kind": "pi"})).await;
    assert!(r["result"]["commands"].as_array().unwrap().iter().any(|c| c["name"] == "scoped-models"));
    let r = call(none, home.path().into(), json!({"kind": "opencode"})).await;
    assert!(r["result"]["commands"].as_array().unwrap().iter().any(|c| c["name"] == "connect"));
}
