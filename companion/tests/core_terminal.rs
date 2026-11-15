//! The terminal view of Herdr 2 panes with a fake core in framed mode: `pane.watch` through a
//! passive `terminal.attach`, reconnects, the end of a terminal, `pane.get` and `pane.read`.

#[path = "support/fake_core.rs"]
mod fake_core;

use std::path::PathBuf;
use std::time::Duration;

use fake_core::{terminal, Ctl, FakeCore, State};
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
        let line = tokio::time::timeout(Duration::from_secs(10), self.rx.next_line()).await.expect("timed out").unwrap().unwrap();
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
    async fn event(&mut self) -> Value {
        loop {
            let v = self.recv().await;
            if v["method"] == "event" {
                return v["params"]["data"].clone();
            }
        }
    }
    /// The next event whose text contains `want`.
    async fn event_with(&mut self, want: &str) -> Value {
        loop {
            let e = self.event().await;
            if e["text"].as_str().is_some_and(|t| t.contains(want)) {
                return e;
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
        let mut ctx = Ctx::new(self.dir.path().join("herdr.sock"), self.dir.path().into());
        ctx.core_socket = Some(CoreSocket::fixed(self.sock()));
        ctx
    }
    fn sock(&self) -> PathBuf {
        self.dir.path().join("core.sock")
    }
}

const PAINT: &[u8] = b"\x18\x1b[H\x1b[2J\x1b[31mred\x1b[0m";

fn setup(attach: bool, paint: &[u8]) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let st = State {
        terminals: vec![terminal("t1", Some("api-agent"), Some("idle"))],
        screen: "plain screen".into(),
        attach,
        paint: paint.to_vec(),
        ..State::default()
    };
    let core = fake_core::spawn(&dir.path().join("core.sock"), st);
    Setup { dir, core }
}

fn watch_params() -> Value {
    json!({"pane_id": "hc:t1", "lines": 50, "format": "ansi", "interval_ms": 50})
}

#[tokio::test]
async fn watch_streams_ansi() {
    let s = setup(true, PAINT);
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "pane.watch", watch_params()).await;
    assert!(r["result"]["stream"].is_string(), "{r}");
    assert!(r["result"].get("drive").is_none());
    let first = sess.event().await;
    assert_eq!(first["text"], "\x1b[0;31mred\x1b[0m");
    assert_eq!(first["revision"], 0);
    s.core.send(Ctl::Output(b"\r\nnext".to_vec()));
    let next = sess.event_with("next").await;
    assert_eq!(next["text"], "\x1b[0;31mred\x1b[0m\nnext");
    // The plain read path is not used.
    assert!(s.core.calls_of("terminal.read").is_empty());
}

#[tokio::test]
async fn text_format_has_no_escapes() {
    let s = setup(true, PAINT);
    let mut sess = Session::start(s.ctx());
    sess.call(1, "pane.watch", json!({"pane_id": "hc:t1", "lines": 50})).await;
    assert_eq!(sess.event().await["text"], "red");
}

#[tokio::test]
async fn attach_is_passive() {
    let s = setup(true, PAINT);
    let mut sess = Session::start(s.ctx());
    sess.call(1, "pane.watch", watch_params()).await;
    sess.event().await;
    s.core.send(Ctl::Output(b"\r\nmore output".to_vec()));
    sess.event_with("more").await;
    let attach = &s.core.calls_of("terminal.attach")[0];
    assert_eq!(attach["observe"], true);
    assert_eq!(attach["terminal"], "t1");
    assert_eq!(attach["history"], 50);
    // Only CREDIT (1) and CLOSE (2) go out on a stream channel, and the credit covers the data.
    let frames = s.core.stream_frames();
    assert!(frames.iter().all(|f| f.1 == 1 || f.1 == 2), "{frames:?}");
    let credit: u32 = frames.iter().filter(|f| f.1 == 1).map(|f| u32::from_le_bytes(f.2[..4].try_into().unwrap())).sum();
    assert_eq!(credit as usize, PAINT.len() + b"\r\nmore output".len());
}

#[tokio::test]
async fn unknown_pane_is_not_found() {
    let s = setup(true, PAINT);
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "pane.watch", json!({"pane_id": "hc:t99"})).await;
    assert_eq!(r["error"]["code"], "pane_not_found", "{r}");
    let r = sess.call(2, "pane.watch", json!({"pane_id": "hc:g:proj"})).await;
    assert_eq!(r["error"]["code"], "pane_not_found", "{r}");
}

#[tokio::test]
async fn exit_ends_with_pane_not_found() {
    let s = setup(true, PAINT);
    let mut sess = Session::start(s.ctx());
    sess.call(1, "pane.watch", watch_params()).await;
    sess.event().await;
    s.core.state.lock().unwrap().terminals.clear();
    s.core.send(Ctl::CloseStream(json!({"reason": "exited", "exit_code": 0, "signal": null})));
    let end = sess.event().await;
    assert_eq!(end["error"], "pane_not_found", "{end}");
}

#[tokio::test]
async fn core_restart_reattaches() {
    let s = setup(true, PAINT);
    let mut sess = Session::start(s.ctx());
    sess.call(1, "pane.watch", watch_params()).await;
    sess.event().await;
    s.core.state.lock().unwrap().paint = b"\x18\x1b[H\x1b[2Jback".to_vec();
    s.core.send(Ctl::Drop);
    s.core.wait_calls("terminal.attach", 2).await;
    let e = sess.event_with("back").await;
    assert_eq!(e["text"], "back");
    assert_eq!(s.core.calls_of("terminal.attach")[1]["observe"], true);
}

#[tokio::test]
async fn resize_frames_resize_the_emulator() {
    let s = setup(true, b"\x18\x1b[H\x1b[2Jone\r\ntwo\r\nthree");
    let mut sess = Session::start(s.ctx());
    sess.call(1, "pane.watch", json!({"pane_id": "hc:t1", "lines": 0})).await;
    sess.event().await;
    // The core makes the grid 2 rows high, then repaints it.
    s.core.send(Ctl::Resize(80, 2));
    s.core.send(Ctl::Output(b"\x18\x1b[H\x1b[2JTWO\r\nTHREE".to_vec()));
    let e = sess.event_with("THREE").await;
    let text = e["text"].as_str().unwrap();
    assert!(text.ends_with("TWO\nTHREE"), "{e}");
    // At most one history line (lines 0 is clamped to 1) and the 2 rows.
    assert!(text.lines().count() <= 3, "{e}");
}

#[tokio::test]
async fn drive_mode_attaches_at_the_phone_grid() {
    let s = setup(true, PAINT);
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "pane.watch", json!({"pane_id": "hc:t1", "lines": 50, "format": "ansi", "cols": 45, "rows": 30})).await;
    assert_eq!(r["result"]["drive"], true, "{r}");
    assert_eq!(sess.event().await["text"], "\x1b[0;31mred\x1b[0m");
    let attach = &s.core.calls_of("terminal.attach")[0];
    assert_eq!((attach["observe"].clone(), attach["cols"].clone(), attach["rows"].clone()), (json!(false), json!(45), json!(30)));
    s.core.send(Ctl::Output(b"\r\nmore".to_vec()));
    sess.event_with("more").await;
    // Still only CREDIT and CLOSE on the stream: typing goes through terminal.send.
    assert!(s.core.stream_frames().iter().all(|f| f.1 == 1 || f.1 == 2));
    // A reattach keeps the mode.
    s.core.send(Ctl::Drop);
    s.core.wait_calls("terminal.attach", 2).await;
    let again = &s.core.calls_of("terminal.attach")[1];
    assert_eq!((again["observe"].clone(), again["cols"].clone()), (json!(false), json!(45)));
}

#[tokio::test]
async fn old_core_polls_read() {
    let s = setup(false, PAINT);
    let mut sess = Session::start(s.ctx());
    let r = sess.call(1, "pane.watch", watch_params()).await;
    assert!(r["result"]["stream"].is_string(), "{r}");
    assert_eq!(sess.event().await["text"], "plain screen");
    assert!(s.core.calls_of("terminal.attach").is_empty());
    assert_eq!(s.core.calls_of("terminal.read")[0], json!({"terminal": "t1", "lines": 50}));
}
