//! The "read" state on the computer: the pure rules of `core::seen`, the snapshot fields and
//! `agent.mark_seen` with a fake core. No test reaches a real core.

#[path = "support/fake_core.rs"]
mod fake_core;
use std::time::Duration;

use fake_core::{terminal, State};
use herdlingd::core::endpoint::CoreSocket;
use herdlingd::core::project;
use herdlingd::core::seen::{self, Mark};
use herdlingd::rpc::{self, Ctx};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

fn agent(status: Option<&str>, turn: u64, labels: Value) -> Value {
    let mut t = terminal("t1", None, status);
    t["turn"] = json!(turn);
    t["labels"] = labels;
    t
}

#[test]
fn label_turn_reads_numbers_only() {
    let t = agent(Some("done"), 5, json!({"herdling.seen": "4", "herdr.seen": " 3 ", "x": "a"}));
    assert_eq!(seen::label_turn(&t, seen::SEEN_LABEL), Some(4));
    assert_eq!(seen::label_turn(&t, seen::HERDR_SEEN_LABEL), Some(3));
    assert_eq!(seen::label_turn(&t, "x"), None);
    assert_eq!(seen::label_turn(&t, "missing"), None);
    assert_eq!(seen::label_turn(&json!({"address": "t1"}), seen::SEEN_LABEL), None);
}

#[test]
fn mark_grows_only_and_never_passes_the_current_turn() {
    let done = agent(Some("done"), 7, json!({}));
    assert_eq!(seen::mark(&done, 7), Mark::Write(7));
    assert_eq!(seen::mark(&done, 99), Mark::Write(7), "never past the current turn");
    assert_eq!(seen::mark(&done, 0), Mark::Keep(0), "0 writes nothing");
    let marked = agent(Some("done"), 7, json!({"herdling.seen": "5"}));
    assert_eq!(seen::mark(&marked, 4), Mark::Keep(5), "never back");
    assert_eq!(seen::mark(&marked, 5), Mark::Keep(5));
    assert_eq!(seen::mark(&marked, 6), Mark::Write(6));
    // The turn goes up when the status leaves `working`: turn 7 of a working agent is done.
    let working = agent(Some("working"), 7, json!({"herdling.seen": "5"}));
    assert_eq!(seen::mark(&working, 7), Mark::Write(7));
    assert_eq!(seen::mark(&agent(Some("working"), 7, json!({})), 8), Mark::Write(7), "never past the current turn");
    let mut no_turn = agent(Some("done"), 0, json!({}));
    no_turn.as_object_mut().unwrap().remove("turn");
    assert_eq!(seen::mark(&no_turn, 3), Mark::Keep(0), "no turn, no mark");
    let bad = agent(Some("done"), 7, json!({"herdling.seen": "x"}));
    assert_eq!(seen::mark(&bad, 2), Mark::Write(2), "a bad label counts as none");
    assert_eq!(seen::labels(6), *json!({"herdling.seen": "6"}).as_object().unwrap());
}

#[test]
fn agent_entries_have_the_turn_and_both_seen_values() {
    let t = agent(Some("done"), 9, json!({"herdling.seen": "8", "herdr.seen": "6"}));
    let e = project::agent_entry(&t, "tab", "ws", "name").unwrap();
    assert_eq!((e["turn"].clone(), e["seen_turn"].clone(), e["herdr_seen_turn"].clone()), (json!(9), json!(8), json!(6)));
    let plain = project::agent_entry(&agent(Some("done"), 2, json!({})), "tab", "ws", "name").unwrap();
    assert_eq!(plain["turn"], 2);
    assert!(plain.get("seen_turn").is_none() && plain.get("herdr_seen_turn").is_none(), "{plain}");
}

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
}

struct Setup {
    dir: tempfile::TempDir,
    core: fake_core::FakeCore,
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
}

/// t1 is done at turn 3 with the desktop label `herdr.seen` 2; t2 works at turn 3.
fn setup() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let mut t1 = terminal("t1", None, Some("done"));
    t1["labels"] = json!({"herdr.seen": "2", "herdr.space": "s1"});
    let st = State { terminals: vec![t1, terminal("t2", None, Some("working"))], ..State::default() };
    let core = fake_core::spawn(&dir.path().join("core.sock"), st);
    Setup { dir, core }
}

#[tokio::test]
async fn hello_lists_the_method() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let h = sess.call("hello", json!({})).await;
    assert!(h["result"]["methods"].as_array().unwrap().contains(&json!("agent.mark_seen")));
}

#[tokio::test]
async fn mark_seen_writes_only_herdling_seen() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("agent.mark_seen", json!({"pane_id": "t1", "turn": 3})).await;
    assert_eq!(r["result"], json!({"pane_id": "t1", "seen_turn": 3}), "{r}");
    assert_eq!(s.labels("t1"), json!({"herdr.seen": "2", "herdr.space": "s1", "herdling.seen": "3"}));
    // The same mark again, or an older one, writes nothing.
    let r = sess.call("agent.mark_seen", json!({"pane_id": "t1", "turn": 1})).await;
    assert_eq!(r["result"]["seen_turn"], 3);
    assert_eq!(s.core.calls_of("terminal.label").len(), 1);
    // The snapshot shows the values.
    let snap = sess.call("herdr.call", json!({"method": "session.snapshot", "params": {}})).await;
    let a = snap["result"]["snapshot"]["agents"].as_array().unwrap().iter().find(|a| a["pane_id"] == "t1").cloned().unwrap();
    assert_eq!((a["turn"].clone(), a["seen_turn"].clone(), a["herdr_seen_turn"].clone()), (json!(3), json!(3), json!(2)));
}

#[tokio::test]
async fn mark_seen_never_passes_the_current_turn() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("agent.mark_seen", json!({"pane_id": "t2", "turn": 9})).await;
    assert_eq!(r["result"]["seen_turn"], 3, "{r}");
    assert_eq!(s.labels("t2"), json!({"herdling.seen": "3"}));
}

#[tokio::test]
async fn mark_seen_refusals() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("agent.mark_seen", json!({"pane_id": "t1"})).await;
    assert_eq!(r["error"]["code"], "bad_request");
    let r = sess.call("agent.mark_seen", json!({"pane_id": "t1", "turn": -1})).await;
    assert_eq!(r["error"]["code"], "bad_request");
    let r = sess.call("agent.mark_seen", json!({"pane_id": "t9", "turn": 1})).await;
    assert_eq!(r["error"]["code"], "pane_not_found", "{r}");
    let r = sess.call("agent.mark_seen", json!({"pane_id": "space:s1", "turn": 1})).await;
    assert_eq!(r["error"]["code"], "pane_not_found", "{r}");
    assert!(s.core.calls_of("terminal.label").is_empty());
    let mut no_core = Session::start(Ctx::new(s.dir.path().into()));
    assert_eq!(no_core.call("agent.mark_seen", json!({"pane_id": "t1", "turn": 1})).await["error"]["code"], "herdr_unavailable");
}
