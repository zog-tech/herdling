//! `git.worktree_add`, on temporary repos made by the tests.

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
