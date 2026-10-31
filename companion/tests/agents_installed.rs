use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use herdlingd::agents;
use herdlingd::rpc::{self, Ctx};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

fn program(dir: &Path, name: &str, mode: u32) {
    std::fs::create_dir_all(dir).unwrap();
    let p = dir.join(name);
    std::fs::write(&p, "#!/bin/sh\n").unwrap();
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(mode)).unwrap();
}

fn list(v: &Value, key: &str) -> Vec<String> {
    v[key].as_array().unwrap().iter().map(|k| k.as_str().unwrap().to_string()).collect()
}

#[test]
fn installed_finds_executables_only() {
    let dir = tempfile::tempdir().unwrap();
    let (a, b) = (dir.path().join("a"), dir.path().join("b"));
    program(&a, "claude", 0o755);
    program(&b, "cursor-agent", 0o755);
    // Not executable: does not count.
    program(&b, "codex", 0o644);
    // The second program name of a kind.
    program(&b, "kilo", 0o755);
    let r = agents::installed(&[a, b]);
    assert_eq!(list(&r, "installed"), ["claude", "cursor", "kilo"]);
    let missing = list(&r, "missing");
    assert!(missing.contains(&"codex".to_string()));
    assert!(!missing.contains(&"claude".to_string()));
    // Each known kind is in exactly one list.
    assert_eq!(list(&r, "installed").len() + missing.len(), agents::AGENT_BINS.len());
}

#[test]
fn search_dirs_adds_install_folders_and_node_versions() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    std::fs::create_dir_all(home.join(".nvm/versions/node/v22.1.0/bin")).unwrap();
    let base = vec![PathBuf::from("/usr/bin"), home.join(".local/bin")];
    let dirs = agents::search_dirs(home, &base);
    assert_eq!(&dirs[..2], &base[..]);
    assert!(dirs.contains(&home.join(".bun/bin")));
    assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
    assert!(dirs.contains(&home.join(".nvm/versions/node/v22.1.0/bin")));
    // No duplicates.
    assert_eq!(dirs.iter().filter(|d| **d == home.join(".local/bin")).count(), 1);
}

#[tokio::test]
async fn rpc_agents_installed_answers_with_both_lists() {
    let dir = tempfile::tempdir().unwrap();
    let (mut tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(65536);
    let mut ctx = Ctx::new(dir.path().join("none.sock"), dir.path().to_path_buf());
    ctx.bin_dirs = vec![dir.path().join("bin")];
    program(&dir.path().join("bin"), "pi", 0o755);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    let mut rx = BufReader::new(client_rx).lines();
    tx.write_all(format!("{}\n", json!({"id": 1, "method": "agents.installed"})).as_bytes()).await.unwrap();
    let r: Value = serde_json::from_str(&rx.next_line().await.unwrap().unwrap()).unwrap();
    assert!(list(&r["result"], "installed").contains(&"pi".to_string()));
    assert!(r["result"]["missing"].is_array());
}
