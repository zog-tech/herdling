//! `herdlingd rpc` with a fake herdr-core: snapshot merge, routing, `unsupported`, `hello`,
//! `pane.answer`, `pane.watch` and the merged `herdr.subscribe` stream.

#[path = "support/fake_core.rs"]
mod fake_core;
#[path = "support/fake_herdr.rs"]
mod fake_herdr;
#[path = "support/fake_herdr_events.rs"]
mod fake_herdr_events;

use std::collections::HashMap;
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
    fn herdr_sock(&self) -> PathBuf {
        self.dir.path().join("herdr.sock")
    }
    fn core_sock(&self) -> PathBuf {
        self.dir.path().join("core.sock")
    }
    fn ctx(&self) -> Ctx {
        let mut ctx = Ctx::new(self.herdr_sock(), self.dir.path().into());
        ctx.core_socket = Some(CoreSocket::fixed(self.core_sock()));
        ctx
    }
    fn core(&self) -> &FakeCore {
        self.core.as_ref().unwrap()
    }
}

fn herdr_snapshot() -> Value {
    json!({"snapshot": {"version": "0.9.5", "protocol": 22,
        "workspaces": [{"workspace_id": "w1", "label": "api", "number": 1, "agent_status": "idle"}],
        "tabs": [], "panes": [{"pane_id": "w1:p1", "tab_id": "w1:t1", "workspace_id": "w1"}],
        "agents": [{"pane_id": "w1:p1", "tab_id": "w1:t1", "workspace_id": "w1", "agent_status": "idle"}]}})
}

/// A fake core with terminal t1 (an agent in `state`) and t2 (a shell), and optionally a fake herdr 1.
fn setup(herdr: bool, core: bool, state: &str) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Setup { dir, core: None };
    if herdr {
        fake_herdr::spawn(&s.herdr_sock(), HashMap::from([("session.snapshot".to_string(), herdr_snapshot())]));
    }
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
async fn snapshot_without_a_core_is_herdr_one_exactly() {
    let s = setup(true, false, "idle");
    let mut no_core = Session::start(Ctx::new(s.herdr_sock(), s.dir.path().into()));
    let a = no_core.herdr(1, "session.snapshot", json!({})).await;
    assert_eq!(a["result"], herdr_snapshot());
    // A core socket that does not exist: the same answer.
    let mut sess = Session::start(s.ctx());
    let b = sess.herdr(1, "session.snapshot", json!({})).await;
    assert_eq!(b["result"], herdr_snapshot());
}

#[tokio::test]
async fn snapshot_merges_both_and_each_side_alone() {
    let s = setup(true, true, "working");
    let mut sess = Session::start(s.ctx());
    let both = sess.herdr(1, "session.snapshot", json!({})).await;
    assert_eq!(pane_ids(&both, "agents"), ["w1:p1", "hc:t1"]);
    assert_eq!(pane_ids(&both, "panes"), ["w1:p1", "hc:t1", "hc:t2"]);
    assert_eq!(both["result"]["snapshot"]["version"], "0.9.5");

    let core_only = setup(false, true, "working");
    let mut sess = Session::start(core_only.ctx());
    let r = sess.herdr(1, "session.snapshot", json!({})).await;
    assert_eq!(pane_ids(&r, "agents"), ["hc:t1"]);
    assert_eq!(r["result"]["snapshot"]["workspaces"][0]["workspace_id"], "hc:loose");

    let none = setup(false, false, "idle");
    let mut sess = Session::start(none.ctx());
    let r = sess.herdr(1, "session.snapshot", json!({})).await;
    assert_eq!(r["error"]["code"], "herdr_unavailable");
}

#[tokio::test]
async fn calls_on_core_panes_translate() {
    let s = setup(false, true, "blocked");
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr(1, "pane.read", json!({"pane_id": "hc:t1", "source": "visible", "format": "text"})).await;
    assert!(r["result"]["read"]["text"].as_str().unwrap().contains("1. Yes"), "{r}");
    assert_eq!(s.core().calls_of("terminal.read")[0], json!({"terminal": "t1", "lines": 0}));

    let r = sess.herdr(2, "pane.send_input", json!({"pane_id": "hc:t1", "text": "fix it", "keys": ["enter"]})).await;
    assert!(r["error"].is_null(), "{r}");
    assert_eq!(s.core().calls_of("terminal.send")[0], json!({"terminal": "t1", "text": "fix it", "force": true}));

    let r = sess.herdr(3, "pane.send_keys", json!({"pane_id": "hc:t1", "keys": ["ctrl+c"]})).await;
    assert!(r["error"].is_null(), "{r}");
    assert_eq!(s.core().calls_of("terminal.keys")[0], json!({"terminal": "t1", "keys": ["ctrl+c"]}));

    let r = sess.herdr(4, "agent.prompt", json!({"target": "hc:t1", "text": "go on"})).await;
    assert!(r["error"].is_null(), "{r}");

    let r = sess.herdr(5, "pane.get", json!({"pane_id": "hc:t1"})).await;
    assert_eq!(r["result"]["pane"]["agent_status"], "blocked");
    let r = sess.herdr(6, "pane.process_info", json!({"pane_id": "hc:t2"})).await;
    assert_eq!(r["result"]["process_info"]["shell_pid"], 100);

    let r = sess.herdr(7, "pane.close", json!({"pane_id": "hc:t2"})).await;
    assert!(r["error"].is_null(), "{r}");
    assert_eq!(s.core().calls_of("terminal.kill")[0], json!({"terminal": "t2"}));

    // A closed terminal has the herdr 1 code.
    let r = sess.herdr(8, "pane.get", json!({"pane_id": "hc:t9"})).await;
    assert_eq!(r["error"]["code"], "pane_not_found");
}

#[tokio::test]
async fn methods_with_no_core_equivalent_are_unsupported() {
    let s = setup(true, true, "idle");
    let mut sess = Session::start(s.ctx());
    for (i, (m, p)) in [
        ("pane.rename", json!({"pane_id": "hc:t1", "label": "x"})),
        ("agent.start", json!({"workspace_id": "hc:loose", "agent": "claude"})),
        ("tab.create", json!({"workspace_id": "hc:space:s1"})),
        ("pane.send_text", json!({"pane_id": "hc:t1", "text": "€"})),
    ]
    .into_iter()
    .enumerate()
    {
        let r = sess.herdr(i as u64 + 1, m, p).await;
        assert_eq!(r["error"]["code"], "unsupported", "{m}: {r}");
    }
    let r = sess.call(10, "shell.watch", json!({"pane_id": "hc:t2"})).await;
    assert_eq!(r["error"]["code"], "unsupported");
    // Without a core socket, a core id is unsupported too.
    let mut no_core = Session::start(Ctx::new(s.herdr_sock(), s.dir.path().into()));
    let r = no_core.herdr(1, "pane.read", json!({"pane_id": "hc:t1"})).await;
    assert_eq!(r["error"]["code"], "unsupported");
    assert!(s.core().calls_of("terminal.read").is_empty());
}

#[tokio::test]
async fn hello_lists_backends() {
    let s = setup(true, true, "idle");
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "hello", json!({})).await;
    assert_eq!(r["result"]["herdr_ok"], true);
    assert_eq!(r["result"]["backends"]["herdr"]["version"], "0.9.5");
    assert_eq!(r["result"]["backends"]["core"], json!({"version": "0.1.19", "generation": 1}));

    let none = setup(false, false, "idle");
    let mut sess = Session::start(none.ctx());
    let r = sess.call(1, "hello", json!({})).await;
    assert_eq!(r["result"]["herdr_ok"], false);
    assert!(r["result"].get("backends").is_none());
}

#[tokio::test]
async fn pane_answer_on_a_core_pane() {
    let s = setup(false, true, "blocked");
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "pane.answer", json!({"pane_id": "hc:t1", "key": "2", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale", "label mismatch");
    let r = sess.call(2, "pane.answer", json!({"pane_id": "hc:t1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["result"], json!({"answered": true}), "{r}");
    assert_eq!(s.core().calls_of("terminal.keys"), vec![json!({"terminal": "t1", "keys": ["1"]})]);
    let r = sess.call(3, "pane.answer", json!({"pane_id": "hc:t9", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale");

    let idle = setup(false, true, "working");
    let mut sess = Session::start(idle.ctx());
    let r = sess.call(1, "pane.answer", json!({"pane_id": "hc:t1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale");
    assert!(idle.core().calls_of("terminal.keys").is_empty());
}

#[tokio::test]
async fn thread_resolve_and_previews_for_core_agents() {
    let s = setup(false, true, "working");
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "thread.resolve", json!({"pane_id": "hc:t1"})).await;
    assert_eq!(r["result"]["session"], Value::Null);
    assert_eq!(r["result"]["kind"], "claude");
    let r = sess.call(2, "agents.preview", json!({})).await;
    let p = &r["result"]["previews"][0];
    assert_eq!(p["pane_id"], "hc:t1");
    assert_eq!(p["activity"], "Running tests");
    assert_eq!(p["status_since"], 1_700_000_000);
}

#[tokio::test]
async fn pane_watch_reads_a_core_pane() {
    let s = setup(false, true, "idle");
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "pane.watch", json!({"pane_id": "hc:t1", "lines": 50, "interval_ms": 50})).await;
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
    let s = setup(false, true, "working");
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "herdr.subscribe", json!({})).await;
    assert!(r["result"]["stream"].is_string(), "{r}");
    s.core().wait_subscribes(1).await;
    s.core().send(Ctl::Event(status_event("t1", "done")));
    let ev = sess.event().await;
    assert_eq!(ev["event"], "pane.agent_status_changed");
    assert_eq!(ev["data"]["pane_id"], "hc:t1");
    assert_eq!(ev["data"]["agent_status"], "done");
    s.core().send(Ctl::Missed(json!({"seq": 5, "terminals": []})));
    assert_eq!(sess.event().await["event"], "layout.updated");
    // The last backend ends: the stream closes as before.
    s.core().send(Ctl::Drop);
    assert_eq!(sess.event().await, json!({"closed": true}));
}

#[tokio::test]
async fn subscribe_keeps_herdr_one_when_the_core_drops() {
    use fake_herdr_events::{spawn_fake_opts, status_ev, Push};
    let dir = tempfile::tempdir().unwrap();
    let herdr_sock = dir.path().join("herdr.sock");
    let (push, _reqs, _open) = spawn_fake_opts(&herdr_sock, &["w1:p1"], &[]);
    let core_sock = dir.path().join("core.sock");
    let core = fake_core::spawn(&core_sock, State { terminals: vec![terminal("t1", None, Some("working"))], ..State::default() });
    let mut ctx = Ctx::new(herdr_sock, dir.path().into());
    ctx.core_socket = Some(CoreSocket::fixed(core_sock));
    let mut sess = Session::start(ctx);
    let r = sess.call(1, "herdr.subscribe", json!({})).await;
    assert!(r["result"]["stream"].is_string(), "{r}");
    core.wait_subscribes(1).await;
    core.send(Ctl::Drop);
    assert_eq!(sess.event().await["event"], "layout.updated", "a hint, not a close");
    push.send(Push::Event(status_ev("w1:p1", "done"))).unwrap();
    assert_eq!(sess.event().await["data"]["pane_id"], "w1:p1");
    // The core leg connects again after the retry wait and gives one more hint.
    core.wait_subscribes(2).await;
    assert_eq!(sess.event().await["event"], "layout.updated");
    core.send(Ctl::Event(status_event("t1", "blocked")));
    assert_eq!(sess.event().await["data"]["pane_id"], "hc:t1");
}
