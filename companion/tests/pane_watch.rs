#[path = "support/fake_herdr.rs"]
mod fake_herdr;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
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
    fn start(sock: PathBuf, home: PathBuf) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(1 << 20);
        let (server_out, client_rx) = tokio::io::duplex(1 << 20);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, Ctx::new(sock, home)));
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

/// A fake herdr pane whose screen the test changes. Counts `pane.read` calls.
#[derive(Clone)]
struct Pane {
    text: Arc<Mutex<String>>,
    revision: Arc<AtomicU64>,
    reads: Arc<AtomicU64>,
    gone: Arc<AtomicBool>,
    last_params: Arc<Mutex<Value>>,
}

impl Pane {
    fn spawn(sock: &std::path::Path) -> Pane {
        let pane = Pane {
            text: Arc::new(Mutex::new("$ ".into())),
            revision: Arc::new(AtomicU64::new(0)),
            reads: Arc::new(AtomicU64::new(0)),
            gone: Arc::new(AtomicBool::new(false)),
            last_params: Arc::new(Mutex::new(Value::Null)),
        };
        let p = pane.clone();
        fake_herdr::spawn_fn(sock, move |method, params| {
            if method != "pane.read" || p.gone.load(Ordering::SeqCst) {
                return None;
            }
            p.reads.fetch_add(1, Ordering::SeqCst);
            *p.last_params.lock().unwrap() = params.clone();
            Some(json!({"type": "pane_read", "read": {
                "pane_id": "w1:p1", "text": *p.text.lock().unwrap(),
                "revision": p.revision.load(Ordering::SeqCst), "truncated": false,
            }}))
        });
        pane
    }
    fn set(&self, text: &str) {
        *self.text.lock().unwrap() = text.into();
    }
}

fn screen(revision: u64, text: &str) -> Screen {
    Screen { revision, text: text.into(), truncated: false }
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
}

#[tokio::test]
async fn watch_sends_first_screen_then_only_changes() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let pane = Pane::spawn(&sock);
    let mut s = Session::start(sock, dir.path().into());
    let r = s.watch(1, json!({"pane_id": "w1:p1", "format": "ansi", "lines": 50, "interval_ms": 50})).await;
    let stream = r["result"]["stream"].as_str().unwrap_or_else(|| panic!("no stream: {r}")).to_string();
    assert!(stream.starts_with("pane:"));
    assert_eq!(
        *pane.last_params.lock().unwrap(),
        json!({"pane_id": "w1:p1", "source": "recent", "lines": 50, "format": "ansi", "strip_ansi": false})
    );
    let first = s.recv().await;
    assert_eq!(first["method"], "event");
    assert_eq!(first["params"]["stream"], stream.as_str());
    assert_eq!(first["params"]["data"], json!({"revision": 0, "text": "$ ", "truncated": false}));

    // Unchanged screen: herdlingd keeps reading but sends nothing.
    let before = pane.reads.load(Ordering::SeqCst);
    assert!(s.maybe(300).await.is_none(), "an unchanged screen was sent");
    assert!(pane.reads.load(Ordering::SeqCst) >= before + 3, "herdlingd did not poll herdr");

    pane.set("$ ls\nfile\n$ ");
    let ev = s.recv().await;
    assert_eq!(ev["params"]["data"]["text"], "$ ls\nfile\n$ ");

    pane.revision.store(5, Ordering::SeqCst);
    let ev = s.recv().await;
    assert_eq!(ev["params"]["data"]["revision"], 5);
    assert!(s.maybe(200).await.is_none());
}

#[tokio::test]
async fn watch_reports_herdr_errors_as_the_call_error() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let pane = Pane::spawn(&sock);
    pane.gone.store(true, Ordering::SeqCst);
    let mut s = Session::start(sock, dir.path().into());
    let r = s.watch(1, json!({"pane_id": "w1:p1"})).await;
    assert_eq!(r["error"]["code"], "unknown_method");

    let dir2 = tempfile::tempdir().unwrap();
    let mut s2 = Session::start(dir2.path().join("none.sock"), dir2.path().into());
    let r = s2.watch(1, json!({"pane_id": "w1:p1"})).await;
    assert_eq!(r["error"]["code"], "herdr_unavailable");
    let r = s2.watch(2, json!({})).await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[tokio::test]
async fn watch_ends_with_an_error_event_when_the_pane_goes() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let pane = Pane::spawn(&sock);
    let mut s = Session::start(sock, dir.path().into());
    s.watch(1, json!({"pane_id": "w1:p1", "interval_ms": 50})).await;
    s.recv().await;
    pane.gone.store(true, Ordering::SeqCst);
    let ev = s.recv().await;
    assert_eq!(ev["params"]["data"]["error"], "unknown_method");
    let reads = pane.reads.load(Ordering::SeqCst);
    pane.gone.store(false, Ordering::SeqCst);
    assert!(s.maybe(200).await.is_none());
    assert_eq!(pane.reads.load(Ordering::SeqCst), reads, "the stream kept reading after its end");
}

#[tokio::test]
async fn watch_stops_reading_on_cancel() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let pane = Pane::spawn(&sock);
    let mut s = Session::start(sock, dir.path().into());
    let r = s.watch(1, json!({"pane_id": "w1:p1", "interval_ms": 50})).await;
    let stream = r["result"]["stream"].as_str().unwrap().to_string();
    s.recv().await;
    s.send(&json!({"id": 2, "method": "rpc.cancel", "params": {"stream": stream}}).to_string()).await;
    assert_eq!(s.recv().await["result"]["cancelled"], true);
    tokio::time::sleep(Duration::from_millis(60)).await;
    let reads = pane.reads.load(Ordering::SeqCst);
    pane.set("changed");
    assert!(s.maybe(250).await.is_none(), "event after cancel");
    assert_eq!(pane.reads.load(Ordering::SeqCst), reads, "herdr reads after cancel");
}

#[tokio::test]
async fn watch_stops_reading_when_the_channel_closes() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let pane = Pane::spawn(&sock);
    let mut s = Session::start(sock, dir.path().into());
    s.watch(1, json!({"pane_id": "w1:p1", "interval_ms": 50})).await;
    s.recv().await;
    // The SSH channel closes: stdin reaches EOF.
    drop(s.tx.take());
    tokio::time::sleep(Duration::from_millis(150)).await;
    let reads = pane.reads.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(pane.reads.load(Ordering::SeqCst), reads, "herdr reads after the channel closed");
}

#[tokio::test]
async fn watch_works_with_one_shot_herdr() {
    // herdr 0.9.0 closes each connection after one answer: the stream connects again.
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let mut m = HashMap::new();
    m.insert("pane.read".to_string(), json!({"read": {"text": "idle", "revision": 0, "truncated": false}}));
    fake_herdr::spawn_one_shot(&sock, m);
    let mut s = Session::start(sock, dir.path().into());
    s.watch(1, json!({"pane_id": "w1:p1", "interval_ms": 50})).await;
    assert_eq!(s.recv().await["params"]["data"]["text"], "idle");
    assert!(s.maybe(300).await.is_none(), "the stream ended or resent an unchanged screen");
}

#[tokio::test]
async fn send_input_passes_text_and_keys_and_marks_phone_input() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let got = Arc::new(Mutex::new(Vec::<Value>::new()));
    let g = got.clone();
    fake_herdr::spawn_fn(&sock, move |method, params| {
        (method == "pane.send_input").then(|| {
            g.lock().unwrap().push(params.clone());
            json!({"type": "ok"})
        })
    });
    let mut s = Session::start(sock, dir.path().into());
    let call = json!({"id": 1, "method": "herdr.call", "params": {"method": "pane.send_input",
        "params": {"pane_id": "w1:p1", "text": "ls -la", "keys": ["enter"]}}});
    s.send(&call.to_string()).await;
    assert_eq!(s.recv().await["result"], json!({"type": "ok"}));
    assert_eq!(*got.lock().unwrap(), vec![json!({"pane_id": "w1:p1", "text": "ls -la", "keys": ["enter"]})]);
    assert!(herdlingd::phone_input::last(dir.path(), "w1:p1").is_some());
}

// Many worker threads, as in `herdlingd rpc`, so request tasks can run in parallel.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pipelined_typing_calls_reach_herdr_in_order() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let got = Arc::new(Mutex::new(Vec::<String>::new()));
    let g = got.clone();
    fake_herdr::spawn_fn(&sock, move |method, params| {
        if method != "pane.send_input" && method != "pane.send_keys" {
            return None;
        }
        let what = params.get("text").and_then(Value::as_str).map(String::from).unwrap_or_else(|| params["keys"][0].to_string());
        g.lock().unwrap().push(what);
        Some(json!({"type": "ok"}))
    });
    let mut s = Session::start(sock, dir.path().into());
    const N: usize = 60;
    let mut want = Vec::new();
    for i in 0..N {
        let line = if i % 3 == 2 {
            want.push("\"enter\"".to_string());
            json!({"id": i, "method": "herdr.call", "params": {"method": "pane.send_keys", "params": {"pane_id": "w1:p1", "keys": ["enter"]}}})
        } else {
            want.push(format!("t{i}"));
            json!({"id": i, "method": "herdr.call", "params": {"method": "pane.send_input", "params": {"pane_id": "w1:p1", "text": format!("t{i}")}}})
        };
        s.send(&line.to_string()).await;
    }
    for _ in 0..N {
        assert!(s.recv().await.get("result").is_some());
    }
    assert_eq!(*got.lock().unwrap(), want);
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
