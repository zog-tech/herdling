//! `git.worktree_add`, on temporary repos made by the tests.

#[path = "support/fake_herdr.rs"]
mod fake_herdr;

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use herdlingd::git;
use herdlingd::rpc::{self, Ctx};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

async fn call_with(sock: &Path, home: &Path, method: &str, params: Value) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(1 << 20);
    let (server_out, client_rx) = tokio::io::duplex(1 << 22);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, Ctx::new(sock.into(), home.into())));
    let req = json!({"id": 1, "method": method, "params": params});
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    let mut lines = BufReader::new(client_rx).lines();
    let l = tokio::time::timeout(Duration::from_secs(20), lines.next_line()).await.unwrap().unwrap().unwrap();
    serde_json::from_str(&l).unwrap()
}

async fn call(home: &Path, method: &str, params: Value) -> Value {
    call_with(&home.join("none.sock"), home, method, params).await
}

fn sh(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

/// A repo with one commit: `a.txt` (3 lines), `src/b.rs` (2 lines), `logo.bin` (binary).
fn repo(dir: &Path) {
    sh(dir, &["init", "-q", "-b", "main"]);
    sh(dir, &["config", "user.name", "Test"]);
    sh(dir, &["config", "user.email", "test@example.com"]);
    sh(dir, &["config", "commit.gpgsign", "false"]);
    std::fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/b.rs"), "fn main() {}\n// end\n").unwrap();
    std::fs::write(dir.join("logo.bin"), [0u8, 1, 2, 3, 0, 9]).unwrap();
    sh(dir, &["add", "."]);
    sh(dir, &["commit", "-q", "-m", "first"]);
}

#[tokio::test]
async fn worktree_add_makes_a_branch_and_a_folder() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    repo(&dir);
    let cwd = dir.to_string_lossy().to_string();
    let r = call(home.path(), "git.worktree_add", json!({"cwd": cwd, "branch": "herdling/fix-1"})).await;
    let path = r["result"]["path"].as_str().unwrap_or_else(|| panic!("{r}")).to_string();
    assert!(path.ends_with(".worktrees/herdling-fix-1"), "{path}");
    assert_eq!(r["result"]["branch"], "herdling/fix-1");
    assert!(Path::new(&path).join("a.txt").is_file());
    let exclude = std::fs::read_to_string(dir.join(".git/info/exclude")).unwrap();
    assert!(exclude.lines().any(|l| l == "/.worktrees/"));

    // The main work tree does not show the new folder.
    let s = call(home.path(), "git.status", json!({"cwd": cwd})).await;
    assert_eq!(s["result"]["files"], json!([]), "{s}");
    // The worktree has its own branch.
    let s = call(home.path(), "git.status", json!({"cwd": path})).await;
    assert_eq!(s["result"]["branch"], "herdling/fix-1");

    // The same branch again.
    let r = call(home.path(), "git.worktree_add", json!({"cwd": cwd, "branch": "herdling/fix-1"})).await;
    assert_eq!(r["error"]["code"], "already_exists", "{r}");
    // Exclude line only once.
    call(home.path(), "git.worktree_add", json!({"cwd": cwd, "branch": "two"})).await;
    let exclude = std::fs::read_to_string(dir.join(".git/info/exclude")).unwrap();
    assert_eq!(exclude.lines().filter(|l| *l == "/.worktrees/").count(), 1);
}

#[tokio::test]
async fn worktree_add_errors() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    repo(&dir);
    let cwd = dir.to_string_lossy().to_string();
    for bad in ["", "-x", "a..b", "has space", "end.lock", "a~b", "@"] {
        let r = call(home.path(), "git.worktree_add", json!({"cwd": cwd, "branch": bad})).await;
        assert_eq!(r["error"]["code"], "bad_request", "{bad}: {r}");
    }
    let plain = home.path().join("plain");
    std::fs::create_dir_all(&plain).unwrap();
    let r = call(home.path(), "git.worktree_add", json!({"cwd": plain.to_string_lossy(), "branch": "x"})).await;
    assert_eq!(r["error"]["code"], "not_a_repo");
    // A repo with no commit.
    let empty = home.path().join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    sh(&empty, &["init", "-q"]);
    let r = call(home.path(), "git.worktree_add", json!({"cwd": empty.to_string_lossy(), "branch": "x"})).await;
    assert_eq!(r["error"]["code"], "command_failed");
}

#[test]
fn slugs() {
    assert_eq!(git::worktree_slug("herdling/ab12"), "herdling-ab12");
    assert_eq!(git::worktree_slug("feat/ü x"), "feat-__x");
    assert_eq!(git::worktree_slug(".hidden"), "hidden");
}

/// A fake herdr whose `worktree.create` runs `git worktree add`, as herdr does, and records
/// the params. `answer` can give an error instead; `None` makes the worktree.
fn herdr_with_worktrees(
    sock: &Path,
    answer: impl Fn() -> Option<(String, String)> + Send + Sync + 'static,
) -> std::sync::Arc<std::sync::Mutex<Vec<Value>>> {
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let log = seen.clone();
    fake_herdr::spawn_result(sock, move |method, p| {
        if method != "worktree.create" {
            return Err(("unknown_method".into(), method.into()));
        }
        log.lock().unwrap().push(p.clone());
        if let Some(e) = answer() {
            return Err(e);
        }
        let root = Path::new(p["cwd"].as_str().unwrap());
        let path = p["path"].as_str().unwrap();
        let branch = p["branch"].as_str().unwrap();
        sh(root, &["worktree", "add", "-b", branch, "--", path, p["base"].as_str().unwrap()]);
        Ok(json!({
            "type": "worktree_created",
            "workspace": {"workspace_id": "w7", "label": "fix-2"},
            "tab": {"tab_id": "w7:t1"},
            "root_pane": {"pane_id": "w7:p1"},
            "worktree": {"path": path, "branch": branch, "is_linked_worktree": true}
        }))
    });
    seen
}

#[tokio::test]
async fn herdr_makes_the_worktree_when_it_can() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    repo(&dir);
    let sock = home.path().join("herdr.sock");
    let seen = herdr_with_worktrees(&sock, || None);
    let cwd = dir.to_string_lossy().to_string();

    let r = call_with(&sock, home.path(), "git.worktree_add", json!({"cwd": cwd, "branch": "herdling/fix-2"})).await;
    let res = &r["result"];
    assert_eq!(res["via"], "herdr", "{r}");
    assert_eq!(res["workspace_id"], "w7");
    assert_eq!(res["tab_id"], "w7:t1");
    assert_eq!(res["pane_id"], "w7:p1");
    assert_eq!(res["branch"], "herdling/fix-2");
    let path = res["path"].as_str().unwrap();
    assert!(path.ends_with(".worktrees/herdling-fix-2"), "{path}");
    assert!(Path::new(path).join("a.txt").is_file());
    // herdr gets the checked values: the repo root, the branch, the folder under `.worktrees`.
    let p = seen.lock().unwrap()[0].clone();
    assert_eq!(p["cwd"], res["root"]);
    assert_eq!(p["branch"], "herdling/fix-2");
    assert_eq!(p["path"], res["path"]);
    assert_eq!(p["base"], "HEAD");
    assert_eq!(p["focus"], false);
    let exclude = std::fs::read_to_string(dir.join(".git/info/exclude")).unwrap();
    assert!(exclude.lines().any(|l| l == "/.worktrees/"));

    // The checks run before herdr: a bad name or a used branch never gets to herdr.
    let r = call_with(&sock, home.path(), "git.worktree_add", json!({"cwd": cwd, "branch": "a..b"})).await;
    assert_eq!(r["error"]["code"], "bad_request", "{r}");
    let r = call_with(&sock, home.path(), "git.worktree_add", json!({"cwd": cwd, "branch": "herdling/fix-2"})).await;
    assert_eq!(r["error"]["code"], "already_exists", "{r}");
    assert_eq!(seen.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn git_makes_the_worktree_when_herdr_has_no_worktree_create() {
    for (name, code, message) in [
        ("fake", "unknown_method", "worktree.create"),
        ("herdr", "invalid_request", "invalid request: unknown variant `worktree.create`, expected one of `ping`"),
    ] {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path().join("proj");
        std::fs::create_dir_all(&dir).unwrap();
        repo(&dir);
        let sock = home.path().join("herdr.sock");
        let seen = herdr_with_worktrees(&sock, move || Some((code.into(), message.into())));
        let cwd = dir.to_string_lossy().to_string();
        for branch in ["one", "two"] {
            let r = call_with(&sock, home.path(), "git.worktree_add", json!({"cwd": cwd, "branch": branch})).await;
            assert_eq!(r["result"]["via"], "git", "{name}: {r}");
            assert!(r["result"].get("workspace_id").is_none(), "{r}");
            assert!(Path::new(r["result"]["path"].as_str().unwrap()).join("a.txt").is_file());
        }
        // The answer is kept: the second worktree does not ask herdr again.
        assert_eq!(seen.lock().unwrap().len(), 1, "{name}");
    }
}

#[tokio::test]
async fn git_makes_the_worktree_when_herdr_refuses_the_source() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    repo(&dir);
    let sock = home.path().join("herdr.sock");
    let seen = herdr_with_worktrees(&sock, || Some(("linked_worktree_source".into(), "start from the parent".into())));
    let r = call_with(&sock, home.path(), "git.worktree_add", json!({"cwd": dir.to_string_lossy(), "branch": "x"})).await;
    assert_eq!(r["result"]["via"], "git", "{r}");
    // Not kept: herdr has the method.
    call_with(&sock, home.path(), "git.worktree_add", json!({"cwd": dir.to_string_lossy(), "branch": "y"})).await;
    assert_eq!(seen.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn other_herdr_errors_do_not_fall_back_to_git() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    repo(&dir);
    let sock = home.path().join("herdr.sock");
    herdr_with_worktrees(&sock, || Some(("worktree_operation_in_progress".into(), "busy".into())));
    let r = call_with(&sock, home.path(), "git.worktree_add", json!({"cwd": dir.to_string_lossy(), "branch": "x"})).await;
    assert_eq!(r["error"]["code"], "worktree_operation_in_progress", "{r}");
    assert!(!dir.join(".worktrees/x").exists());
}

#[test]
fn unknown_method_answers() {
    use herdlingd::worktree::is_unknown_method;
    assert!(is_unknown_method("unknown_method", ""));
    assert!(is_unknown_method("invalid_request", "invalid request: unknown variant `worktree.create`"));
    assert!(!is_unknown_method("invalid_request", "branch is required"));
    assert!(!is_unknown_method("not_found", "unknown variant"));
}
