//! `pane.watch`: a streamed screen of one pane. A core with `terminal.attach` streams the screen
//! with colors ([`crate::core::term_watch`]). An older core is read with `terminal.read` every
//! `interval_ms`, and herdlingd sends an event only when the screen changed, so the network
//! carries changes only. It replaces the 1 s `pane.read` polling of the app.
//!
//! The core gives no revision, so the gate sends a screen when its text differs from the last
//! screen sent. An idle screen gives the same text on each read, so it sends nothing.

use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::core::client::CoreError;
use crate::core::endpoint::CoreSocket;
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
    /// The phone grid `(cols, rows)`, when the app asks to drive a Herdr 2 pane at that size.
    /// Both params or none.
    pub size: Option<(u16, u16)>,
}

/// Bounds for the phone grid of a drive watch.
pub const DRIVE_COLS: (u64, u64) = (20, 500);
pub const DRIVE_ROWS: (u64, u64) = (5, 200);

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
        let n = |k: &str| params.get(k).and_then(Value::as_u64);
        let size = match (n("cols"), n("rows")) {
            (Some(c), Some(r)) => Some((c.clamp(DRIVE_COLS.0, DRIVE_COLS.1) as u16, r.clamp(DRIVE_ROWS.0, DRIVE_ROWS.1) as u16)),
            _ => None,
        };
        Ok(WatchParams { pane_id, lines, ansi, interval: Duration::from_millis(ms), size })
    }
}

/// Reads the screen of a core pane with `terminal.read` (plain text: an older core has no colors).
struct Reader {
    sock: CoreSocket,
    timeout: Duration,
    pane_id: String,
    lines: u64,
}

impl Reader {
    async fn read(&mut self) -> Result<Screen, CoreError> {
        let (text, complete) = crate::core::live::read_text(&self.sock, self.timeout, &self.pane_id, self.lines).await?;
        Ok(Screen { revision: 0, text, truncated: !complete })
    }
}

fn event(stream: &str, data: Value) -> Value {
    json!({ "method": "event", "params": { "stream": stream, "data": data } })
}

fn screen_data(s: &Screen) -> Value {
    json!({ "revision": s.revision, "text": s.text, "truncated": s.truncated })
}

/// Starts a `pane.watch` stream. The first read happens before the reply, so the app gets
/// core errors (for example `pane_not_found`) as the call error. The first event is that screen.
pub async fn pane_watch(ctx: &Ctx, out: &Out, params: Value) -> Result<Value, RpcError> {
    let p = WatchParams::parse(&params)?;
    let Some(sock) = ctx.core_socket.clone() else {
        return Err(RpcError { code: "herdr_unavailable".into(), message: "herdr-core: no core socket on this computer".into() });
    };
    // A core with `terminal.attach` streams the screen with colors. An older core is read with
    // `terminal.read` (plain text) below.
    if let Some(r) = crate::core::term_watch::pane_watch(ctx, out, &p, &sock).await {
        return r;
    }
    let mut reader = Reader { sock, timeout: ctx.herdr_timeout, pane_id: p.pane_id.clone(), lines: p.lines };
    let first = reader.read().await.map_err(crate::core::live::rpc_err)?;
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
                // The core stopped: the same end as a closed `herdr.subscribe` stream.
                Err(CoreError::Unavailable(_)) => {
                    let _ = out.send(event(&id, json!({ "closed": true }))).await;
                    return;
                }
                // The pane closed or the core refused the read: tell the app and end.
                Err(e) => {
                    let e = crate::core::live::rpc_err(e);
                    let _ = out.send(event(&id, json!({ "error": e.code, "message": e.message }))).await;
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
