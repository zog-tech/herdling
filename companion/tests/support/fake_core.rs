//! A fake herdr-core for tests: JSON-RPC 2.0, one message per line, with scripted terminals,
//! a herdr-app document, a screen and event notifications. With `State.attach`, `hello` with
//! `framed: true` switches a connection to framed mode, where `terminal.attach` streams the
//! scripted paint and the [`Ctl`] output. It never touches a real core.
#![allow(dead_code)]

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
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
    /// Close every subscription connection and every framed connection.
    Drop,
    /// DATA with these bytes on every open attach channel.
    Output(Vec<u8>),
    /// CLOSE with this JSON reason on every open attach channel.
    CloseStream(Value),
    /// RESIZE `(cols, rows)` on every open attach channel.
    Resize(u16, u16),
}

/// The frames that clients sent: `(channel, kind, payload)`.
pub type FrameLog = Arc<Mutex<Vec<(u32, u8, Vec<u8>)>>>;

#[derive(Default)]
pub struct State {
    pub terminals: Vec<Value>,
    pub doc: Value,
    pub screen: String,
    pub generation: u64,
    /// `data.kind` and message of an error per method.
    pub errors: HashMap<String, (String, String)>,
    /// `hello.methods`. None: every method that the fake answers.
    pub methods: Option<Vec<String>>,
    /// A `terminal.send` to a terminal with no status gives it an idle agent status, as if the
    /// typed command started an agent.
    pub send_starts_agent: bool,
    /// The `machines` of `machine.list`.
    pub machines: Vec<Value>,
    /// The core has framed mode and `terminal.attach`.
    pub attach: bool,
    /// The first paint of each attach.
    pub paint: Vec<u8>,
    /// `hello.features` has `automatic_input` and attach replies confirm it.
    pub automatic_input: bool,
    /// A `terminal.send` waits this long before it types, like a core that waits for quiet at
    /// the computer. A connection that closes meanwhile cancels it: it never types.
    pub send_delay: Option<std::time::Duration>,
    /// The texts that a delayed `terminal.send` typed (after its wait).
    pub typed: Vec<String>,
}

/// The methods that the fake answers.
pub const METHODS: &[&str] = &[
    "hello", "terminal.list", "terminal.get", "terminal.read", "terminal.send", "terminal.keys", "terminal.kill",
    "terminal.run", "terminal.label", "doc.get", "events.subscribe", "machine.list",
];

pub struct FakeCore {
    pub state: Arc<Mutex<State>>,
    /// Every request as `(method, params)`.
    pub calls: Arc<Mutex<Vec<(String, Value)>>>,
    pub ctl: broadcast::Sender<Ctl>,
    /// Every frame that a client sent in framed mode: `(channel, kind, payload)`.
    pub frames: FrameLog,
}

impl FakeCore {
    /// The frames that clients sent on attach channels (not channel 0).
    pub fn stream_frames(&self) -> Vec<(u32, u8, Vec<u8>)> {
        self.frames.lock().unwrap().iter().filter(|f| f.0 != 0).cloned().collect()
    }

    /// Waits until `method` was called `n` times.
    pub async fn wait_calls(&self, method: &str, n: usize) {
        for _ in 0..250 {
            if self.calls_of(method).len() >= n {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("no {method} number {n}");
    }

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

/// The record of an agent `app` (for example "Claude Code" or "Codex") with the 7501 `state`,
/// in `cwd`, with the foreground process `pid`.
pub fn agent_at(address: &str, app: &str, state: &str, cwd: &str, pid: u64) -> Value {
    let name = app.split(' ').next().unwrap_or(app).to_lowercase();
    json!({
        "address": address, "name": null, "argv": ["zsh"], "cwd": cwd, "state": "live", "labels": {},
        "pid": 100, "foreground": {"pid": pid, "name": name, "argv": [name], "cwd": cwd},
        "status": {"state": state, "app": app, "title": "", "msg": ""},
        "status_ms": 1_700_000_000_000u64, "title": "term title",
    })
}

/// A fake core on `dir/core.sock` and a context that reaches it, with `home` as the home folder.
pub fn with_ctx(dir: &Path, home: std::path::PathBuf, state: State) -> (herdlingd::rpc::Ctx, FakeCore) {
    let sock = dir.join("core.sock");
    let core = spawn(&sock, state);
    let mut ctx = herdlingd::rpc::Ctx::new(home);
    ctx.core_socket = Some(herdlingd::core::endpoint::CoreSocket::fixed(sock));
    (ctx, core)
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

fn answer(st: &mut State, method: &str, params: &Value) -> Result<Value, (String, String)> {
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
        "hello" => {
            let mut methods = st.methods.clone().unwrap_or_else(|| METHODS.iter().map(|m| m.to_string()).collect());
            // `terminal.attach` and framed mode only with `State.attach`.
            methods.retain(|m| m != "terminal.attach");
            if st.attach {
                methods.push("terminal.attach".into());
            }
            let framed = st.attach && params["framed"] == true;
            Ok(json!({"generation": st.generation, "version": "0.1.19", "core": {"id": "c1", "name": "studio"},
                      "framed": framed, "methods": methods, "features": match (st.attach, st.automatic_input) {
                          (true, true) => json!(["framed", "attach", "automatic_input"]),
                          (true, false) => json!(["framed", "attach"]),
                          _ => json!([]),
                      }}))
        }
        "terminal.list" => Ok(json!({"terminals": st.terminals, "hidden_finished": 0, "machines": []})),
        "terminal.get" => find(),
        "machine.list" => Ok(json!({"machines": st.machines})),
        "terminal.read" => find().map(|_| json!({"text": st.screen, "complete": true, "how": "screen"})),
        "terminal.send" | "terminal.keys" => {
            let t = find()?;
            if method == "terminal.send" && st.send_starts_agent && t["status"].is_null() {
                let a = t["address"].clone();
                let rec = st.terminals.iter_mut().find(|t| t["address"] == a).unwrap();
                rec["status"] = json!({"state": "idle", "app": "Claude Code"});
            }
            Ok(json!({"turn": 3, "status": "idle"}))
        }
        "terminal.kill" => {
            let t = find()?;
            let a = t["address"].clone();
            let rec = st.terminals.iter_mut().find(|t| t["address"] == a).unwrap();
            rec["state"] = json!("finished");
            Ok(rec.clone())
        }
        "terminal.run" => {
            let address = format!("t{}", st.terminals.len() + 1);
            let t = json!({
                "address": address, "name": null, "argv": params["argv"], "cwd": params["cwd"], "state": "live",
                "labels": params.get("labels").cloned().unwrap_or(json!({})), "pid": 500,
                "foreground": {"pid": 500, "name": "zsh", "argv": ["zsh"], "cwd": params["cwd"]},
                "status": null, "title": "zsh", "keep": params["keep"],
            });
            st.terminals.push(t.clone());
            Ok(t)
        }
        "terminal.label" => {
            let t = find()?;
            let a = t["address"].clone();
            let rec = st.terminals.iter_mut().find(|t| t["address"] == a).unwrap();
            for (k, v) in params["labels"].as_object().cloned().unwrap_or_default() {
                if v == "" {
                    rec["labels"].as_object_mut().unwrap().remove(&k);
                } else {
                    rec["labels"][k] = v;
                }
            }
            Ok(rec.clone())
        }
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
    let frames = Arc::new(Mutex::new(Vec::new()));
    let (ctl, _) = broadcast::channel(256);
    let listener = UnixListener::bind(path).unwrap();
    let (st, cl, tx, frames2) = (state.clone(), calls.clone(), ctl.clone(), frames.clone());
    tokio::spawn(async move {
        let frames = frames2;
        loop {
            let Ok((stream, _)) = listener.accept().await else { return };
            let (st, cl, tx) = (st.clone(), cl.clone(), tx.clone());
            let fr = frames.clone();
            tokio::spawn(async move {
                let (r, mut w) = stream.into_split();
                let mut reader = BufReader::new(r);
                loop {
                    let mut line = String::new();
                    if !matches!(reader.read_line(&mut line).await, Ok(n) if n > 0) {
                        return;
                    }
                    let req: Value = serde_json::from_str(&line).unwrap();
                    let method = req["method"].as_str().unwrap_or("").to_string();
                    let params = req["params"].clone();
                    // Subscribe to the control bus before the reply, so no notification is lost.
                    let mut bus = (method == "events.subscribe").then(|| tx.subscribe());
                    cl.lock().unwrap().push((method.clone(), params.clone()));
                    let delay = if method == "terminal.send" { st.lock().unwrap().send_delay } else { None };
                    if let Some(d) = delay {
                        // The wait of the core. A closed connection cancels the send.
                        let mut rest = String::new();
                        tokio::select! {
                            _ = tokio::time::sleep(d) => {}
                            _ = reader.read_line(&mut rest) => return,
                        }
                        let text = params["text"].as_str().unwrap_or("").to_string();
                        st.lock().unwrap().typed.push(text);
                    }
                    let resp = { answer(&mut st.lock().unwrap(), &method, &params) };
                    let framed = method == "hello" && resp.as_ref().is_ok_and(|r| r["framed"] == true);
                    let framed_bus = framed.then(|| tx.subscribe());
                    let _ = w.write_all(format!("{}\n", reply(&req["id"], resp)).as_bytes()).await;
                    if let Some(bus) = framed_bus {
                        framed_loop(reader, w, bus, st, cl, fr).await;
                        return;
                    }
                    if let Some(bus) = bus.as_mut() {
                        while let Ok(c) = bus.recv().await {
                            let text = match c {
                                Ctl::Event(p) => note("event", p),
                                Ctl::Missed(p) => note("missed", p),
                                Ctl::Heartbeat => note("heartbeat", json!({"seq": 1})),
                                Ctl::Drop => return,
                                _ => continue,
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
    FakeCore { state, calls, ctl, frames }
}

fn frame(channel: u32, kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = channel.to_le_bytes().to_vec();
    out.push(kind);
    out.extend((payload.len() as u32).to_le_bytes());
    out.extend(payload);
    out
}

async fn read_frame(r: &mut BufReader<tokio::net::unix::OwnedReadHalf>) -> Option<(u32, u8, Vec<u8>)> {
    let mut h = [0u8; 9];
    r.read_exact(&mut h).await.ok()?;
    let len = u32::from_le_bytes([h[5], h[6], h[7], h[8]]) as usize;
    let mut p = vec![0u8; len];
    r.read_exact(&mut p).await.ok()?;
    Some((u32::from_le_bytes([h[0], h[1], h[2], h[3]]), h[4], p))
}

/// A connection in framed mode: JSON-RPC on channel 0, attach streams on their channels.
async fn framed_loop(
    mut reader: BufReader<tokio::net::unix::OwnedReadHalf>,
    mut w: tokio::net::unix::OwnedWriteHalf,
    mut bus: broadcast::Receiver<Ctl>,
    st: Arc<Mutex<State>>,
    cl: Arc<Mutex<Vec<(String, Value)>>>,
    frames: FrameLog,
) {
    let mut open: Vec<u32> = vec![];
    let mut next = 1u32;
    loop {
        let mut out: Vec<u8> = vec![];
        tokio::select! {
            f = read_frame(&mut reader) => {
                let Some((channel, kind, payload)) = f else { return };
                frames.lock().unwrap().push((channel, kind, payload.clone()));
                if channel == 0 && kind == 0 {
                    let req: Value = serde_json::from_slice(&payload).unwrap();
                    let method = req["method"].as_str().unwrap_or("").to_string();
                    let params = req["params"].clone();
                    cl.lock().unwrap().push((method.clone(), params.clone()));
                    let mut st = st.lock().unwrap();
                    if method == "terminal.attach" {
                        let mut found = answer(&mut st, "terminal.get", &params);
                        if let Some(e) = st.errors.get("terminal.attach") {
                            found = Err(e.clone());
                        }
                        match found {
                            Ok(t) => {
                                let ch = next;
                                next += 1;
                                open.push(ch);
                                let r = json!({"channel": ch, "terminal": t, "resize_notifications": true, "automatic_input": st.automatic_input});
                                out.extend(frame(0, 0, reply(&req["id"], Ok(r)).to_string().as_bytes()));
                                let (c, r) = if params["observe"] == true {
                                    (t["cols"].as_u64().unwrap_or(80) as u16, t["rows"].as_u64().unwrap_or(24) as u16)
                                } else {
                                    (params["cols"].as_u64().unwrap_or(80) as u16, params["rows"].as_u64().unwrap_or(24) as u16)
                                };
                                out.extend(frame(ch, 3, &[c.to_le_bytes(), r.to_le_bytes()].concat()));
                                out.extend(frame(ch, 0, &st.paint));
                            }
                            Err(e) => out.extend(frame(0, 0, reply(&req["id"], Err(e)).to_string().as_bytes())),
                        }
                    } else {
                        let resp = answer(&mut st, &method, &params);
                        out.extend(frame(0, 0, reply(&req["id"], resp).to_string().as_bytes()));
                    }
                } else if kind == 2 && open.contains(&channel) {
                    open.retain(|c| *c != channel);
                    out.extend(frame(channel, 2, &[]));
                }
            }
            c = bus.recv() => {
                let Ok(c) = c else { return };
                for ch in &open {
                    match &c {
                        Ctl::Output(b) => out.extend(frame(*ch, 0, b)),
                        Ctl::CloseStream(reason) => out.extend(frame(*ch, 2, reason.to_string().as_bytes())),
                        Ctl::Resize(c, r) => out.extend(frame(*ch, 3, &[c.to_le_bytes(), r.to_le_bytes()].concat())),
                        _ => {}
                    }
                }
                match c {
                    Ctl::Drop => return,
                    Ctl::CloseStream(_) => open.clear(),
                    _ => {}
                }
            }
        }
        if !out.is_empty() && w.write_all(&out).await.is_err() {
            return;
        }
    }
}
