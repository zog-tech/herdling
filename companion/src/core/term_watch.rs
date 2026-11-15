//! `pane.watch` of a Herdr 2 pane: a `terminal.attach` stream on a framed core connection, fed
//! into [`super::screen::Emulator`], sent as herdr 1 screen events. Thin I/O: the stream life is
//! in [`super::attach`], the wire format in [`super::frame`].
//!
//! By default herdlingd attaches as a watcher (`observe: true`): the core never takes its size,
//! keys or focus. In drive mode (the phone asked for its own grid) it attaches as a driver, so
//! the core lays the terminal out at that size while the stream lives. In both modes herdlingd
//! sends only CREDIT and CLOSE on the stream channel: typing goes through `terminal.send`.

use std::collections::{HashMap, VecDeque};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;

use super::attach::{self, Config, Effect, Ending, Failure, Input, State};
use super::client::{remote, CoreError, GENERATION};
use super::endpoint::CoreSocket;
use super::frame::{self, Decoder, Frame, CLOSE, DATA, RESIZE};
use super::screen::Emulator;
use crate::rpc::Out;

/// How herdlingd attaches.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Mode {
    /// A watcher: never sets the size.
    Watch,
    /// A driver at the phone grid: the terminal takes this size while the stream lives.
    Drive { cols: u16, rows: u16 },
}

/// One framed core connection.
pub struct Conn {
    reader: BufReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
    dec: Decoder,
}

impl Conn {
    /// The next frame. `Ok(None)` when the core closed the connection. Safe to cancel: only the
    /// socket read waits, and the decoder keeps what was read.
    async fn frame(&mut self) -> Result<Option<Frame>, CoreError> {
        let mut buf = [0u8; 64 * 1024];
        loop {
            match self.dec.next_frame() {
                Ok(Some(f)) => return Ok(Some(f)),
                Ok(None) => {}
                Err(e) => return Err(CoreError::Unavailable(format!("frame of {} bytes", e.0))),
            }
            let n = self.reader.read(&mut buf).await.map_err(|e| CoreError::Unavailable(e.to_string()))?;
            if n == 0 {
                return Ok(None);
            }
            self.dec.push(&buf[..n]);
        }
    }

    async fn write(&mut self, bytes: &[u8]) -> Result<(), CoreError> {
        self.writer.write_all(bytes).await.map_err(|e| CoreError::Unavailable(e.to_string()))
    }
}

/// An open attach stream.
pub struct Attached {
    pub conn: Conn,
    pub channel: u32,
    pub cols: u16,
    pub rows: u16,
    /// Stream frames that came before the attach reply.
    pub early: Vec<Frame>,
}

/// Why [`open`] failed.
#[derive(Debug)]
pub enum OpenError {
    /// The core has no framed mode or no `terminal.attach`: use `terminal.read`.
    NoAttach,
    Core(CoreError),
}

impl From<CoreError> for OpenError {
    fn from(e: CoreError) -> Self {
        OpenError::Core(e)
    }
}

fn size_of(t: &Value, key: &str, default: u16) -> u16 {
    t.get(key).and_then(Value::as_u64).and_then(|n| u16::try_from(n).ok()).filter(|n| *n > 0).unwrap_or(default)
}

/// Connects, switches to framed mode and attaches to terminal `addr` with `history` lines.
pub async fn open(sock: &CoreSocket, timeout: Duration, addr: &str, history: usize, mode: Mode) -> Result<Attached, OpenError> {
    tokio::time::timeout(timeout, open_inner(sock, addr, history, mode))
        .await
        .map_err(|_| OpenError::Core(CoreError::Unavailable("attach timed out".into())))?
}

async fn open_inner(sock: &CoreSocket, addr: &str, history: usize, mode: Mode) -> Result<Attached, OpenError> {
    let stream = UnixStream::connect(sock.current()).await.map_err(|e| CoreError::Unavailable(e.to_string()))?;
    let (r, w) = stream.into_split();
    let mut conn = Conn { reader: BufReader::new(r), writer: w, dec: Decoder::default() };
    let hello = json!({"jsonrpc": "2.0", "id": 1, "method": "hello", "params": {"generation": GENERATION, "framed": true}});
    conn.write(format!("{hello}\n").as_bytes()).await?;
    let mut line = String::new();
    let n = conn.reader.read_line(&mut line).await.map_err(|e| CoreError::Unavailable(e.to_string()))?;
    if n == 0 {
        return Err(CoreError::Unavailable("socket closed".into()).into());
    }
    let reply: Value = serde_json::from_str(&line).map_err(|e| CoreError::Unavailable(e.to_string()))?;
    if let Some(err) = reply.get("error") {
        return Err(remote(err).into());
    }
    let h = reply.get("result").cloned().unwrap_or(Value::Null);
    let lists = h.get("methods").and_then(Value::as_array).is_some_and(|m| m.iter().any(|x| x == "terminal.attach"));
    if h.get("framed") != Some(&Value::Bool(true)) || !lists {
        return Err(OpenError::NoAttach);
    }
    let (observe, cols, rows) = match mode {
        // A watcher's size is not used; the core wants one.
        Mode::Watch => (true, 80, 24),
        Mode::Drive { cols, rows } => (false, cols, rows),
    };
    let params = json!({
        "terminal": addr, "observe": observe, "resize_notifications": true,
        "history": history, "cols": cols, "rows": rows,
    });
    conn.write(&frame::rpc(&json!({"jsonrpc": "2.0", "id": 2, "method": "terminal.attach", "params": params}))).await?;
    let mut early = Vec::new();
    loop {
        let Some(f) = conn.frame().await? else {
            return Err(CoreError::Unavailable("socket closed".into()).into());
        };
        if f.channel != 0 {
            early.push(f);
            continue;
        }
        let Ok(msg) = serde_json::from_slice::<Value>(&f.payload) else { continue };
        if msg.get("id").and_then(Value::as_u64) != Some(2) {
            continue;
        }
        if let Some(err) = msg.get("error") {
            return Err(remote(err).into());
        }
        let r = msg.get("result").cloned().unwrap_or(Value::Null);
        let channel = r
            .get("channel")
            .and_then(Value::as_u64)
            .and_then(|c| u32::try_from(c).ok())
            .ok_or_else(|| CoreError::Unavailable("attach gave no channel".into()))?;
        let t = r.get("terminal").cloned().unwrap_or(Value::Null);
        early.retain(|f| f.channel == channel);
        return Ok(Attached { conn, channel, cols: size_of(&t, "cols", cols), rows: size_of(&t, "rows", rows), early });
    }
}

/// The attach input of a core error: a missing or finished terminal ends the stream; the rest
/// is tried again.
pub fn failure(e: CoreError) -> Failure {
    match e.kind() {
        None | Some("unavailable") => Failure::Unavailable(e.to_string()),
        Some(_) => {
            let r = super::live::rpc_err(e);
            Failure::Gone { code: r.code, message: r.message }
        }
    }
}

/// What a running watch knows about its pane, for `pane.get`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fact {
    pub alternate: bool,
    pub rows: u16,
    pub history: usize,
}

/// The facts of the running watches of one `rpc` process, by pane id. Each entry names the
/// stream that wrote it, so the end of one stream does not remove the entry of another.
#[derive(Clone, Default)]
pub struct Facts(Arc<Mutex<HashMap<String, (String, Fact)>>>);

impl Facts {
    pub fn get(&self, pane: &str) -> Option<Fact> {
        self.0.lock().unwrap().get(pane).map(|(_, f)| *f)
    }

    fn set(&self, pane: &str, stream: &str, fact: Fact) {
        self.0.lock().unwrap().insert(pane.to_string(), (stream.to_string(), fact));
    }

    fn remove(&self, pane: &str, stream: &str) {
        let mut m = self.0.lock().unwrap();
        if m.get(pane).is_some_and(|(s, _)| s == stream) {
            m.remove(pane);
        }
    }
}

/// Removes the facts of a stream when its task ends or is stopped.
struct FactGuard {
    facts: Facts,
    pane: String,
    stream: String,
}

impl Drop for FactGuard {
    fn drop(&mut self) {
        self.facts.remove(&self.pane, &self.stream);
    }
}

/// Everything that the stream task needs.
pub struct Watch {
    pub sock: CoreSocket,
    pub timeout: Duration,
    pub pane_id: String,
    pub addr: String,
    pub lines: usize,
    pub ansi: bool,
    pub interval: Duration,
    pub mode: Mode,
    pub facts: Facts,
}

fn event(stream: &str, data: Value) -> Value {
    json!({ "method": "event", "params": { "stream": stream, "data": data } })
}

/// The stream task: runs [`attach::step`] from the first open attach until the stream ends, the
/// app stops it, or the output closes.
pub async fn run(w: Watch, first: Attached, out: Out, stream: String) {
    let _guard = FactGuard { facts: w.facts.clone(), pane: w.pane_id.clone(), stream: stream.clone() };
    let cfg = Config { interval: w.interval };
    let mut state = attach::start(1);
    let mut gen = 1u64;
    let mut emu: Option<Emulator> = None;
    let mut last_text: Option<String> = None;
    let mut pending: VecDeque<Input> = VecDeque::new();
    pending.push_back(Input::Attached { gen, channel: first.channel, cols: first.cols, rows: first.rows });
    let channel = first.channel;
    pending.extend(first.early.into_iter().filter_map(|f| frame_input(gen, channel, f)));
    let mut conn = Some((first.conn, first.channel));
    loop {
        let input = match pending.pop_front() {
            Some(i) => i,
            None => {
                let wake = attach::wake(&state, &cfg);
                let sleep = async {
                    match wake {
                        Some(t) => tokio::time::sleep_until(t.into()).await,
                        None => std::future::pending().await,
                    }
                };
                match conn.as_mut() {
                    Some((c, ch)) => {
                        let ch = *ch;
                        tokio::select! {
                            f = c.frame() => match f {
                                Ok(Some(f)) => match frame_input(gen, ch, f) {
                                    Some(i) => i,
                                    None => continue,
                                },
                                _ => Input::Closed { gen },
                            },
                            _ = sleep => Input::Tick,
                        }
                    }
                    None if wake.is_some() => {
                        sleep.await;
                        Input::Tick
                    }
                    // No connection and nothing to wait for: the state machine has ended.
                    None => return,
                }
            }
        };
        if matches!(input, Input::Closed { .. }) {
            conn = None;
        }
        let s = attach::step(state, input, Instant::now(), &cfg);
        state = s.state;
        for e in s.effects {
            match e {
                Effect::Connect { gen: g } => {
                    gen = g;
                    match open(&w.sock, w.timeout, &w.addr, w.lines, w.mode).await {
                        Ok(a) => {
                            pending.push_back(Input::Attached { gen, channel: a.channel, cols: a.cols, rows: a.rows });
                            let ch = a.channel;
                            pending.extend(a.early.into_iter().filter_map(|f| frame_input(gen, ch, f)));
                            conn = Some((a.conn, a.channel));
                        }
                        Err(OpenError::NoAttach) => pending.push_back(Input::Failed {
                            gen,
                            failure: Failure::Gone { code: "unsupported".into(), message: "herdr-core has no terminal.attach".into() },
                        }),
                        Err(OpenError::Core(e)) => pending.push_back(Input::Failed { gen, failure: failure(e) }),
                    }
                }
                Effect::Reset { cols, rows } => emu = Some(Emulator::new(cols, rows, w.lines)),
                Effect::Feed(bytes) => {
                    let ok = emu.as_mut().is_some_and(|m| catch_unwind(AssertUnwindSafe(|| m.feed(&bytes))).is_ok());
                    if !ok {
                        // The emulator failed on these bytes: start again with a fresh one.
                        emu = None;
                        conn = None;
                        pending.push_back(Input::Closed { gen });
                    }
                }
                Effect::Resize { cols, rows } => {
                    if let Some(m) = emu.as_mut() {
                        if catch_unwind(AssertUnwindSafe(|| m.resize(cols, rows))).is_err() {
                            emu = None;
                            conn = None;
                            pending.push_back(Input::Closed { gen });
                        }
                    }
                }
                Effect::Credit { channel, n } => {
                    if let Some((c, _)) = conn.as_mut() {
                        if c.write(&frame::credit(channel, n)).await.is_err() {
                            conn = None;
                            pending.push_back(Input::Closed { gen });
                        }
                    }
                }
                Effect::Emit => {
                    let Some(m) = emu.as_mut() else { continue };
                    let Ok(r) = catch_unwind(AssertUnwindSafe(|| m.render(w.ansi))) else {
                        emu = None;
                        conn = None;
                        pending.push_back(Input::Closed { gen });
                        continue;
                    };
                    w.facts.set(&w.pane_id, &stream, Fact { alternate: r.alternate, rows: r.rows, history: r.history });
                    if last_text.as_deref() == Some(r.text.as_str()) {
                        continue;
                    }
                    let data = json!({ "revision": 0, "text": r.text, "truncated": r.history >= w.lines && w.lines > 0 });
                    last_text = Some(r.text);
                    if out.send(event(&stream, data)).await.is_err() {
                        return;
                    }
                }
                Effect::End(ending) => {
                    let data = match ending {
                        Ending::Error { code, message } => json!({ "error": code, "message": message }),
                        Ending::Closed => json!({ "closed": true }),
                    };
                    let _ = out.send(event(&stream, data)).await;
                    return;
                }
            }
        }
        if state == State::Ended {
            return;
        }
    }
}

/// The input of a frame on the stream `channel` of attempt `gen`. Other channels give none.
fn frame_input(gen: u64, channel: u32, f: Frame) -> Option<Input> {
    if f.channel != channel {
        return None;
    }
    match f.kind {
        DATA => Some(Input::Data { gen, bytes: f.payload }),
        RESIZE => frame::size(&f.payload).map(|(cols, rows)| Input::Resize { gen, cols, rows }),
        CLOSE => Some(Input::Closed { gen }),
        _ => None,
    }
}

/// `pane.watch` of the core pane `p.pane_id` through `terminal.attach`. The first attach runs
/// before the reply, so a missing terminal is the call error. None when the core has no
/// `terminal.attach`: the caller reads with `terminal.read`.
pub async fn pane_watch(
    ctx: &crate::rpc::Ctx,
    out: &Out,
    p: &crate::watch::WatchParams,
    sock: &CoreSocket,
) -> Option<Result<Value, crate::types::RpcError>> {
    let not_found = || crate::types::RpcError { code: "pane_not_found".into(), message: format!("no terminal {}", p.pane_id) };
    let Some(addr) = super::project::address(&p.pane_id) else {
        return Some(Err(not_found()));
    };
    let mode = Mode::Watch;
    let first = match open(sock, ctx.herdr_timeout, addr, p.lines as usize, mode).await {
        Ok(a) => a,
        Err(OpenError::NoAttach) => return None,
        Err(OpenError::Core(e)) => return Some(Err(super::live::rpc_err(e))),
    };
    let w = Watch {
        sock: sock.clone(),
        timeout: ctx.herdr_timeout,
        pane_id: p.pane_id.clone(),
        addr: addr.to_string(),
        lines: p.lines as usize,
        ansi: p.ansi,
        interval: p.interval,
        mode,
        facts: ctx.term_facts.clone(),
    };
    let out = out.clone();
    let stream = ctx.streams.spawn("pane", move |id| run(w, first, out, id));
    Some(Ok(json!({ "stream": stream })))
}
