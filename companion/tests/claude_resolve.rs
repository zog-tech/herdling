#[path = "support/fake_herdr.rs"]
mod fake_herdr;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use zogsshd::claude;
use zogsshd::rpc::{self, Ctx};

struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
}

impl Session {
    fn start(sock: PathBuf, home: PathBuf) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(65536);
        let (server_out, client_rx) = tokio::io::duplex(65536);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, Ctx::new(sock, home)));
        Session { tx: client_tx, rx: BufReader::new(client_rx).lines() }
    }
    async fn call(&mut self, method: &str, params: Value) -> Value {
        let req = json!({"id": 1, "method": method, "params": params});
        self.tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
        serde_json::from_str(&self.rx.next_line().await.unwrap().unwrap()).unwrap()
    }
}

fn fake(dir: &Path, agent: &str, cwd: &str, fg_pid: u32) -> PathBuf {
    let sock = dir.join("herdr.sock");
    let mut m = HashMap::new();
    m.insert("agent.get".to_string(), json!({"type":"agent_get","agent":{"agent":agent,"cwd":cwd,"pane_id":"w1:p1"}}));
    m.insert(
        "pane.process_info".to_string(),
        json!({"type":"pane_process_info","process_info":{
            "pane_id":"w1:p1","shell_pid":1,"foreground_process_group_id":fg_pid,
            "foreground_processes":[{"pid":fg_pid,"name":"claude"}]}}),
    );
    fake_herdr::spawn(&sock, m);
    sock
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

#[test]
fn project_dir_encoding() {
    let p = claude::project_dir(Path::new("/h"), "/Volumes/MiniSSD/dev/apps/zogssh");
    assert_eq!(p, Path::new("/h/.claude/projects/-Volumes-MiniSSD-dev-apps-zogssh"));
    let p = claude::project_dir(Path::new("/h"), "/home/sam/my.proj_x");
    assert_eq!(p, Path::new("/h/.claude/projects/-home-sam-my-proj-x"));
}

#[tokio::test]
async fn resolve_via_pid_file() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    write(
        &home.join(".claude/sessions/4242.json"),
        r#"{"pid":4242,"sessionId":"abc-123","cwd":"/home/sam/proj","status":"idle"}"#,
    );
    let sock = fake(dir.path(), "claude", "/home/sam/proj", 4242);
    let mut s = Session::start(sock, home.clone());
    let r = s.call("thread.resolve", json!({"pane_id":"w1:p1"})).await;
    let res = &r["result"];
    assert_eq!(res["kind"], "claude");
    assert_eq!(res["session"], "abc-123");
    assert_eq!(res["cwd"], "/home/sam/proj");
    let want = home.join(".claude/projects/-home-sam-proj/abc-123.jsonl");
    assert_eq!(res["log_path"], want.to_string_lossy().as_ref());
}

#[tokio::test]
async fn resolve_non_claude_agent() {
    let dir = tempfile::tempdir().unwrap();
    let sock = fake(dir.path(), "codex", "/home/sam/proj", 4242);
    let mut s = Session::start(sock, dir.path().into());
    let r = s.call("thread.resolve", json!({"pane_id":"w1:p1"})).await;
    assert_eq!(r["result"]["kind"], "codex");
    assert!(r["result"]["session"].is_null());
    assert!(r["result"]["log_path"].is_null());
}

#[tokio::test]
async fn resolve_fallback_newest_recent_file() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    let proj = home.join(".claude/projects/-home-sam-proj");
    write(&proj.join("old.jsonl"), "{}\n");
    std::thread::sleep(std::time::Duration::from_millis(30));
    write(&proj.join("new.jsonl"), "{}\n");
    // Pid 1 has no session file; the ps walk finds none either.
    let sock = fake(dir.path(), "claude", "/home/sam/proj", 999_999_999);
    let mut s = Session::start(sock, home);
    let r = s.call("thread.resolve", json!({"pane_id":"w1:p1"})).await;
    assert_eq!(r["result"]["session"], "new");
    assert!(r["result"]["log_path"].as_str().unwrap().ends_with("-home-sam-proj/new.jsonl"));
}

#[tokio::test]
async fn resolve_no_session_when_nothing_recent() {
    let dir = tempfile::tempdir().unwrap();
    let sock = fake(dir.path(), "claude", "/home/sam/proj", 999_999_999);
    let mut s = Session::start(sock, dir.path().join("home"));
    let r = s.call("thread.resolve", json!({"pane_id":"w1:p1"})).await;
    assert_eq!(r["result"]["kind"], "claude");
    assert!(r["result"]["session"].is_null());
}

#[test]
fn descendants_walk() {
    let table = claude::parse_ps("  1 0\n 10 1\n 11 10\n 12 11\n 20 1\n");
    assert_eq!(claude::descendants(&table, &[10]), vec![11, 12]);
}

#[tokio::test]
async fn recent_sessions_sorted_with_first_prompt() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().to_path_buf();
    let proj = home.join(".claude/projects/-home-sam-proj");
    let long = "x".repeat(300);
    write(
        &proj.join("a.jsonl"),
        &format!(
            "{}\n{}\n{}\n",
            r#"{"type":"user","uuid":"m","isMeta":true,"message":{"role":"user","content":"meta"}}"#,
            json!({"type":"user","uuid":"u1","cwd":"/home/sam/proj","message":{"role":"user","content":long}}),
            r#"{"type":"user","uuid":"u2","message":{"role":"user","content":"second"}}"#,
        ),
    );
    std::thread::sleep(std::time::Duration::from_millis(30));
    write(
        &proj.join("b.jsonl"),
        r#"{"type":"user","uuid":"u3","message":{"role":"user","content":"hello"}}
"#,
    );
    let mut s = Session::start(dir.path().join("none.sock"), home);
    let r = s.call("sessions.recent", json!({"cwd":"/home/sam/proj","limit":5})).await;
    let list = r["result"].as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["session"], "b");
    assert_eq!(list[0]["first_prompt"], "hello");
    assert_eq!(list[1]["session"], "a");
    assert_eq!(list[1]["first_prompt"].as_str().unwrap().len(), 120);
    assert!(list[0]["last_activity"].as_i64().unwrap() >= list[1]["last_activity"].as_i64().unwrap());
    let r = s.call("sessions.recent", json!({"cwd":"/home/sam/proj","limit":1})).await;
    assert_eq!(r["result"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn fs_dirs_lists_dirs_and_recent_cwds() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().to_path_buf();
    std::fs::create_dir_all(home.join("work/beta")).unwrap();
    std::fs::create_dir_all(home.join("work/Alpha")).unwrap();
    std::fs::create_dir_all(home.join("work/.hidden")).unwrap();
    std::fs::write(home.join("work/file.txt"), "x").unwrap();
    write(
        &home.join(".claude/projects/-p-one/s.jsonl"),
        "{\"type\":\"user\",\"cwd\":\"/home/sam/old\"}\n{\"type\":\"user\",\"cwd\":\"/home/sam/one\"}\n{\"type\":\"summary\"}\n",
    );
    std::thread::sleep(std::time::Duration::from_millis(30));
    write(&home.join(".claude/projects/-p-two/s.jsonl"), "{\"cwd\":\"/home/sam/two\"}\n");
    let mut s = Session::start(dir.path().join("none.sock"), home.clone());
    let r = s.call("fs.dirs", json!({"path": home.join("work").to_string_lossy()})).await;
    let res = &r["result"];
    assert_eq!(res["dirs"], json!(["Alpha", "beta"]));
    assert_eq!(res["recent_cwds"], json!(["/home/sam/two", "/home/sam/one"]));
    let r = s.call("fs.dirs", json!({})).await;
    assert!(r["result"]["dirs"].as_array().unwrap().contains(&json!("work")));
    let r = s.call("fs.dirs", json!({"path":"/no/such/dir"})).await;
    assert_eq!(r["error"]["code"], "not_found");
}

#[tokio::test]
async fn thread_subagent_reads_sibling_transcript() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("sess1.jsonl");
    write(&log, "");
    write(
        &dir.path().join("sess1/subagents/agent-a1b2.jsonl"),
        "{\"type\":\"user\",\"uuid\":\"s1\",\"message\":{\"role\":\"user\",\"content\":\"do it\"}}\n",
    );
    let mut s = Session::start(dir.path().join("none.sock"), dir.path().into());
    let r = s.call("thread.subagent", json!({"log_path": log, "agent_id":"a1b2","limit":10})).await;
    assert_eq!(r["result"]["items"][0]["text"], "do it");
    let r = s.call("thread.subagent", json!({"log_path": log, "agent_id":"../x","limit":10})).await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[tokio::test]
async fn resolve_via_child_of_pane_pid() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    write(&home.join(".claude/sessions/300.json"), r#"{"pid":300,"sessionId":"child-sess","cwd":"/home/sam/proj"}"#);
    // Pane shell is 100, foreground is 200, claude (300) is a child of 200.
    let sock = dir.path().join("herdr.sock");
    let mut m = HashMap::new();
    m.insert("agent.get".to_string(), json!({"agent":{"agent":"claude","cwd":"/home/sam/proj"}}));
    m.insert(
        "pane.process_info".to_string(),
        json!({"process_info":{"shell_pid":100,"foreground_process_group_id":200,
            "foreground_processes":[{"pid":200,"name":"node"}]}}),
    );
    fake_herdr::spawn(&sock, m);
    let r = claude::resolve_with(&sock, std::time::Duration::from_secs(5), &home, "w1:p1", || {
        Some(vec![(200, 100), (300, 200), (400, 1)])
    })
    .await
    .unwrap();
    assert_eq!(r.session.as_deref(), Some("child-sess"));
}
