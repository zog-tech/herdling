//! The call sequences of the app builds 1.0.0 and 1.0.1 (`app/src` on `main`) against
//! herdlingd 0.2.0, which talks only to Herdr 2. One test per row of the spec table, with the
//! exact params those builds send. A fake core answers; no test reaches a real core.

#[path = "support/fake_core.rs"]
mod fake_core;
use std::time::Duration;

use fake_core::{status_event, terminal, Ctl, FakeCore, State};
use herdlingd::core::endpoint::CoreSocket;
use herdlingd::rpc::{self, Ctx};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
    next: u64,
}

impl Session {
    fn start(ctx: Ctx) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(65536);
        let (server_out, client_rx) = tokio::io::duplex(1 << 20);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
        Session { tx: client_tx, rx: BufReader::new(client_rx).lines(), next: 1 }
    }
    async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.next;
        self.next += 1;
        let line = json!({"id": id, "method": method, "params": params}).to_string();
        self.tx.write_all(format!("{line}\n").as_bytes()).await.unwrap();
        loop {
            let line = tokio::time::timeout(Duration::from_secs(10), self.rx.next_line()).await.expect("timed out").unwrap().unwrap();
            let v: Value = serde_json::from_str(&line).unwrap();
            if v["id"] == id {
                return v;
            }
        }
    }
    /// `herdr.call` as the old app sends it; panics on an error.
    async fn ok(&mut self, method: &str, params: Value) -> Value {
        let r = self.herdr(method, params).await;
        assert!(r.get("error").is_none(), "{method}: {r}");
        r["result"].clone()
    }
    async fn herdr(&mut self, method: &str, params: Value) -> Value {
        self.call("herdr.call", json!({"method": method, "params": params})).await
    }
    async fn event(&mut self) -> Value {
        loop {
            let line = tokio::time::timeout(Duration::from_secs(10), self.rx.next_line()).await.expect("timed out").unwrap().unwrap();
            let v: Value = serde_json::from_str(&line).unwrap();
            if v["method"] == "event" {
                return v["params"]["data"].clone();
            }
        }
    }
}

struct Setup {
    dir: tempfile::TempDir,
    core: FakeCore,
}

impl Setup {
    fn ctx(&self) -> Ctx {
        let mut ctx = Ctx::new(self.dir.path().into());
        ctx.core_socket = Some(CoreSocket::fixed(self.dir.path().join("core.sock")));
        ctx
    }
    fn labels(&self, addr: &str) -> Value {
        let st = self.core.state.lock().unwrap();
        st.terminals.iter().find(|t| t["address"] == addr).map(|t| t["labels"].clone()).unwrap_or(Value::Null)
    }
    fn kills(&self) -> Vec<Value> {
        self.core.calls_of("terminal.kill")
    }
}

/// Space s1 ("api") with tab a (t1 an agent, t2 a shell); t3 an agent in the label group "Clips".
fn setup() -> Setup {
    setup_with(|_| {})
}

fn setup_with(f: impl FnOnce(&mut State)) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let mut t3 = terminal("t3", None, Some("idle"));
    t3["labels"] = json!({"herdling.group": "Clips"});
    let mut st = State {
        terminals: vec![terminal("t1", None, Some("working")), terminal("t2", None, None), t3],
        doc: json!({"spaces": [{"id": "s1", "name": "api", "tabs": [
            {"id": "a", "name": "main", "root": {"type": "row", "children": [
                {"type": "block", "content": {"terminal": "t1"}}, {"type": "block", "content": {"terminal": "t2"}}]}}]}]}),
        screen: "line 1\n\nAllow edit?\n".into(),
        send_starts_agent: true,
        ..State::default()
    };
    f(&mut st);
    let core = fake_core::spawn(&dir.path().join("core.sock"), st);
    Setup { dir, core }
}

/// Every id in a snapshot entry list.
fn ids(list: &Value, key: &str) -> Vec<String> {
    list.as_array().unwrap().iter().map(|e| e[key].as_str().unwrap().to_string()).collect()
}

/// The old app reads `herdr_ok` and `herdr_version`, and shows "herdr is not running" when
/// `herdr_ok` is false.
#[tokio::test]
async fn hello_reports_the_core_as_herdr() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let h = sess.call("hello", json!({})).await["result"].clone();
    assert_eq!(h["herdr_ok"], true, "{h}");
    assert!(h["herdr_version"].is_string(), "{h}");
    assert!(h["backends"]["core"].is_object());
    assert!(h["backends"].get("herdr").is_none());
    let methods: Vec<&str> = h["methods"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    for m in ["herdr.call", "herdr.subscribe", "pane.watch", "pane.answer", "shell.watch", "thread.resolve", "git.worktree_add", "herdr.update"] {
        assert!(methods.contains(&m), "{m} missing");
    }
    // No core: the old app's "herdr is not running".
    let mut none = Session::start(Ctx::new(s.dir.path().into()));
    let h = none.call("hello", json!({})).await["result"].clone();
    assert_eq!(h["herdr_ok"], false, "{h}");
}

#[tokio::test]
async fn snapshot_and_reads_have_herdr_one_shapes() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let snap = sess.ok("session.snapshot", json!({})).await["snapshot"].clone();
    assert_eq!(ids(&snap["workspaces"], "workspace_id"), ["space:s1", "g:clips"]);
    assert_eq!(ids(&snap["tabs"], "tab_id"), ["tab:a", "task:t3"]);
    assert_eq!(ids(&snap["panes"], "pane_id"), ["t1", "t2", "t3"]);
    assert_eq!(ids(&snap["agents"], "pane_id"), ["t1", "t3"]);
    for list in ["workspaces", "tabs", "panes", "agents"] {
        assert!(snap[list].as_array().unwrap().iter().all(|e| e.get("backend").is_none()), "{list} has a backend field");
    }
    let a = &snap["agents"][0];
    assert_eq!((a["agent"].as_str(), a["agent_status"].as_str()), (Some("claude"), Some("working")));
    let list = sess.ok("workspace.list", json!({})).await;
    assert_eq!(ids(&list["workspaces"], "workspace_id"), ["space:s1", "g:clips"]);
    let w = sess.ok("workspace.get", json!({"workspace_id": "space:s1"})).await;
    assert_eq!(w["workspace"]["label"], "api");
    let p = sess.ok("pane.get", json!({"pane_id": "t1"})).await;
    assert_eq!(p["pane"]["pane_id"], "t1", "{p}");
    let info = sess.ok("pane.process_info", json!({"pane_id": "t2"})).await;
    assert!(info["process_info"].is_object(), "{info}");
}

#[tokio::test]
async fn typing_and_reading() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.ok("pane.read", json!({"pane_id": "t1", "source": "recent", "lines": 200})).await;
    assert!(r.to_string().contains("Allow edit?"), "{r}");
    sess.ok("pane.send_input", json!({"pane_id": "t2", "text": "ls", "keys": ["enter"]})).await;
    sess.ok("pane.send_text", json!({"pane_id": "t2", "text": "pwd"})).await;
    sess.ok("pane.send_keys", json!({"pane_id": "t2", "keys": ["ctrl+c"]})).await;
    sess.ok("agent.prompt", json!({"target": "t1", "text": "fix it"})).await;
    let sends: Vec<Value> = s.core.calls_of("terminal.send").iter().map(|c| c["text"].clone()).collect();
    assert_eq!(sends, [json!("ls"), json!("fix it")]);
    // Text without Enter goes as keys, one per character.
    let keys: Vec<Value> = s.core.calls_of("terminal.keys").iter().map(|c| c["keys"].clone()).collect();
    assert_eq!(keys, [json!(["p", "w", "d"]), json!(["ctrl+c"])]);
    // pane.answer on a pane with no menu: stale, no key.
    let keys = s.core.calls_of("terminal.keys").len();
    let r = sess.call("pane.answer", json!({"pane_id": "t1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
    assert_eq!(s.core.calls_of("terminal.keys").len(), keys);
}

#[tokio::test]
async fn pane_watch_streams_the_screen() {
    let s = setup_with(|st| {
        st.attach = true;
        st.paint = b"\x1b[H\x1b[2J$ ready".to_vec();
    });
    let mut sess = Session::start(s.ctx());
    // The old app sends no cols or rows: a passive watch.
    let w = sess.call("pane.watch", json!({"pane_id": "t2", "lines": 50, "format": "ansi"})).await;
    assert!(w["result"]["stream"].is_string(), "{w}");
    assert!(sess.event().await["text"].as_str().unwrap().contains("$ ready"));
    let attach = &s.core.calls_of("terminal.attach")[0];
    assert_eq!((attach["terminal"].clone(), attach["observe"].clone()), (json!("t2"), json!(true)));
}

#[tokio::test]
async fn subscribe_has_herdr_one_lines() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("herdr.subscribe", json!({})).await;
    assert!(r["result"]["stream"].is_string(), "{r}");
    s.core.wait_subscribes(1).await;
    s.core.send(Ctl::Event(status_event("t1", "done")));
    let e = sess.event().await;
    assert_eq!(e["event"], "pane.agent_status_changed");
    assert_eq!(e["data"]["pane_id"], "t1");
    assert!(e["data"].get("backend").is_none(), "{e}");
}

/// `startSession` with no workspace: `workspace.create`, `agent.start`, `agent.prompt`.
#[tokio::test]
async fn new_session_in_a_new_workspace() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let c = sess.ok("workspace.create", json!({"cwd": "/home/sam/web", "label": "web", "focus": false})).await;
    let pane = c["root_pane"]["pane_id"].as_str().unwrap().to_string();
    assert_eq!(pane, "t4");
    assert!(c["workspace"]["workspace_id"].as_str().unwrap().starts_with("space:"), "{c}");
    sess.ok("agent.start", json!({"name": "web-t4", "kind": "claude", "pane_id": pane})).await;
    sess.ok("agent.prompt", json!({"target": pane, "text": "add a test"})).await;
    let sends: Vec<Value> = s.core.calls_of("terminal.send").iter().map(|c| c["text"].clone()).collect();
    assert_eq!(sends, [json!("claude"), json!("add a test")]);
    assert_eq!(s.core.calls_of("terminal.run")[0]["cwd"], "/home/sam/web");
}

/// `startSession` in an existing workspace: `tab.create` in a space and in a label group.
#[tokio::test]
async fn new_session_in_an_existing_workspace() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let c = sess.ok("tab.create", json!({"workspace_id": "space:s1", "cwd": "/home/sam/proj", "focus": false})).await;
    assert_eq!(c["workspace"]["workspace_id"], "space:s1");
    let pane = c["root_pane"]["pane_id"].as_str().unwrap().to_string();
    sess.ok("agent.start", json!({"name": "proj-t4", "kind": "codex", "pane_id": pane, "args": ["--full-auto"]})).await;
    assert_eq!(s.core.calls_of("terminal.send")[0]["text"], "codex --full-auto");
    let c = sess.ok("tab.create", json!({"workspace_id": "g:clips", "cwd": "/home/sam/proj", "focus": false})).await;
    assert_eq!(c["workspace"]["workspace_id"], "g:clips", "{c}");
    assert_eq!(s.core.calls_of("terminal.run")[1]["labels"]["herdling.group"], "Clips");
}

/// A failed `agent.start` undoes the new tab or workspace with `tab.close` / `workspace.close`.
#[tokio::test]
async fn failed_start_undo_closes_the_tab() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let c = sess.ok("tab.create", json!({"workspace_id": "space:s1", "cwd": "/home/sam/proj", "focus": false})).await;
    let r = sess.herdr("agent.start", json!({"name": "x", "kind": "nope", "pane_id": c["root_pane"]["pane_id"]})).await;
    assert!(r.get("error").is_some());
    sess.ok("tab.close", json!({"tab_id": c["tab"]["tab_id"]})).await;
    assert_eq!(s.kills(), [json!({"terminal": "t4"})]);
    let c = sess.ok("workspace.create", json!({"cwd": "/home/sam/web", "label": "web", "focus": false})).await;
    sess.ok("workspace.close", json!({"workspace_id": c["workspace"]["workspace_id"]})).await;
    assert_eq!(s.kills()[1], json!({"terminal": "t5"}));
}

#[tokio::test]
async fn renames() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    sess.ok("agent.rename", json!({"target": "t1", "name": "fix-login"})).await;
    assert_eq!(s.labels("t1")["herdling.name"], "fix-login");
    sess.ok("agent.rename", json!({"target": "t1", "name": null})).await;
    assert!(s.labels("t1").get("herdling.name").is_none());
    sess.ok("tab.rename", json!({"tab_id": "task:t3", "label": "Clip work"})).await;
    assert_eq!(s.labels("t3")["herdling.name"], "Clip work");
    for (m, p) in [("tab.rename", json!({"tab_id": "tab:a", "label": "x"})), ("workspace.rename", json!({"workspace_id": "space:s1", "label": "x"}))] {
        let r = sess.herdr(m, p).await;
        assert_eq!(r["error"]["code"], "unsupported", "{m}: {r}");
        assert!(r["error"]["message"].as_str().unwrap().contains("Herdr app"), "{r}");
    }
}

#[tokio::test]
async fn closes() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    sess.ok("pane.close", json!({"pane_id": "t2"})).await;
    sess.ok("tab.close", json!({"tab_id": "task:t3"})).await;
    sess.ok("workspace.close", json!({"workspace_id": "space:s1", "close_group": true})).await;
    assert_eq!(s.kills(), [json!({"terminal": "t2"}), json!({"terminal": "t3"}), json!({"terminal": "t1"})]);
}

/// `restartAgent` with a new conversation: start in the same workspace, then close the old pane.
#[tokio::test]
async fn restart_new_conversation() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let c = sess.ok("tab.create", json!({"workspace_id": "space:s1", "cwd": "/home/sam/proj/src", "focus": false})).await;
    let pane = c["root_pane"]["pane_id"].as_str().unwrap().to_string();
    sess.ok("agent.start", json!({"name": "src-t4", "kind": "claude", "pane_id": pane})).await;
    sess.ok("pane.close", json!({"pane_id": "t1"})).await;
    assert_eq!(s.kills(), [json!({"terminal": "t1"})]);
    let snap = sess.ok("session.snapshot", json!({})).await["snapshot"].clone();
    let agent = snap["agents"].as_array().unwrap().iter().find(|a| a["pane_id"] == pane.as_str()).cloned().unwrap();
    assert_eq!(agent["workspace_id"], "space:s1");
}

/// `restartAgent` that keeps the conversation: close first, `workspace.get`, then start with
/// the resume arguments.
#[tokio::test]
async fn restart_keep_conversation() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    sess.ok("pane.close", json!({"pane_id": "t1"})).await;
    sess.ok("workspace.get", json!({"workspace_id": "space:s1"})).await;
    let c = sess.ok("tab.create", json!({"workspace_id": "space:s1", "cwd": "/home/sam/proj/src", "focus": false})).await;
    let pane = c["root_pane"]["pane_id"].as_str().unwrap().to_string();
    sess.ok("agent.start", json!({"name": "src-t4", "kind": "claude", "pane_id": pane, "args": ["--resume", "abc"]})).await;
    assert_eq!(s.core.calls_of("terminal.send")[0]["text"], "claude --resume abc");
}

/// The restarted agent was the last one of its group: `workspace.get` fails, and the app
/// makes a new workspace.
#[tokio::test]
async fn restart_keep_conversation_of_the_last_pane() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    sess.ok("pane.close", json!({"pane_id": "t3"})).await;
    let r = sess.herdr("workspace.get", json!({"workspace_id": "g:clips"})).await;
    assert_eq!(r["error"]["code"], "workspace_not_found", "{r}");
    let c = sess.ok("workspace.create", json!({"cwd": "/home/sam/proj", "label": "proj", "focus": false})).await;
    let pane = c["root_pane"]["pane_id"].as_str().unwrap().to_string();
    sess.ok("agent.start", json!({"name": "proj-t4", "kind": "claude", "pane_id": pane, "args": ["--resume", "abc"]})).await;
    assert_eq!(s.core.calls_of("terminal.send")[0]["text"], "claude --resume abc");
}

/// `resumeInFolder` in the workspace of the folder: `workspace.get`, `tab.create`, `agent.start`.
#[tokio::test]
async fn resume_in_the_same_workspace() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    sess.ok("workspace.get", json!({"workspace_id": "g:clips"})).await;
    let c = sess.ok("tab.create", json!({"workspace_id": "g:clips", "cwd": "/home/sam/proj", "focus": false})).await;
    let pane = c["root_pane"]["pane_id"].as_str().unwrap().to_string();
    sess.ok("agent.start", json!({"name": "proj-t4", "kind": "pi", "pane_id": pane, "args": ["--session", "s-1"]})).await;
    assert_eq!(s.core.calls_of("terminal.send")[0]["text"], "pi --session s-1");
    assert!(s.kills().is_empty());
}

#[tokio::test]
async fn shell_watch_round_trip() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("shell.watch", json!({"pane_id": "t2"})).await;
    assert_eq!(r["result"]["pane_id"], "t2", "{r}");
    let r = sess.call("shell.watches", json!({})).await;
    assert_eq!(r["result"]["watches"][0]["pane_id"], "t2");
    let r = sess.call("shell.unwatch", json!({"pane_id": "t2"})).await;
    assert_eq!(r["result"]["removed"], true);
}

#[tokio::test]
async fn explain() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.ok("agent.explain", json!({"target": "t1"})).await;
    assert_eq!(r["type"], "agent_explain");
    assert_eq!(r["explain"]["state"], "working");
}

#[tokio::test]
async fn herdr_update() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("herdr.update", json!({})).await;
    assert_eq!(r["error"]["code"], "update_unavailable", "{r}");
}

fn git_ok(dir: &std::path::Path, args: &[&str]) -> bool {
    std::process::Command::new("git").arg("-C").arg(dir).args(args).status().map(|s| s.success()).unwrap_or(false)
}

/// New session "in a new git worktree": `git.worktree_add {cwd, branch}`, then `agent.start` in
/// the pane it returns.
#[tokio::test]
async fn worktree_then_agent_start_in_its_pane() {
    let repo = tempfile::tempdir().unwrap();
    let root = repo.path().canonicalize().unwrap();
    let committed = git_ok(&root, &["init", "-b", "main"])
        && git_ok(&root, &["-c", "user.name=sam", "-c", "user.email=sam@example.com", "commit", "--allow-empty", "-m", "x"]);
    if !committed {
        eprintln!("skipped: git is not available");
        return;
    }
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("git.worktree_add", json!({"cwd": root, "branch": "fix-x"})).await;
    let pane = r["result"]["pane_id"].as_str().unwrap_or_else(|| panic!("{r}")).to_string();
    assert_eq!(r["result"]["via"], "herdr");
    sess.ok("agent.start", json!({"name": "fix-x", "kind": "claude", "pane_id": pane})).await;
    assert_eq!(s.core.calls_of("terminal.send")[0], json!({"terminal": pane, "text": "claude"}));
}

#[tokio::test]
async fn herdr_one_only_methods_are_unsupported() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    for (m, p) in [
        ("pane.split", json!({"pane_id": "t1", "direction": "right"})),
        ("workspace.focus", json!({"workspace_id": "space:s1"})),
        ("tab.focus", json!({"tab_id": "tab:a"})),
    ] {
        let r = sess.herdr(m, p).await;
        assert_eq!(r["error"]["code"], "unsupported", "{m}: {r}");
        assert!(r["error"]["message"].is_string());
    }
}
