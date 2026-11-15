//! Phone input to a Herdr 2 terminal through `herdlingd rpc`, with a fake core: raw text and
//! keys on a short attach stream, the `terminal.keys` fallback, and the bound of a
//! `terminal.send` that waits for quiet at the computer. No test reaches a real core.

#[path = "support/fake_core.rs"]
mod fake_core;
use std::time::{Duration, Instant};

use fake_core::{terminal, FakeCore, State};
use herdlingd::core::endpoint::CoreSocket;
use herdlingd::core::frame;
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
    async fn send(&mut self, id: u64, method: &str, params: Value) {
        let line = json!({"id": id, "method": "herdr.call", "params": {"method": method, "params": params}}).to_string();
        self.tx.write_all(format!("{line}\n").as_bytes()).await.unwrap();
    }
    async fn recv(&mut self) -> Value {
        let line = tokio::time::timeout(Duration::from_secs(10), self.rx.next_line()).await.expect("timed out").unwrap().unwrap();
        serde_json::from_str(&line).unwrap()
    }
    async fn herdr(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.send(id, method, params).await;
        let v = self.recv().await;
        assert_eq!(v["id"], id);
        v
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
    /// The typed bytes on attach streams, with their frame kinds (no CREDIT or CLOSE).
    fn typed(&self) -> Vec<(u8, Vec<u8>)> {
        self.core.stream_frames().into_iter().filter(|f| f.1 == frame::DATA || f.1 == frame::AUTOMATIC_INPUT).map(|f| (f.1, f.2)).collect()
    }
}

fn setup(f: impl FnOnce(&mut State)) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let mut st = State {
        terminals: vec![terminal("t1", None, Some("idle")), terminal("t2", None, None)],
        doc: Value::Null,
        attach: true,
        automatic_input: true,
        paint: b"\x1b[H\x1b[2J$ ".to_vec(),
        ..State::default()
    };
    f(&mut st);
    let core = fake_core::spawn(&dir.path().join("core.sock"), st);
    Setup { dir, core }
}

#[tokio::test]
async fn text_without_enter_is_typed_as_it_is() {
    let s = setup(|_| {});
    let mut sess = Session::start(s.ctx());
    let text = "echo \"hi!\" #$&()*+:<>?@^_{|}~ é 🎉";
    let r = sess.herdr(1, "pane.send_input", json!({"pane_id": "t2", "text": text})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.typed(), vec![(frame::AUTOMATIC_INPUT, text.as_bytes().to_vec())]);
    assert!(s.core.calls_of("terminal.keys").is_empty());
    assert!(s.core.calls_of("terminal.send").is_empty());
    // A typing attach that never resizes: not active, at the size of the terminal.
    let attach = &s.core.calls_of("terminal.attach")[0];
    assert_eq!(attach["observe"], false);
    assert_eq!(attach["resumed"], true);
    assert_eq!((attach["cols"].clone(), attach["rows"].clone()), (json!(80), json!(24)));
    // The old `pane.send_text` too.
    let r = sess.herdr(2, "pane.send_text", json!({"pane_id": "t2", "text": "a!b"})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.typed().last().unwrap().1, b"a!b");
}

#[tokio::test]
async fn keys_are_typed_in_the_modes_of_the_program() {
    // The program asked for application cursor keys.
    let s = setup(|st| st.paint = b"\x1b[?1h\x1b[H~".to_vec());
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr(1, "pane.send_input", json!({"pane_id": "t1", "text": "ab", "keys": ["up", "esc"]})).await;
    assert!(r.get("error").is_none(), "{r}");
    let bytes: Vec<Vec<u8>> = s.typed().into_iter().map(|t| t.1).collect();
    assert_eq!(bytes, vec![b"ab".to_vec(), b"\x1bOA".to_vec(), b"\x1b".to_vec()]);
    assert!(s.core.calls_of("terminal.keys").is_empty());
    let r = sess.herdr(2, "pane.send_keys", json!({"pane_id": "t1", "keys": ["ctrl+c"]})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.typed().last().unwrap().1, b"\x03");
}

#[tokio::test]
async fn a_key_with_no_legacy_form_goes_to_the_core() {
    let s = setup(|_| {});
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr(1, "pane.send_input", json!({"pane_id": "t1", "text": "fix", "keys": ["shift+enter"]})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.typed(), vec![(frame::AUTOMATIC_INPUT, b"fix".to_vec())]);
    assert_eq!(s.core.calls_of("terminal.keys"), vec![json!({"terminal": "t1", "keys": ["shift+enter"]})]);
}

#[tokio::test]
async fn a_core_without_automatic_input_gets_data() {
    let s = setup(|st| st.automatic_input = false);
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr(1, "pane.send_input", json!({"pane_id": "t2", "text": "x?"})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.typed(), vec![(frame::DATA, b"x?".to_vec())]);
}

#[tokio::test]
async fn a_line_still_goes_through_terminal_send() {
    let s = setup(|_| {});
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr(1, "pane.send_input", json!({"pane_id": "t1", "text": "fix it!", "keys": ["enter"]})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.core.calls_of("terminal.send"), vec![json!({"terminal": "t1", "text": "fix it!", "force": true})]);
    assert!(s.typed().is_empty());
}

#[tokio::test]
async fn a_missing_pane_types_nothing() {
    let s = setup(|_| {});
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr(1, "pane.send_input", json!({"pane_id": "t9", "text": "x"})).await;
    assert_eq!(r["error"]["code"], "pane_not_found", "{r}");
    assert!(s.typed().is_empty());
}

#[tokio::test]
async fn a_send_that_waits_too_long_is_cancelled_and_never_types() {
    let s = setup(|st| st.send_delay = Some(Duration::from_millis(1500)));
    let mut ctx = s.ctx();
    ctx.input_timeout = Duration::from_millis(300);
    let mut sess = Session::start(ctx);
    let t0 = Instant::now();
    let r = sess.herdr(1, "pane.send_input", json!({"pane_id": "t1", "text": "ls", "keys": ["enter"]})).await;
    assert!(t0.elapsed() < Duration::from_millis(1200), "answered after {:?}", t0.elapsed());
    assert_eq!(r["error"]["code"], "busy", "{r}");
    assert!(r["error"]["message"].as_str().unwrap().contains("Look at the terminal"), "{r}");
    // Long after the wait of the core: the send was cancelled, nothing typed later.
    tokio::time::sleep(Duration::from_millis(1700)).await;
    assert!(s.core.state.lock().unwrap().typed.is_empty(), "the text went in after the answer");
}

#[tokio::test]
async fn calls_behind_a_failed_call_do_not_run() {
    let s = setup(|st| st.send_delay = Some(Duration::from_millis(1500)));
    let mut ctx = s.ctx();
    ctx.input_timeout = Duration::from_millis(300);
    let mut sess = Session::start(ctx);
    // The app pipelines a line and then more keys before it knows of the failure.
    sess.send(1, "pane.send_input", json!({"pane_id": "t1", "text": "rm -r build", "keys": ["enter"]})).await;
    sess.send(2, "pane.send_input", json!({"pane_id": "t1", "text": "y"})).await;
    sess.send(3, "pane.send_keys", json!({"pane_id": "t1", "keys": ["enter"]})).await;
    let mut got: Vec<Value> = vec![sess.recv().await, sess.recv().await, sess.recv().await];
    got.sort_by_key(|v| v["id"].as_u64());
    assert_eq!(got[0]["error"]["code"], "busy", "{}", got[0]);
    // Each one either ran out of time behind the first or was dropped after its failure.
    for v in &got[1..] {
        assert!(matches!(v["error"]["code"].as_str(), Some("busy" | "dropped")), "{v}");
        assert!(v["error"]["message"].as_str().unwrap().contains("Nothing was typed"), "{v}");
    }
    assert!(s.typed().is_empty(), "nothing was typed after the failure");
    // A new call after the failure runs.
    s.core.state.lock().unwrap().send_delay = None;
    let r = sess.herdr(4, "pane.send_input", json!({"pane_id": "t1", "text": "z"})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.typed(), vec![(frame::AUTOMATIC_INPUT, b"z".to_vec())]);
}

#[tokio::test]
async fn pane_answer_types_the_digit_at_once() {
    let s = setup(|st| {
        st.terminals[0]["status"]["state"] = json!("blocked");
        st.screen = "Allow?\n❯ 1. Yes\n  2. No\n".into();
    });
    let mut sess = Session::start(s.ctx());
    let line = json!({"id": 1, "method": "pane.answer", "params": {"pane_id": "t1", "key": "1", "expect_label": "Yes"}}).to_string();
    sess.tx.write_all(format!("{line}\n").as_bytes()).await.unwrap();
    let r = sess.recv().await;
    assert_eq!(r["result"]["answered"], true, "{r}");
    assert_eq!(s.typed(), vec![(frame::AUTOMATIC_INPUT, b"1".to_vec())]);
}
