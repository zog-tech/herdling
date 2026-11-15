//! `herdlingd rpc` with a fake herdr-core: the snapshot, routing, `unsupported`, `hello`,
//! `pane.answer`, `pane.watch` and the `herdr.subscribe` stream.

#[path = "support/fake_core.rs"]
mod fake_core;

use std::path::PathBuf;
use std::time::Duration;

use fake_core::{status_event, terminal, Ctl, FakeCore, State};
use herdlingd::core::endpoint::CoreSocket;
use herdlingd::rpc::{self, Ctx};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
}

impl Session {
    fn start(ctx: Ctx) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(65536);
        let (server_out, client_rx) = tokio::io::duplex(1 << 20);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
        Session { tx: client_tx, rx: BufReader::new(client_rx).lines() }
    }
    async fn recv(&mut self) -> Value {
        let line = tokio::time::timeout(Duration::from_secs(5), self.rx.next_line()).await.expect("timed out").unwrap().unwrap();
        serde_json::from_str(&line).unwrap()
    }
    async fn call(&mut self, id: u64, method: &str, params: Value) -> Value {
        let line = json!({"id": id, "method": method, "params": params}).to_string();
        self.tx.write_all(format!("{line}\n").as_bytes()).await.unwrap();
        loop {
            let v = self.recv().await;
            if v["id"] == id {
                return v;
            }
        }
    }
    async fn herdr(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.call(id, "herdr.call", json!({"method": method, "params": params})).await
    }
    /// The next event line of a stream.
    async fn event(&mut self) -> Value {
        loop {
            let v = self.recv().await;
            if v["method"] == "event" {
                return v["params"]["data"].clone();
            }
        }
    }
}

struct Setup {
    dir: tempfile::TempDir,
    core: Option<FakeCore>,
}

impl Setup {
    fn core_sock(&self) -> PathBuf {
        self.dir.path().join("core.sock")
    }
    fn ctx(&self) -> Ctx {
        let mut ctx = Ctx::new(self.dir.path().into());
        ctx.core_socket = Some(CoreSocket::fixed(self.core_sock()));
        ctx
    }
    fn core(&self) -> &FakeCore {
        self.core.as_ref().unwrap()
    }
}

/// A fake core with terminal t1 (an agent in `state`) and t2 (a shell), when `core` is true.
fn setup(core: bool, state: &str) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Setup { dir, core: None };
    if core {
        let st = State {
            terminals: vec![terminal("t1", Some("api-agent"), Some(state)), terminal("t2", None, None)],
            doc: Value::Null,
            screen: "Allow?\n❯ 1. Yes\n  2. No, and tell Claude what to do differently (esc)\n".into(),
            ..State::default()
        };
        s.core = Some(fake_core::spawn(&s.core_sock(), st));
    }
    s
}

fn pane_ids(snap: &Value, key: &str) -> Vec<String> {
    snap["result"]["snapshot"][key].as_array().unwrap().iter().map(|a| a["pane_id"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn snapshot_comes_from_the_core() {
    let s = setup(true, "working");
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr(1, "session.snapshot", json!({})).await;
    assert_eq!(pane_ids(&r, "agents"), ["t1"]);
    assert_eq!(pane_ids(&r, "panes"), ["t1", "t2"]);
    assert_eq!(r["result"]["snapshot"]["workspaces"][0]["workspace_id"], "g:src");

    let none = setup(false, "idle");
    let mut sess = Session::start(none.ctx());
    let r = sess.herdr(1, "session.snapshot", json!({})).await;
    assert_eq!(r["error"]["code"], "herdr_unavailable");
}

#[tokio::test]
async fn calls_on_core_panes_translate() {
    let s = setup(true, "blocked");
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr(1, "pane.read", json!({"pane_id": "t1", "source": "visible", "format": "text"})).await;
    assert!(r["result"]["read"]["text"].as_str().unwrap().contains("1. Yes"), "{r}");
    assert_eq!(s.core().calls_of("terminal.read")[0], json!({"terminal": "t1", "lines": 0}));

    let r = sess.herdr(2, "pane.send_input", json!({"pane_id": "t1", "text": "fix it", "keys": ["enter"]})).await;
    assert!(r["error"].is_null(), "{r}");
    assert_eq!(s.core().calls_of("terminal.send")[0], json!({"terminal": "t1", "text": "fix it", "force": true}));

    let r = sess.herdr(3, "pane.send_keys", json!({"pane_id": "t1", "keys": ["ctrl+c"]})).await;
    assert!(r["error"].is_null(), "{r}");
    assert_eq!(s.core().calls_of("terminal.keys")[0], json!({"terminal": "t1", "keys": ["ctrl+c"]}));

    let r = sess.herdr(4, "agent.prompt", json!({"target": "t1", "text": "go on"})).await;
    assert!(r["error"].is_null(), "{r}");

    let r = sess.herdr(5, "pane.get", json!({"pane_id": "t1"})).await;
    assert_eq!(r["result"]["pane"]["agent_status"], "blocked");
    let r = sess.herdr(6, "pane.process_info", json!({"pane_id": "t2"})).await;
    assert_eq!(r["result"]["process_info"]["shell_pid"], 100);

    let r = sess.herdr(7, "pane.close", json!({"pane_id": "t2"})).await;
    assert!(r["error"].is_null(), "{r}");
    assert_eq!(s.core().calls_of("terminal.kill")[0], json!({"terminal": "t2"}));

    // A closed terminal has the herdr 1 code.
    let r = sess.herdr(8, "pane.get", json!({"pane_id": "t9"})).await;
    assert_eq!(r["error"]["code"], "pane_not_found");
}

#[tokio::test]
async fn old_loose_ids_are_not_found() {
    // herdlingd 0.1.x had a "loose" workspace and a "loose:tab" tab. An old app can still send them.
    let s = setup(true, "idle");
    let mut sess = Session::start(s.ctx());
    for (i, id) in ["loose", "loose:tab"].into_iter().enumerate() {
        let r = sess.herdr(i as u64 + 1, "pane.read", json!({"pane_id": id, "source": "visible"})).await;
        let code = r["error"]["code"].as_str().unwrap_or_default();
        assert!(matches!(code, "unsupported" | "pane_not_found"), "{id}: {r}");
    }
}

#[tokio::test]
async fn methods_with_no_core_equivalent_are_unsupported() {
    let s = setup(true, "idle");
    let mut sess = Session::start(s.ctx());
    for (i, (m, p)) in [
        ("pane.rename", json!({"pane_id": "t1", "label": "x"})),
        ("workspace.rename", json!({"workspace_id": "space:s1", "label": "x"})),
        ("pane.send_text", json!({"pane_id": "t1", "text": "€"})),
    ]
    .into_iter()
    .enumerate()
    {
        let r = sess.herdr(i as u64 + 1, m, p).await;
        assert_eq!(r["error"]["code"], "unsupported", "{m}: {r}");
    }
    // A pane method on a workspace id names no pane.
    let r = sess.herdr(9, "agent.start", json!({"workspace_id": "g:src", "kind": "claude"})).await;
    assert_eq!(r["error"]["code"], "pane_not_found", "{r}");
    // Without a core socket: herdr_unavailable, as old apps know it.
    let mut no_core = Session::start(Ctx::new(s.dir.path().into()));
    let r = no_core.herdr(1, "pane.read", json!({"pane_id": "t1"})).await;
    assert_eq!(r["error"]["code"], "herdr_unavailable");
    assert!(s.core().calls_of("terminal.read").is_empty());
}

#[tokio::test]
async fn hello_lists_backends() {
    let s = setup(true, "idle");
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "hello", json!({})).await;
    assert_eq!(r["result"]["herdr_ok"], true);
    assert!(r["result"]["backends"].get("herdr").is_none());
    assert_eq!(r["result"]["backends"]["core"], json!({"version": "0.1.19", "generation": 1}));

    let none = setup(false, "idle");
    let mut sess = Session::start(none.ctx());
    let r = sess.call(1, "hello", json!({})).await;
    assert_eq!(r["result"]["herdr_ok"], false);
    assert!(r["result"].get("backends").is_none());
}

#[tokio::test]
async fn pane_answer_on_a_core_pane() {
    let s = setup(true, "blocked");
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "pane.answer", json!({"pane_id": "t1", "key": "2", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale", "label mismatch");
    let r = sess.call(2, "pane.answer", json!({"pane_id": "t1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["result"], json!({"answered": true}), "{r}");
    assert_eq!(s.core().calls_of("terminal.keys"), vec![json!({"terminal": "t1", "keys": ["1"]})]);
    let r = sess.call(3, "pane.answer", json!({"pane_id": "t9", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale");

    let idle = setup(true, "working");
    let mut sess = Session::start(idle.ctx());
    let r = sess.call(1, "pane.answer", json!({"pane_id": "t1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale");
    assert!(idle.core().calls_of("terminal.keys").is_empty());
}

#[tokio::test]
async fn thread_resolve_and_previews_for_core_agents() {
    let s = setup(true, "working");
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "thread.resolve", json!({"pane_id": "t1"})).await;
    assert_eq!(r["result"]["session"], Value::Null);
    assert_eq!(r["result"]["kind"], "claude");
    let r = sess.call(2, "agents.preview", json!({})).await;
    let p = &r["result"]["previews"][0];
    assert_eq!(p["pane_id"], "t1");
    assert_eq!(p["activity"], "Running tests");
    assert_eq!(p["status_since"], 1_700_000_000);
}

#[tokio::test]
async fn core_thread_resolves_claude_session() {
    let s = setup(true, "working");
    // The fake terminal t1 has foreground pid 101 in /home/sam/proj/src. HOME is the temp folder.
    let home = s.dir.path();
    std::fs::create_dir_all(home.join(".claude/sessions")).unwrap();
    std::fs::write(home.join(".claude/sessions/101.json"), r#"{"sessionId": "abc", "cwd": "/home/sam/proj/src"}"#).unwrap();
    let proj = herdlingd::claude::project_dir(home, "/home/sam/proj/src");
    std::fs::create_dir_all(&proj).unwrap();
    std::fs::write(proj.join("abc.jsonl"), "").unwrap();
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "thread.resolve", json!({"pane_id": "t1"})).await;
    assert_eq!(r["result"]["session"], "abc", "{r}");
    assert_eq!(r["result"]["kind"], "claude");
    assert_eq!(r["result"]["cwd"], "/home/sam/proj/src");
    assert!(r["result"]["log_path"].as_str().unwrap().ends_with("abc.jsonl"), "{r}");
}

#[tokio::test]
async fn core_preview_reads_the_transcript() {
    let s = setup(true, "idle");
    let home = s.dir.path();
    std::fs::create_dir_all(home.join(".claude/sessions")).unwrap();
    std::fs::write(home.join(".claude/sessions/101.json"), r#"{"sessionId": "abc", "cwd": "/home/sam/proj/src"}"#).unwrap();
    let proj = herdlingd::claude::project_dir(home, "/home/sam/proj/src");
    std::fs::create_dir_all(&proj).unwrap();
    let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"All tests pass now."}]}}"#;
    std::fs::write(proj.join("abc.jsonl"), format!("{line}\n")).unwrap();
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "agents.preview", json!({})).await;
    let p = &r["result"]["previews"][0];
    assert_eq!(p["pane_id"], "t1", "{r}");
    assert_eq!(p["last_reply"], "All tests pass now.", "{r}");
    assert_eq!(p["source"], "log", "{r}");
}

#[tokio::test]
async fn core_preview_of_a_working_agent_keeps_the_log_reply() {
    let s = setup(true, "working");
    let home = s.dir.path();
    std::fs::create_dir_all(home.join(".claude/sessions")).unwrap();
    std::fs::write(home.join(".claude/sessions/101.json"), r#"{"sessionId": "abc", "cwd": "/home/sam/proj/src"}"#).unwrap();
    let proj = herdlingd::claude::project_dir(home, "/home/sam/proj/src");
    std::fs::create_dir_all(&proj).unwrap();
    let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"All tests pass now."}]}}"#;
    std::fs::write(proj.join("abc.jsonl"), format!("{line}\n")).unwrap();
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "agents.preview", json!({})).await;
    let p = &r["result"]["previews"][0];
    assert_eq!(p["last_reply"], "All tests pass now.", "{r}");
    assert_eq!(p["source"], "log", "{r}");
    assert_eq!(p["activity"], "Running tests", "{r}");
}

#[tokio::test]
async fn core_thread_resolve_of_a_missing_terminal_is_pane_not_found() {
    let s = setup(true, "working");
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "thread.resolve", json!({"pane_id": "t9"})).await;
    assert_eq!(r["error"]["code"], "pane_not_found", "{r}");
}

#[tokio::test]
async fn pane_watch_reads_a_core_pane() {
    let s = setup(true, "idle");
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "pane.watch", json!({"pane_id": "t1", "lines": 50, "interval_ms": 50})).await;
    assert!(r["result"]["stream"].is_string(), "{r}");
    let first = sess.event().await;
    assert!(first["text"].as_str().unwrap().contains("Allow?"));
    assert_eq!(s.core().calls_of("terminal.read")[0], json!({"terminal": "t1", "lines": 50}));
    s.core().state.lock().unwrap().screen = "done".into();
    let next = sess.event().await;
    assert_eq!(next["text"], "done");
}

#[tokio::test]
async fn subscribe_with_core_only_streams_core_events() {
    let s = setup(true, "working");
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "herdr.subscribe", json!({})).await;
    assert!(r["result"]["stream"].is_string(), "{r}");
    s.core().wait_subscribes(1).await;
    s.core().send(Ctl::Event(status_event("t1", "done")));
    let ev = sess.event().await;
    assert_eq!(ev["event"], "pane.agent_status_changed");
    assert_eq!(ev["data"]["pane_id"], "t1");
    assert_eq!(ev["data"]["agent_status"], "done");
    s.core().send(Ctl::Missed(json!({"seq": 5, "terminals": []})));
    assert_eq!(sess.event().await["event"], "layout.updated");
    // The last backend ends: the stream closes as before.
    s.core().send(Ctl::Drop);
    assert_eq!(sess.event().await, json!({"closed": true}));
}

/// Runs `git` in `dir`. False when git is not installed or the command fails.
fn git_ok(dir: &std::path::Path, args: &[&str]) -> bool {
    std::process::Command::new("git").arg("-C").arg(dir).args(args).status().map(|s| s.success()).unwrap_or(false)
}

#[tokio::test]
async fn snapshot_has_repo_of_agent_folder() {
    let repo = tempfile::tempdir().unwrap();
    let root = repo.path().canonicalize().unwrap();
    let committed = git_ok(&root, &["init", "-b", "main"])
        && git_ok(&root, &["-c", "user.name=sam", "-c", "user.email=sam@example.com", "commit", "--allow-empty", "-m", "x"]);
    if !committed {
        eprintln!("skipped: git is not available");
        return;
    }
    std::fs::create_dir(root.join("src")).unwrap();

    let dir = tempfile::tempdir().unwrap();
    let mut s = Setup { dir, core: None };
    let mut t = terminal("t1", Some("api-agent"), Some("working"));
    t["foreground"]["cwd"] = json!(root.join("src").to_string_lossy());
    let st = State { terminals: vec![t], doc: Value::Null, ..State::default() };
    s.core = Some(fake_core::spawn(&s.core_sock(), st));
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr(1, "session.snapshot", json!({})).await;
    let agent = &r["result"]["snapshot"]["agents"][0];
    let name = root.file_name().unwrap().to_string_lossy().to_string();
    assert_eq!(agent["repo"], json!(name), "{r}");
    assert_eq!(agent["repo_root"], json!(root.to_string_lossy()), "{r}");
    assert_eq!(agent["branch"], "main", "{r}");
    assert_eq!(agent["group_source"], "repo", "{r}");
}
