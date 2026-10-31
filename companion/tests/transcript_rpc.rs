//! The transcript layer through rpc and herdr: resolve, hello, sessions.recent, follow, previews.

#[path = "support/fake_herdr.rs"]
mod fake_herdr;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use herdlingd::rpc::{self, Ctx};
use herdlingd::transcript::{self, codex, pi, procs, Proc};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const CWD: &str = "/home/sam/project";

struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
}

impl Session {
    fn start(sock: PathBuf, home: PathBuf) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(1 << 16);
        let (server_out, client_rx) = tokio::io::duplex(1 << 16);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, Ctx::new(sock, home)));
        Session { tx: client_tx, rx: BufReader::new(client_rx).lines() }
    }
    async fn send(&mut self, method: &str, params: Value) {
        let req = json!({"id": 1, "method": method, "params": params});
        self.tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    }
    async fn line(&mut self) -> Value {
        let l = tokio::time::timeout(Duration::from_secs(5), self.rx.next_line()).await.unwrap().unwrap().unwrap();
        serde_json::from_str(&l).unwrap()
    }
    async fn call(&mut self, method: &str, params: Value) -> Value {
        self.send(method, params).await;
        self.line().await
    }
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn codex_log(home: &Path, id: &str) -> PathBuf {
    let path = codex::sessions_root(home).join("2026/10/01").join(format!("rollout-{id}.jsonl"));
    let lines = [
        json!({"timestamp":"2026-10-01T10:00:00.000Z","type":"session_meta","payload":{"id":id,"cwd":CWD,"source":"cli"}}),
        json!({"timestamp":"2026-10-01T10:00:01.000Z","type":"response_item","payload":{"type":"message","id":"m1","role":"user",
            "content":[{"type":"input_text","text":"Run the build"}],"internal_chat_message_metadata_passthrough":{"content_item_kinds":["user.text"]}}}),
        json!({"timestamp":"2026-10-01T10:00:02.000Z","type":"response_item","payload":{"type":"message","id":"a1","role":"assistant",
            "content":[{"type":"output_text","text":"Starting the **build** now."}]}}),
        json!({"timestamp":"2026-10-01T10:00:03.000Z","type":"response_item","payload":{"type":"function_call","name":"exec_command",
            "arguments":"{\"cmd\":\"cargo build --release\"}","call_id":"c1"}}),
    ];
    write(&path, &lines.iter().map(|l| l.to_string() + "\n").collect::<String>());
    path
}

fn fake_codex_herdr(dir: &Path) -> PathBuf {
    let sock = dir.join("herdr.sock");
    let mut m = HashMap::new();
    m.insert("agent.get".to_string(), json!({"agent":{"agent":"codex","cwd":CWD,"pane_id":"w1:p1"}}));
    m.insert(
        "pane.process_info".to_string(),
        json!({"process_info":{"shell_pid":100,"foreground_process_group_id":200,"foreground_processes":[{"pid":200,"name":"node"}]}}),
    );
    fake_herdr::spawn(&sock, m);
    sock
}

fn proc(pid: u32, ppid: u32, name: &str, cmd: &[&str], age: u64) -> Proc {
    Proc { pid, ppid, name: name.into(), cmd: cmd.iter().map(|s| s.to_string()).collect(), start: SystemTime::now() - Duration::from_secs(age) }
}

#[test]
fn agent_start_finds_the_agent_by_name_or_script() {
    let list = vec![
        proc(100, 1, "zsh", &["-zsh"], 900),
        proc(200, 100, "node", &["node", "/usr/local/bin/pi"], 300),
        proc(300, 200, "rg", &["rg", "x"], 1),
    ];
    let t = procs::agent_start(&list, &[200], Some(100), &["pi"]).unwrap();
    assert_eq!(t, list[1].start);
    // A child process of the shell is found too.
    let t = procs::agent_start(&list, &[], Some(100), &["pi"]).unwrap();
    assert_eq!(t, list[1].start);
    // No match: the first foreground process counts.
    let t = procs::agent_start(&list, &[300], Some(100), &["codex"]).unwrap();
    assert_eq!(t, list[2].start);
    assert!(procs::agent_start(&list, &[], Some(100), &["codex"]).is_none());
}

#[tokio::test]
async fn resolve_finds_the_codex_session_of_the_pane() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    let log = codex_log(&home, "s-77");
    let sock = fake_codex_herdr(dir.path());
    fn list() -> Vec<Proc> {
        vec![
            Proc { pid: 100, ppid: 1, name: "zsh".into(), cmd: vec![], start: SystemTime::now() - Duration::from_secs(900) },
            Proc { pid: 300, ppid: 200, name: "codex".into(), cmd: vec!["codex".into()], start: SystemTime::now() - Duration::from_secs(120) },
        ]
    }
    let r = transcript::resolve_with(&sock, Duration::from_secs(5), &home, "w1:p1", list).await.unwrap();
    assert_eq!(r.kind, "codex");
    assert_eq!(r.session.as_deref(), Some("s-77"));
    assert_eq!(r.log_path.as_deref(), Some(log.to_string_lossy().as_ref()));
    // The agent started after the last write: the pane has no session yet.
    fn fresh() -> Vec<Proc> {
        vec![Proc { pid: 200, ppid: 100, name: "codex".into(), cmd: vec![], start: SystemTime::now() + Duration::from_secs(60) }]
    }
    let r = transcript::resolve_with(&sock, Duration::from_secs(5), &home, "w1:p1", fresh).await.unwrap();
    assert_eq!(r.session, None);
}

#[tokio::test]
async fn rpc_hello_lists_thread_kinds_and_sessions_recent_takes_a_kind() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    codex_log(&home, "s-1");
    let mut s = Session::start(dir.path().join("none.sock"), home.clone());
    let r = s.call("hello", json!({})).await;
    assert_eq!(r["result"]["thread_kinds"], json!(["claude", "codex", "pi", "opencode", "omp", "gemini"]));
    assert_eq!(r["result"]["command_kinds"], json!(["claude", "codex", "pi", "opencode"]));
    let r = s.call("sessions.recent", json!({"cwd": CWD, "kind": "codex"})).await;
    assert_eq!(r["result"][0]["session"], "s-1");
    assert_eq!(r["result"][0]["first_prompt"], "Run the build");
    // No kind: Claude, as older apps expect.
    let r = s.call("sessions.recent", json!({"cwd": CWD})).await;
    assert_eq!(r["result"], json!([]));
    let r = s.call("fs.dirs", json!({"path": home.to_string_lossy()})).await;
    assert_eq!(r["result"]["recent_cwds"], json!([CWD]));
    let r = s.call("thread.get", json!({"log_path": codex_log(&home, "s-1"), "limit": 10})).await;
    assert_eq!(r["result"]["items"][0]["text"], "Run the build");
}

#[tokio::test]
async fn rpc_follow_on_pi_ends_when_the_branch_changes() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    let log = pi::project_dir(&home, CWD).join("2026-10-01T10-00-00-000Z_s.jsonl");
    let head = [
        json!({"type":"session","version":3,"id":"s","timestamp":"2026-10-01T10:00:00.000Z","cwd":CWD}),
        json!({"type":"message","id":"u1","parentId":null,"timestamp":"2026-10-01T10:00:01.000Z","message":{"role":"user","content":"hi"}}),
    ];
    let mut text: String = head.iter().map(|l| l.to_string() + "\n").collect();
    write(&log, &text);
    let mut s = Session::start(dir.path().join("none.sock"), home.clone());
    let r = s.call("thread.follow", json!({"log_path": log, "from": text.len()})).await;
    let stream = r["result"]["stream"].as_str().unwrap().to_string();
    text += &(json!({"type":"message","id":"a1","parentId":"u1","timestamp":"2026-10-01T10:00:02.000Z",
        "message":{"role":"assistant","content":[{"type":"text","text":"hello"}],"stopReason":"stop"}}).to_string() + "\n");
    std::fs::write(&log, &text).unwrap();
    let ev = s.line().await;
    assert_eq!(ev["params"]["stream"], stream.as_str());
    assert_eq!(ev["params"]["data"]["items"][0]["markdown"], "hello");
    text += &(json!({"type":"message","id":"u2","parentId":"u1","timestamp":"2026-10-01T10:00:03.000Z",
        "message":{"role":"user","content":"again"}}).to_string() + "\n");
    std::fs::write(&log, &text).unwrap();
    let ev = s.line().await;
    assert_eq!(ev["params"]["data"]["error"], "branch_changed");
}

#[tokio::test]
async fn rpc_follow_missing_log_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(dir.path().join("none.sock"), dir.path().into());
    let missing = codex::sessions_root(dir.path()).join("2026/10/01/rollout-x.jsonl");
    let r = s.call("thread.follow", json!({"log_path": missing, "from": 0})).await;
    assert_eq!(r["error"]["code"], "not_found");
}

#[tokio::test]
async fn rpc_preview_of_a_codex_pane_reads_its_log() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    codex_log(&home, "s-9");
    let sock = dir.path().join("herdr.sock");
    fake_herdr::spawn_fn(&sock, |method, _params| match method {
        "session.snapshot" => Some(json!({"snapshot": {"agents": [{"pane_id": "w1:p1", "agent": "codex", "agent_status": "working", "cwd": CWD}]}})),
        "agent.get" => Some(json!({"agent": {"agent": "codex", "cwd": CWD, "pane_id": "w1:p1"}})),
        "pane.process_info" => Some(json!({"process_info": {"pane_id": "w1:p1"}})),
        _ => None,
    });
    let mut s = Session::start(sock, home);
    let r = s.call("agents.preview", json!({})).await;
    let p = &r["result"]["previews"][0];
    assert_eq!(p["source"], "log", "{r}");
    assert_eq!(p["activity"], "Running cargo build --release");
    assert_eq!(p["last_reply"], "Starting the build now.");
}
