//! `pane.watch`: a streamed screen of one pane. herdlingd reads the pane over the local herdr
//! socket every `interval_ms` and sends an event only when the screen changed, so the network
//! carries changes only. It replaces the 1 s `pane.read` polling of the app.
//!
//! herdr 0.9.5 (protocol 22) returns `revision: 0` on every read, so the revision alone cannot
//! tell a change. The gate sends a screen when the revision or the text differs from the last
//! screen sent. An idle screen gives the same text on each read, so it sends nothing.

use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::herdr::{self, HerdrError};
use crate::rpc::{Ctx, Out};
use crate::types::RpcError;

/// Default time between two reads of the pane.
pub const DEFAULT_INTERVAL_MS: u64 = 80;
/// Lowest and highest accepted `interval_ms`.
pub const MIN_INTERVAL_MS: u64 = 50;
pub const MAX_INTERVAL_MS: u64 = 1000;
/// Rate cap: at most 20 events per second per stream. A burst sends the latest screen.
pub const MIN_EVENT_GAP: Duration = Duration::from_millis(50);
const DEFAULT_LINES: u64 = 200;
const MAX_LINES: u64 = 1000;

/// One screen read from herdr.
#[derive(Debug, Clone, PartialEq)]
pub struct Screen {
    pub revision: u64,
    pub text: String,
    pub truncated: bool,
}

/// Decides which screens go to the app.
#[derive(Default)]
pub struct Gate {
    last: Option<(u64, String)>,
    last_sent: Option<Instant>,
}

impl Gate {
    /// True when `screen` must be sent at `now`: it differs from the last screen sent, and the
    /// last event is at least [`MIN_EVENT_GAP`] old. A screen held back by the rate cap is not
    /// recorded, so the next read sends it (or a newer one).
    pub fn offer(&mut self, screen: &Screen, now: Instant) -> bool {
        let same = self.last.as_ref().is_some_and(|(rev, text)| *rev == screen.revision && *text == screen.text);
        if same {
            return false;
        }
        if self.last_sent.is_some_and(|t| now.duration_since(t) < MIN_EVENT_GAP) {
            return false;
        }
        self.last = Some((screen.revision, screen.text.clone()));
        self.last_sent = Some(now);
        true
    }
}

/// Validated `pane.watch` params.
#[derive(Debug, Clone)]
pub struct WatchParams {
    pub pane_id: String,
    pub lines: u64,
    pub ansi: bool,
    pub interval: Duration,
}

fn bad(message: impl Into<String>) -> RpcError {
    RpcError { code: "bad_request".into(), message: message.into() }
}

impl WatchParams {
    pub fn parse(params: &Value) -> Result<WatchParams, RpcError> {
        let pane_id = params
            .get("pane_id")
            .and_then(Value::as_str)
            .filter(|p| !p.is_empty())
            .ok_or_else(|| bad("pane.watch requires pane_id"))?
            .to_string();
        let lines = params.get("lines").and_then(Value::as_u64).unwrap_or(DEFAULT_LINES).clamp(1, MAX_LINES);
        let ansi = match params.get("format").and_then(Value::as_str) {
            None | Some("text") => false,
            Some("ansi") => true,
            Some(_) => return Err(bad("format must be text or ansi")),
        };
        let ms = params
            .get("interval_ms")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_INTERVAL_MS)
            .clamp(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
        Ok(WatchParams { pane_id, lines, ansi, interval: Duration::from_millis(ms) })
    }

    fn read_params(&self) -> Value {
        json!({
            "pane_id": self.pane_id,
            "source": "recent",
            "lines": self.lines,
            "format": if self.ansi { "ansi" } else { "text" },
            "strip_ansi": !self.ansi,
        })
    }
}

fn screen_of(v: &Value) -> Screen {
    let r = v.get("read").unwrap_or(v);
    Screen {
        revision: r.get("revision").and_then(Value::as_u64).unwrap_or(0),
        text: r.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
        truncated: r.get("truncated").and_then(Value::as_bool).unwrap_or(false),
    }
}

/// Reads the pane on one kept herdr connection. herdr 0.9.0 closes each connection after one
/// answer, so a failed call on an old connection connects again once before it fails.
struct Reader {
    socket: std::path::PathBuf,
    timeout: Duration,
    client: Option<herdr::Client>,
    params: Value,
}

impl Reader {
    async fn read(&mut self) -> Result<Screen, HerdrError> {
        if let Some(c) = self.client.as_mut() {
            match c.call("pane.read", self.params.clone()).await {
                Ok(v) => return Ok(screen_of(&v)),
                Err(e @ HerdrError::Remote { .. }) => return Err(e),
                Err(HerdrError::Unavailable(_)) => self.client = None,
            }
        }
        let mut c = herdr::Client::connect(&self.socket, self.timeout).await?;
        let v = c.call("pane.read", self.params.clone()).await?;
        self.client = Some(c);
        Ok(screen_of(&v))
    }
}

fn event(stream: &str, data: Value) -> Value {
    json!({ "method": "event", "params": { "stream": stream, "data": data } })
}

fn screen_data(s: &Screen) -> Value {
    json!({ "revision": s.revision, "text": s.text, "truncated": s.truncated })
}

/// Starts a `pane.watch` stream. The first read happens before the reply, so the app gets
/// herdr errors (for example `pane_not_found`) as the call error. The first event is that screen.
pub async fn pane_watch(ctx: &Ctx, out: &Out, params: Value) -> Result<Value, RpcError> {
    let p = WatchParams::parse(&params)?;
    let mut reader =
        Reader { socket: ctx.herdr_socket.clone(), timeout: ctx.herdr_timeout, client: None, params: p.read_params() };
    let first = reader.read().await.map_err(|e| match e {
        HerdrError::Unavailable(m) => RpcError { code: "herdr_unavailable".into(), message: m },
        HerdrError::Remote { code, message } => RpcError { code, message },
    })?;
    let out = out.clone();
    let interval = p.interval;
    let stream = ctx.streams.spawn("pane", move |id| async move {
        let mut gate = Gate::default();
        gate.offer(&first, Instant::now());
        if out.send(event(&id, screen_data(&first))).await.is_err() {
            return;
        }
        loop {
            tokio::time::sleep(interval).await;
            let data = match reader.read().await {
                Ok(s) => {
                    if !gate.offer(&s, Instant::now()) {
                        continue;
                    }
                    screen_data(&s)
                }
                // The pane closed or herdr refused the read: tell the app and end.
                Err(HerdrError::Remote { code, message }) => {
                    let _ = out.send(event(&id, json!({ "error": code, "message": message }))).await;
                    return;
                }
                // herdr stopped: the same end as a closed `herdr.subscribe` stream.
                Err(HerdrError::Unavailable(_)) => {
                    let _ = out.send(event(&id, json!({ "closed": true }))).await;
                    return;
                }
            };
            // The output closed (the channel ended): stop reading.
            if out.send(event(&id, data)).await.is_err() {
                return;
            }
        }
    });
    Ok(json!({ "stream": stream }))
}
