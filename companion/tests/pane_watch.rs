//! `pane.watch` on a core with no `terminal.attach` (the `terminal.read` poll), the gate, and the
//! order of typing calls.

#[path = "support/fake_core.rs"]
mod fake_core;

use std::time::{Duration, Instant};

use herdlingd::rpc::{self, Ctx};
use herdlingd::watch::{Gate, Screen, WatchParams, MIN_EVENT_GAP};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

struct Session {
    tx: Option<tokio::io::DuplexStream>,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
}

impl Session {
    fn start(ctx: Ctx) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(1 << 20);
        let (server_out, client_rx) = tokio::io::duplex(1 << 20);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
        Session { tx: Some(client_tx), rx: BufReader::new(client_rx).lines() }
    }
    async fn send(&mut self, line: &str) {
        self.tx.as_mut().unwrap().write_all(format!("{line}\n").as_bytes()).await.unwrap();
    }
    async fn recv(&mut self) -> Value {
        let line = tokio::time::timeout(Duration::from_secs(5), self.rx.next_line())
            .await
            .expect("timed out waiting for output")
            .unwrap()
            .unwrap();
        serde_json::from_str(&line).unwrap()
    }
    /// The next line, or None when nothing arrives within `ms`.
    async fn maybe(&mut self, ms: u64) -> Option<Value> {
        match tokio::time::timeout(Duration::from_millis(ms), self.rx.next_line()).await {
            Ok(Ok(Some(l))) => Some(serde_json::from_str(&l).unwrap()),
            _ => None,
        }
    }
    async fn watch(&mut self, id: u64, params: Value) -> Value {
        self.send(&json!({"id": id, "method": "pane.watch", "params": params}).to_string()).await;
        self.recv().await
    }
}

/// A fake core with one shell terminal `t1` whose screen is `$ `.
fn core(dir: &std::path::Path) -> (Ctx, fake_core::FakeCore) {
    let t = fake_core::terminal("t1", None, None);
    fake_core::with_ctx(dir, dir.into(), fake_core::State { terminals: vec![t], screen: "$ ".into(), ..Default::default() })
}

fn screen(revision: u64, text: &str) -> Screen {
    Screen { revision, text: text.into(), truncated: false }
}

fn set_screen(c: &fake_core::FakeCore, text: &str) {
    c.state.lock().unwrap().screen = text.into();
}

fn reads(c: &fake_core::FakeCore) -> usize {
    c.calls_of("terminal.read").len()
}

#[test]
fn gate_sends_first_screen_and_skips_equal_screens() {
    let mut g = Gate::default();
    let t = Instant::now();
    assert!(g.offer(&screen(0, "a"), t));
    assert!(!g.offer(&screen(0, "a"), t + Duration::from_secs(1)));
    // herdr 0.9.5 keeps revision 0: a new text alone is a change.
    assert!(g.offer(&screen(0, "b"), t + Duration::from_secs(2)));
    // A new revision with the same text is a change too.
    assert!(g.offer(&screen(7, "b"), t + Duration::from_secs(3)));
    assert!(!g.offer(&screen(7, "b"), t + Duration::from_secs(4)));
}

#[test]
fn gate_rate_cap_holds_back_then_sends_the_latest() {
    let mut g = Gate::default();
    let t = Instant::now();
    assert!(g.offer(&screen(0, "a"), t));
    let soon = t + MIN_EVENT_GAP / 2;
    assert!(!g.offer(&screen(0, "b"), soon), "inside the gap");
    assert!(!g.offer(&screen(0, "c"), soon), "inside the gap");
    // The held-back screen was not recorded: the next read after the gap sends the latest one.
    assert!(g.offer(&screen(0, "c"), t + MIN_EVENT_GAP));
}

#[test]
fn watch_params_defaults_and_clamps() {
    let p = WatchParams::parse(&json!({"pane_id": "w1:p1"})).unwrap();
    assert_eq!((p.lines, p.ansi, p.interval), (200, false, Duration::from_millis(80)));
    let p = WatchParams::parse(&json!({"pane_id": "w1:p1", "interval_ms": 1, "format": "ansi", "lines": 0})).unwrap();
    assert_eq!((p.lines, p.ansi, p.interval), (1, true, Duration::from_millis(50)));
    let p = WatchParams::parse(&json!({"pane_id": "w1:p1", "interval_ms": 60_000})).unwrap();
    assert_eq!(p.interval, Duration::from_millis(1000));
    assert_eq!(WatchParams::parse(&json!({})).unwrap_err().code, "bad_request");
    assert_eq!(WatchParams::parse(&json!({"pane_id": "w1:p1", "format": "html"})).unwrap_err().code, "bad_request");
    let p = WatchParams::parse(&json!({"pane_id": "w1:p1", "format": "vt"})).unwrap();
    assert_eq!((p.format, p.ansi), (herdlingd::watch::Format::Vt, false));
}

#[test]
fn watch_params_phone_grid() {
    let p = WatchParams::parse(&json!({"pane_id": "t1"})).unwrap();
    assert_eq!(p.size, None);
    let p = WatchParams::parse(&json!({"pane_id": "t1", "cols": 45, "rows": 30})).unwrap();
    assert_eq!(p.size, Some((45, 30)));
    let p = WatchParams::parse(&json!({"pane_id": "t1", "cols": 5, "rows": 9999})).unwrap();
    assert_eq!(p.size, Some((20, 200)));
    let p = WatchParams::parse(&json!({"pane_id": "t1", "cols": 9999, "rows": 1})).unwrap();
    assert_eq!(p.size, Some((500, 5)));
    // One of the two alone is no grid.
    assert_eq!(WatchParams::parse(&json!({"pane_id": "t1", "cols": 45})).unwrap().size, None);
    assert_eq!(WatchParams::parse(&json!({"pane_id": "t1", "rows": 30})).unwrap().size, None);
}

#[tokio::test]
async fn watch_sends_first_screen_then_only_changes() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = core(dir.path());
    let mut s = Session::start(ctx);
    let r = s.watch(1, json!({"pane_id": "t1", "format": "ansi", "lines": 50, "interval_ms": 50})).await;
    let stream = r["result"]["stream"].as_str().unwrap_or_else(|| panic!("no stream: {r}")).to_string();
    assert!(stream.starts_with("pane:"));
    assert_eq!(c.calls_of("terminal.read")[0], json!({"terminal": "t1", "lines": 50}));
    let first = s.recv().await;
    assert_eq!(first["method"], "event");
    assert_eq!(first["params"]["stream"], stream.as_str());
    assert_eq!(first["params"]["data"], json!({"revision": 0, "text": "$ ", "truncated": false}));

    // Unchanged screen: herdlingd keeps reading but sends nothing.
    let before = reads(&c);
    assert!(s.maybe(300).await.is_none(), "an unchanged screen was sent");
    assert!(reads(&c) >= before + 3, "herdlingd did not poll the core");

    set_screen(&c, "$ ls\nfile\n$ ");
    let ev = s.recv().await;
    assert_eq!(ev["params"]["data"]["text"], "$ ls\nfile\n$ ");
    assert!(s.maybe(200).await.is_none());
}

#[tokio::test]
async fn watch_reports_core_errors_as_the_call_error() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, _c) = core(dir.path());
    let mut s = Session::start(ctx);
    let r = s.watch(1, json!({"pane_id": "t9"})).await;
    assert_eq!(r["error"]["code"], "pane_not_found");

    let dir2 = tempfile::tempdir().unwrap();
    let mut s2 = Session::start(Ctx::new(dir2.path().into()));
    let r = s2.watch(1, json!({"pane_id": "t1"})).await;
    assert_eq!(r["error"]["code"], "herdr_unavailable");
    let r = s2.watch(2, json!({})).await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[tokio::test]
async fn watch_ends_with_an_error_event_when_the_pane_goes() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = core(dir.path());
    let mut s = Session::start(ctx);
    s.watch(1, json!({"pane_id": "t1", "interval_ms": 50})).await;
    s.recv().await;
    let gone = c.state.lock().unwrap().terminals.pop().unwrap();
    let ev = s.recv().await;
    assert_eq!(ev["params"]["data"]["error"], "pane_not_found");
    let n = reads(&c);
    c.state.lock().unwrap().terminals.push(gone);
    assert!(s.maybe(200).await.is_none());
    assert_eq!(reads(&c), n, "the stream kept reading after its end");
}

#[tokio::test]
async fn watch_stops_reading_on_cancel() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = core(dir.path());
    let mut s = Session::start(ctx);
    let r = s.watch(1, json!({"pane_id": "t1", "interval_ms": 50})).await;
    let stream = r["result"]["stream"].as_str().unwrap().to_string();
    s.recv().await;
    s.send(&json!({"id": 2, "method": "rpc.cancel", "params": {"stream": stream}}).to_string()).await;
    assert_eq!(s.recv().await["result"]["cancelled"], true);
    tokio::time::sleep(Duration::from_millis(60)).await;
    let n = reads(&c);
    set_screen(&c, "changed");
    assert!(s.maybe(250).await.is_none(), "event after cancel");
    assert_eq!(reads(&c), n, "core reads after cancel");
}

#[tokio::test]
async fn watch_stops_reading_when_the_channel_closes() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = core(dir.path());
    let mut s = Session::start(ctx);
    s.watch(1, json!({"pane_id": "t1", "interval_ms": 50})).await;
    s.recv().await;
    // The SSH channel closes: stdin reaches EOF.
    drop(s.tx.take());
    tokio::time::sleep(Duration::from_millis(150)).await;
    let n = reads(&c);
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(reads(&c), n, "core reads after the channel closed");
}

#[tokio::test]
async fn send_input_types_text_and_enter_as_one_send() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = core(dir.path());
    let mut s = Session::start(ctx);
    let call = json!({"id": 1, "method": "herdr.call", "params": {"method": "pane.send_input",
        "params": {"pane_id": "t1", "text": "ls -la", "keys": ["enter"]}}});
    s.send(&call.to_string()).await;
    assert!(s.recv().await.get("result").is_some());
    assert_eq!(c.calls_of("terminal.send"), vec![json!({"terminal": "t1", "text": "ls -la", "force": true})]);
}

// Many worker threads, as in `herdlingd rpc`, so request tasks can run in parallel.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pipelined_typing_calls_reach_the_core_in_order() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, c) = core(dir.path());
    let mut s = Session::start(ctx);
    const N: usize = 60;
    let mut want = Vec::new();
    for i in 0..N {
        let line = if i % 3 == 2 {
            want.push(json!(["enter"]));
            json!({"id": i, "method": "herdr.call", "params": {"method": "pane.send_keys", "params": {"pane_id": "t1", "keys": ["enter"]}}})
        } else {
            let text = format!("t{i}");
            want.push(json!(text.chars().map(|c| c.to_string()).collect::<Vec<_>>()));
            json!({"id": i, "method": "herdr.call", "params": {"method": "pane.send_input", "params": {"pane_id": "t1", "text": text}}})
        };
        s.send(&line.to_string()).await;
    }
    for _ in 0..N {
        assert!(s.recv().await.get("result").is_some());
    }
    let got: Vec<Value> = c.calls_of("terminal.keys").into_iter().map(|p| p["keys"].clone()).collect();
    assert_eq!(got, want);
}

#[tokio::test]
async fn input_order_lanes_are_per_pane_and_a_dropped_turn_frees_the_next() {
    use herdlingd::input_order::InputOrder;
    let order = InputOrder::default();
    let first = order.take("w1:p1");
    let mut second = order.take("w1:p1");
    let mut other = order.take("w1:p2");
    // Another pane does not wait.
    tokio::time::timeout(Duration::from_millis(100), other.wait()).await.expect("other pane waited");
    assert!(tokio::time::timeout(Duration::from_millis(100), second.wait()).await.is_err(), "ran before the first turn");
    // A wait that was given up keeps the place: it still waits.
    assert!(tokio::time::timeout(Duration::from_millis(50), second.wait()).await.is_err(), "lost its place");
    drop(first);
    tokio::time::timeout(Duration::from_millis(100), second.wait()).await.expect("did not run after the first turn");
    // Only typing calls take a turn.
    let call = |m: &str| json!({"method": m, "params": {"pane_id": "w1:p1"}});
    assert!(order.take_for("herdr.call", &call("pane.send_input")).is_some());
    assert!(order.take_for("herdr.call", &call("pane.read")).is_none());
    assert!(order.take_for("pane.watch", &call("pane.send_input")).is_none());
}
