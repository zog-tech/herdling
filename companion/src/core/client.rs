//! Client for the herdr-core socket in plain mode: JSON-RPC 2.0, one message per line
//! (herdr-core `schema/README.md`, "Connecting"). Errors carry a stable `data.kind`.
//!
//! After `events.subscribe` the connection carries only notifications: `event`, `heartbeat`
//! (every 15 s) and `missed` (with a fresh snapshot). See [`Subscription`].

use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;

/// The protocol generation that this client speaks.
pub const GENERATION: u64 = 1;

/// A subscription with no line for this long is dead (the core sends a heartbeat every 15 s).
pub const SILENCE_LIMIT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, thiserror::Error)]
pub enum CoreError {
    #[error("herdr-core unavailable: {0}")]
    Unavailable(String),
    #[error("herdr-core error {kind}: {message}")]
    Remote { kind: String, message: String },
}

impl CoreError {
    /// The `data.kind` of a remote error.
    pub fn kind(&self) -> Option<&str> {
        match self {
            CoreError::Remote { kind, .. } => Some(kind),
            CoreError::Unavailable(_) => None,
        }
    }
}

pub struct Client {
    reader: BufReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
    next_id: u64,
    timeout: Duration,
}

/// Reads one JSON line. `Ok(None)` when the core closed the connection. Lines that are not
/// JSON are skipped.
async fn read_json(reader: &mut BufReader<OwnedReadHalf>) -> Result<Option<Value>, CoreError> {
    loop {
        let mut buf = String::new();
        let n = reader.read_line(&mut buf).await.map_err(|e| CoreError::Unavailable(e.to_string()))?;
        if n == 0 {
            return Ok(None);
        }
        if let Ok(v) = serde_json::from_str::<Value>(&buf) {
            return Ok(Some(v));
        }
    }
}

/// The error of a JSON-RPC error object.
fn remote(err: &Value) -> CoreError {
    let kind = err.pointer("/data/kind").and_then(Value::as_str).map(String::from).unwrap_or_else(|| {
        match err.get("code").and_then(Value::as_i64) {
            Some(-32601) => "unknown_method".into(),
            Some(-32602) => "invalid_params".into(),
            _ => "error".into(),
        }
    });
    let message = err.get("message").and_then(Value::as_str).unwrap_or("").to_string();
    CoreError::Remote { kind, message }
}

impl Client {
    /// Connects to the core socket. `timeout` bounds the connect and each `call`.
    pub async fn connect(path: &Path, timeout: Duration) -> Result<Client, CoreError> {
        let stream = tokio::time::timeout(timeout, UnixStream::connect(path))
            .await
            .map_err(|_| CoreError::Unavailable("connect timed out".into()))?
            .map_err(|e| CoreError::Unavailable(e.to_string()))?;
        let (r, w) = stream.into_split();
        Ok(Client { reader: BufReader::new(r), writer: w, next_id: 1, timeout })
    }

    /// One request, bounded by the client timeout.
    pub async fn call(&mut self, method: &str, params: Value) -> Result<Value, CoreError> {
        let timeout = self.timeout;
        self.call_with(method, params, timeout).await
    }

    /// One request, bounded by `timeout`.
    pub async fn call_with(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, CoreError> {
        tokio::time::timeout(timeout, self.call_inner(method, params))
            .await
            .map_err(|_| CoreError::Unavailable("request timed out".into()))?
    }

    async fn call_inner(&mut self, method: &str, params: Value) -> Result<Value, CoreError> {
        let id = self.next_id;
        self.next_id += 1;
        let mut line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string();
        line.push('\n');
        self.writer.write_all(line.as_bytes()).await.map_err(|e| CoreError::Unavailable(e.to_string()))?;
        loop {
            let Some(v) = read_json(&mut self.reader).await? else {
                return Err(CoreError::Unavailable("socket closed".into()));
            };
            if v.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(err) = v.get("error") {
                return Err(remote(err));
            }
            return Ok(v.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    /// `hello` with this client's generation. The result has `generation`, `version`,
    /// `methods` and `features`.
    pub async fn hello(&mut self) -> Result<Value, CoreError> {
        self.call("hello", json!({ "generation": GENERATION })).await
    }

    /// `events.subscribe` with `params`. Returns the snapshot (`seq`, `terminals`) and the
    /// stream of notifications on this connection.
    pub async fn subscribe(mut self, params: Value) -> Result<(Value, Subscription), CoreError> {
        let snapshot = self.call("events.subscribe", params).await?;
        Ok((snapshot, Subscription { reader: self.reader, _writer: self.writer, silence: SILENCE_LIMIT }))
    }
}

/// One notification of a subscription.
#[derive(Debug, Clone, PartialEq)]
pub enum Notice {
    /// `event` params: `{seq, type, terminal?, data}`.
    Event(Value),
    /// `heartbeat` with the current `seq`.
    Heartbeat(u64),
    /// `missed` params: `{seq, terminals}`, a fresh snapshot.
    Missed(Value),
}

/// The notifications of one `events.subscribe` connection. Dropping it closes the connection.
pub struct Subscription {
    reader: BufReader<OwnedReadHalf>,
    _writer: OwnedWriteHalf,
    silence: Duration,
}

impl Subscription {
    /// Changes the silence limit (tests).
    pub fn with_silence(mut self, silence: Duration) -> Subscription {
        self.silence = silence;
        self
    }

    /// The next notification. `None` when the core closed the connection, or sent nothing
    /// (not even a heartbeat) for the silence limit. Not safe to cancel.
    pub async fn next(&mut self) -> Option<Notice> {
        loop {
            let v = tokio::time::timeout(self.silence, read_json(&mut self.reader)).await.ok()?.ok()??;
            let params = v.get("params").cloned().unwrap_or(Value::Null);
            match v.get("method").and_then(Value::as_str) {
                Some("event") => return Some(Notice::Event(params)),
                Some("heartbeat") => return Some(Notice::Heartbeat(params.get("seq").and_then(Value::as_u64).unwrap_or(0))),
                Some("missed") => return Some(Notice::Missed(params)),
                _ => continue,
            }
        }
    }
}
