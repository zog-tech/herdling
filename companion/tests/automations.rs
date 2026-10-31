use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use herdlingd::rpc::{self, Ctx};

const LIST_JSON: &str = r#"{"automations":[
  {"id":"a1","name":"Nightly tests","schedule":"0 2 * * *","enabled":true,"pending_approval":true,
   "plan":"run pnpm test","caps":["shell","net"],"content_hash":"sha256:abc"},
  {"id":"a2","name":"Cleanup","enabled":false,"pending_approval":false}
]}"#;

fn fake_bin(dir: &Path, script: &str) -> PathBuf {
    let bin_dir = dir.join("bin");
    std::fs::create_dir_all(&bin_dir).unwrap();
    let path = bin_dir.join("herdr-automate");
    std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    bin_dir
}

async fn call(bin_dirs: Vec<PathBuf>, home: &Path, method: &str, params: Value) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(65536);
    let mut ctx = Ctx::new(home.join("none.sock"), home.into());
    ctx.bin_dirs = bin_dirs;
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    let req = json!({ "id": 1, "method": method, "params": params });
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    let line = BufReader::new(client_rx).lines().next_line().await.unwrap().unwrap();
    serde_json::from_str(&line).unwrap()
}

#[tokio::test]
async fn not_installed_when_missing() {
    let dir = tempfile::tempdir().unwrap();
    for (m, p) in [
        ("automations.list", json!({})),
        ("automations.runs", json!({})),
        ("automations.approve", json!({ "id": "a1", "content_hash": "sha256:abc" })),
    ] {
        let r = call(vec![], dir.path(), m, p).await;
        assert_eq!(r["error"]["code"], "not_installed", "{m}");
    }
}

#[tokio::test]
async fn list_maps_json() {
    let dir = tempfile::tempdir().unwrap();
    let bin = fake_bin(dir.path(), &format!("cat <<'EOF'\n{LIST_JSON}\nEOF"));
    let r = call(vec![bin], dir.path(), "automations.list", json!({})).await;
    let a = r["result"]["automations"].as_array().unwrap();
    assert_eq!(a.len(), 2);
    assert_eq!(
        a[0],
        json!({ "id": "a1", "name": "Nightly tests", "schedule": "0 2 * * *", "enabled": true,
                "pending_approval": true, "plan": "run pnpm test", "caps": ["shell", "net"],
                "content_hash": "sha256:abc" })
    );
    assert_eq!(a[1], json!({ "id": "a2", "name": "Cleanup", "enabled": false, "pending_approval": false }));
}

#[tokio::test]
async fn runs_passes_args_and_maps_json() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("args.txt");
    let body = r#"{"runs":[{"id":"r1","automation_id":"a1","started_at":100,"finished_at":null,"status":"running"}]}"#;
    let bin = fake_bin(dir.path(), &format!("echo \"$@\" > {}\necho '{body}'", out.display()));
    let r = call(vec![bin.clone()], dir.path(), "automations.runs", json!({ "id": "a1", "limit": 5 })).await;
    assert_eq!(r["result"]["runs"][0]["status"], "running");
    assert_eq!(r["result"]["runs"][0]["finished_at"], Value::Null);
    assert_eq!(std::fs::read_to_string(&out).unwrap().trim(), "runs --json --id a1 --limit 5");
    call(vec![bin], dir.path(), "automations.runs", json!({})).await;
    assert_eq!(std::fs::read_to_string(&out).unwrap().trim(), "runs --json --limit 20");
}

#[tokio::test]
async fn approve_passes_hash() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("args.txt");
    let bin = fake_bin(dir.path(), &format!("echo \"$@\" > {}", out.display()));
    let r = call(vec![bin], dir.path(), "automations.approve", json!({ "id": "a1", "content_hash": "sha256:abc" })).await;
    assert_eq!(r["result"], json!({ "approved": true }));
    assert_eq!(std::fs::read_to_string(&out).unwrap().trim(), "approve a1 --hash sha256:abc");
}

#[tokio::test]
async fn approve_rejects_option_like_args() {
    let dir = tempfile::tempdir().unwrap();
    let bin = fake_bin(dir.path(), "exit 0");
    let r = call(vec![bin], dir.path(), "automations.approve", json!({ "id": "--all", "content_hash": "x" })).await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[tokio::test]
async fn nonzero_exit_is_automate_failed() {
    let dir = tempfile::tempdir().unwrap();
    let bin = fake_bin(dir.path(), "echo 'boom: bad thing' >&2\necho 'second line' >&2\nexit 3");
    let r = call(vec![bin], dir.path(), "automations.list", json!({})).await;
    assert_eq!(r["error"]["code"], "automate_failed");
    assert_eq!(r["error"]["message"], "boom: bad thing");
}

#[tokio::test]
async fn unparsable_output_is_bad_output() {
    let dir = tempfile::tempdir().unwrap();
    let bin = fake_bin(dir.path(), "echo 'not json'");
    let r = call(vec![bin], dir.path(), "automations.list", json!({})).await;
    assert_eq!(r["error"]["code"], "bad_output");
}
