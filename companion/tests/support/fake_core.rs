//! A fake herdr-core for tests: JSON-RPC 2.0, one message per line, with scripted terminals,
//! a herdr-app document, a screen and event notifications. It never touches a real core.
#![allow(dead_code)]

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::broadcast;

/// What the test sends to every subscription connection.
#[derive(Clone, Debug)]
pub enum Ctl {
    /// One `event` notification with these params.
    Event(Value),
    /// A `missed` notification with this snapshot.
    Missed(Value),
    /// A `heartbeat`.
    Heartbeat,
    /// Close every subscription connection.
    Drop,
}

#[derive(Default)]
pub struct State {
    pub terminals: Vec<Value>,
    pub doc: Value,
    pub screen: String,
    pub generation: u64,
    /// `data.kind` and message of an error per method.
    pub errors: HashMap<String, (String, String)>,
}

pub struct FakeCore {
    pub state: Arc<Mutex<State>>,
    /// Every request as `(method, params)`.
    pub calls: Arc<Mutex<Vec<(String, Value)>>>,
    pub ctl: broadcast::Sender<Ctl>,
}

impl FakeCore {
    pub fn send(&self, c: Ctl) {
        let _ = self.ctl.send(c);
    }

    /// The params of the calls of `method`, in order.
    pub fn calls_of(&self, method: &str) -> Vec<Value> {
        self.calls.lock().unwrap().iter().filter(|(m, _)| m == method).map(|(_, p)| p.clone()).collect()
    }

    /// The number of `events.subscribe` calls so far.
    pub fn subscribes(&self) -> usize {
        self.calls_of("events.subscribe").len()
    }

    pub async fn wait_subscribes(&self, n: usize) {
        for _ in 0..200 {
            if self.subscribes() >= n {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("no events.subscribe number {n}");
    }
}

/// A terminal record as the core sends it. `status` is a 7501 state or None.
pub fn terminal(address: &str, name: Option<&str>, status: Option<&str>) -> Value {
    json!({
        "address": address, "name": name, "argv": ["claude"], "cwd": "/home/sam/proj",
        "state": "live", "created_ms": 1, "screen": "exact", "cols": 80, "rows": 24, "labels": {},
        "pid": 100, "foreground": {"pid": 101, "name": "claude", "argv": ["claude"], "cwd": "/home/sam/proj/src"},
        "status": status.map(|s| json!({"state": s, "app": "Claude Code", "title": "fix tests", "msg": "Running tests"})),
        "status_ms": 1_700_000_000_000u64, "turn": 3, "title": "term title", "reported": status.is_some(),
    })
}

/// An `event` params value.
pub fn event(kind: &str, terminal: &str, data: Value) -> Value {
    json!({"seq": 1, "type": kind, "terminal": terminal, "data": data})
}

/// A `status` event with a 7501 state.
pub fn status_event(terminal: &str, state: &str) -> Value {
    event("status", terminal, json!({"status": {"state": state, "app": "Claude Code", "title": "fix tests", "msg": ""}, "records": {}, "reported": true}))
}

fn reply(id: &Value, r: Result<Value, (String, String)>) -> Value {
    match r {
        Ok(v) => json!({"jsonrpc": "2.0", "id": id, "result": v}),
        Err((kind, message)) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": message, "data": {"kind": kind}}}),
    }
}

fn answer(st: &State, method: &str, params: &Value) -> Result<Value, (String, String)> {
    if let Some(e) = st.errors.get(method) {
        return Err(e.clone());
    }
    let find = || {
        let a = params["terminal"].as_str().unwrap_or("");
        st.terminals
            .iter()
            .find(|t| t["address"] == a || t["name"] == a)
            .cloned()
            .ok_or_else(|| ("not_found".to_string(), format!("no terminal {a}")))
    };
    match method {
        "hello" => Ok(json!({"generation": st.generation, "version": "0.1.19", "core": {"id": "c1", "name": "studio"},
                             "framed": false, "methods": [], "features": []})),
        "terminal.list" => Ok(json!({"terminals": st.terminals, "hidden_finished": 0, "machines": []})),
        "terminal.get" => find(),
        "terminal.read" => find().map(|_| json!({"text": st.screen, "complete": true, "how": "screen"})),
        "terminal.send" | "terminal.keys" => find().map(|_| json!({"turn": 3, "status": "idle"})),
        "terminal.kill" => find(),
        "doc.get" => Ok(json!({"value": st.doc, "version": 1})),
        "events.subscribe" => Ok(json!({"seq": 0, "terminals": st.terminals})),
        _ => Err(("unknown_method".into(), method.into())),
    }
}

fn note(method: &str, params: Value) -> String {
    format!("{}\n", json!({"jsonrpc": "2.0", "method": method, "params": params}))
}

/// Starts the fake core on `path`.
pub fn spawn(path: &Path, state: State) -> FakeCore {
    let state = Arc::new(Mutex::new(State { generation: if state.generation == 0 { 1 } else { state.generation }, ..state }));
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (ctl, _) = broadcast::channel(256);
    let listener = UnixListener::bind(path).unwrap();
    let (st, cl, tx) = (state.clone(), calls.clone(), ctl.clone());
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else { return };
            let (st, cl, tx) = (st.clone(), cl.clone(), tx.clone());
            tokio::spawn(async move {
                let (r, mut w) = stream.into_split();
                let mut lines = BufReader::new(r).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let req: Value = serde_json::from_str(&line).unwrap();
                    let method = req["method"].as_str().unwrap_or("").to_string();
                    let params = req["params"].clone();
                    // Subscribe to the control bus before the reply, so no notification is lost.
                    let mut bus = (method == "events.subscribe").then(|| tx.subscribe());
                    cl.lock().unwrap().push((method.clone(), params.clone()));
                    let resp = { answer(&st.lock().unwrap(), &method, &params) };
                    let _ = w.write_all(format!("{}\n", reply(&req["id"], resp)).as_bytes()).await;
                    if let Some(bus) = bus.as_mut() {
                        while let Ok(c) = bus.recv().await {
                            let text = match c {
                                Ctl::Event(p) => note("event", p),
                                Ctl::Missed(p) => note("missed", p),
                                Ctl::Heartbeat => note("heartbeat", json!({"seq": 1})),
                                Ctl::Drop => return,
                            };
                            if w.write_all(text.as_bytes()).await.is_err() {
                                return;
                            }
                        }
                        return;
                    }
                }
            });
        }
    });
    FakeCore { state, calls, ctl }
}
