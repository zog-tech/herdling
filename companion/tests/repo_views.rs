//! `git.status`, `git.diff` and `git.worktree_add`, on temporary repos made by the tests.

#[path = "support/fake_herdr.rs"]
mod fake_herdr;

use std::collections::HashMap;
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

fn file<'a>(r: &'a Value, path: &str) -> &'a Value {
    r["result"]["files"].as_array().unwrap().iter().find(|f| f["path"] == path).unwrap_or_else(|| panic!("no {path} in {r}"))
}

#[tokio::test]
async fn status_lists_changed_files_with_counts() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    repo(&dir);
    // Unstaged edit, staged edit, staged new file, untracked file, deleted file, binary edit.
    std::fs::write(dir.join("a.txt"), "one\n2\nthree\nfour\n").unwrap();
    std::fs::write(dir.join("src/b.rs"), "fn main() { run(); }\n// end\n").unwrap();
    sh(&dir, &["add", "src/b.rs"]);
    std::fs::write(dir.join("new.md"), "# New\n\ntext\n").unwrap();
    sh(&dir, &["add", "new.md"]);
    std::fs::write(dir.join("notes.log"), "l1\nl2").unwrap();
    std::fs::write(dir.join("logo.bin"), [0u8, 7, 7]).unwrap();
    std::fs::remove_file(dir.join("a.txt")).ok();
    std::fs::write(dir.join("a.txt"), "one\n2\nthree\nfour\n").unwrap();

    // A sub-folder of the repo works too.
    let r = call(home.path(), "git.status", json!({"cwd": dir.join("src").to_string_lossy()})).await;
    let res = &r["result"];
    assert_eq!(res["is_repo"], true, "{r}");
    assert_eq!(res["branch"], "main");
    assert_eq!(res["head"].as_str().unwrap().len(), 7);
    assert_eq!(res["ahead"], 0);
    assert_eq!(res["truncated"], false);
    assert!(res["root"].as_str().unwrap().ends_with("proj"));

    let a = file(&r, "a.txt");
    assert_eq!((a["status"].as_str(), a["staged"].as_bool(), a["unstaged"].as_bool()), (Some("M"), Some(false), Some(true)));
    assert_eq!((a["added"].as_u64(), a["deleted"].as_u64()), (Some(2), Some(1)));
    let b = file(&r, "src/b.rs");
    assert_eq!((b["status"].as_str(), b["staged"].as_bool(), b["unstaged"].as_bool()), (Some("M"), Some(true), Some(false)));
    assert_eq!((b["added"].as_u64(), b["deleted"].as_u64()), (Some(1), Some(1)));
    let n = file(&r, "new.md");
    assert_eq!(n["status"], "A");
    assert_eq!(n["added"], 3);
    let u = file(&r, "notes.log");
    assert_eq!(u["status"], "?");
    assert_eq!(u["added"], 2);
    let bin = file(&r, "logo.bin");
    assert_eq!(bin["binary"], true);
    assert!(bin["added"].is_null());
}

#[tokio::test]
async fn status_of_a_plain_folder_is_not_a_repo() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("plain");
    std::fs::create_dir_all(&dir).unwrap();
    let r = call(home.path(), "git.status", json!({"cwd": dir.to_string_lossy()})).await;
    assert_eq!(r["result"]["is_repo"], false, "{r}");
    assert_eq!(r["result"]["files"], json!([]));

    let r = call(home.path(), "git.status", json!({"cwd": home.path().join("missing").to_string_lossy()})).await;
    assert_eq!(r["error"]["code"], "not_found");
    let r = call(home.path(), "git.status", json!({})).await;
    assert_eq!(r["error"]["code"], "bad_request");
    let r = call(home.path(), "git.status", json!({"cwd": "relative/path"})).await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[tokio::test]
async fn status_finds_the_folder_of_a_pane() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    repo(&dir);
    std::fs::write(dir.join("a.txt"), "changed\n").unwrap();
    let sock = home.path().join("herdr.sock");
    let mut m = HashMap::new();
    m.insert("pane.get".to_string(), json!({"pane": {"pane_id": "p1", "cwd": dir.to_string_lossy(), "agent": "claude"}}));
    fake_herdr::spawn(&sock, m);
    let r = call_with(&sock, home.path(), "git.status", json!({"pane_id": "p1"})).await;
    assert_eq!(r["result"]["files"][0]["path"], "a.txt", "{r}");
}

#[tokio::test]
async fn diff_of_one_file_and_of_the_repo() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    repo(&dir);
    std::fs::write(dir.join("a.txt"), "one\n2\nthree\n").unwrap();
    std::fs::write(dir.join("src/b.rs"), "fn main() { run(); }\n// end\n").unwrap();
    sh(&dir, &["add", "src/b.rs"]);
    std::fs::write(dir.join("logo.bin"), [0u8, 7, 7]).unwrap();
    let cwd = dir.to_string_lossy().to_string();

    let r = call(home.path(), "git.diff", json!({"cwd": cwd, "path": "a.txt"})).await;
    let d = r["result"]["diff"].as_str().unwrap();
    assert!(d.contains("--- a/a.txt") && d.contains("+++ b/a.txt"), "{d}");
    assert!(d.contains("@@ ") && d.contains("-two\n") && d.contains("+2\n"), "{d}");
    assert!(!d.contains("b.rs"));
    assert_eq!(r["result"]["truncated"], false);

    // Staged only and unstaged only.
    let r = call(home.path(), "git.diff", json!({"cwd": cwd, "staged": true})).await;
    let d = r["result"]["diff"].as_str().unwrap();
    assert!(d.contains("src/b.rs") && !d.contains("a.txt"), "{d}");
    let r = call(home.path(), "git.diff", json!({"cwd": cwd, "staged": false})).await;
    let d = r["result"]["diff"].as_str().unwrap();
    assert!(d.contains("a.txt") && !d.contains("src/b.rs"), "{d}");

    // The whole repo: both, and the binary file as one line.
    let r = call(home.path(), "git.diff", json!({"cwd": cwd})).await;
    let d = r["result"]["diff"].as_str().unwrap();
    assert!(d.contains("a.txt") && d.contains("src/b.rs"), "{d}");
    assert!(d.contains("Binary files a/logo.bin and b/logo.bin differ"), "{d}");
}

#[tokio::test]
async fn diff_of_an_untracked_file_shows_a_new_file() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    repo(&dir);
    std::fs::write(dir.join("todo.txt"), "first\nsecond\n").unwrap();
    let r = call(home.path(), "git.diff", json!({"cwd": dir.to_string_lossy(), "path": "todo.txt"})).await;
    let d = r["result"]["diff"].as_str().unwrap();
    assert!(d.contains("new file mode") && d.contains("+first\n+second\n"), "{r}");
}

#[tokio::test]
async fn diff_is_capped() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    repo(&dir);
    let big: String = (0..40_000).map(|i| format!("line number {i} with some text\n")).collect();
    std::fs::write(dir.join("a.txt"), big).unwrap();
    let r = call(home.path(), "git.diff", json!({"cwd": dir.to_string_lossy(), "path": "a.txt"})).await;
    let d = r["result"]["diff"].as_str().unwrap();
    assert_eq!(r["result"]["truncated"], true);
    assert!(d.len() <= git::MAX_DIFF);
    assert!(d.ends_with('\n'));
}

#[tokio::test]
async fn diff_refuses_paths_outside_the_repo() {
    let home = tempfile::tempdir().unwrap();
    let dir = home.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    repo(&dir);
    std::fs::write(home.path().join("secret.txt"), "no\n").unwrap();
    std::os::unix::fs::symlink(home.path(), dir.join("out")).unwrap();
    let cwd = dir.to_string_lossy().to_string();
    for path in ["../secret.txt", "/etc/hosts", "src/../../secret.txt", "out/secret.txt", ""] {
        let r = call(home.path(), "git.diff", json!({"cwd": cwd, "path": path})).await;
        assert_eq!(r["error"]["code"], "bad_request", "{path}: {r}");
    }
    let plain = home.path().join("plain");
    std::fs::create_dir_all(&plain).unwrap();
    let r = call(home.path(), "git.diff", json!({"cwd": plain.to_string_lossy()})).await;
    assert_eq!(r["error"]["code"], "not_a_repo");
}

#[test]
fn parses_porcelain_v2() {
    let raw = "# branch.oid 0123456789abcdef\0# branch.head feat/x\0# branch.upstream origin/feat/x\0# branch.ab +3 -1\0\
1 .M N... 100644 100644 100644 aaa bbb src/a b.ts\0\
2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\0old.ts\0\
u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.rs\0\
? untracked.txt\0";
    let (b, files) = git::parse_status(raw);
    assert_eq!(b.branch.as_deref(), Some("feat/x"));
    assert_eq!(b.upstream.as_deref(), Some("origin/feat/x"));
    assert_eq!((b.ahead, b.behind), (3, 1));
    assert_eq!(files.len(), 4);
    assert_eq!(files[0].path, "src/a b.ts");
    assert_eq!((files[0].status.as_str(), files[0].staged, files[0].unstaged), ("M", false, true));
    assert_eq!((files[1].path.as_str(), files[1].orig_path.as_deref(), files[1].status.as_str()), ("new.ts", Some("old.ts"), "R"));
    assert_eq!(files[2].status, "U");
    assert_eq!(files[3].status, "?");

    let (b, _) = git::parse_status("# branch.oid (initial)\0# branch.head (detached)\0");
    assert_eq!((b.oid, b.branch), (None, None));
}

#[test]
fn parses_numstat() {
    let m = git::parse_numstat("3\t1\ta.txt\0-\t-\tlogo.png\0" );
    assert_eq!(m["a.txt"], Some((3, 1)));
    assert_eq!(m["logo.png"], None);
    let m = git::parse_numstat("2\t0\t\0old.rs\0new.rs\0");
    assert_eq!(m["new.rs"], Some((2, 0)));
}

#[test]
fn checks_paths() {
    assert!(git::check_path("src/a.rs").is_ok());
    assert!(git::check_path("./a.rs").is_ok());
    for bad in ["", "/abs", "../x", "a/../../x", "a/.."] {
        assert!(git::check_path(bad).is_err(), "{bad}");
    }
}
