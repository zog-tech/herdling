//! NDJSON JSON-RPC loop. One request per line in, one response per line out.

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Result;
use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio::task::AbortHandle;

use crate::claude;
use crate::herdr::{self, HerdrError};
use crate::types::{Hello, RpcError, RpcRequest, RpcResponse};

/// Default bound for a herdr connect or request/response round trip.
pub const HERDR_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub struct Ctx {
    pub herdr_socket: PathBuf,
    pub home: PathBuf,
    /// Bound for herdr connect and request/response. Long-lived streams are not bound by it.
    pub herdr_timeout: Duration,
    /// Running streams, keyed by stream id. Shared by every clone of the context.
    pub streams: Streams,
}

impl Ctx {
    pub fn new(herdr_socket: PathBuf, home: PathBuf) -> Ctx {
        Ctx { herdr_socket, home, herdr_timeout: HERDR_TIMEOUT, streams: Streams::default() }
    }
}

/// Registry of running stream tasks. Stream ids look like `<prefix>:<n>`, with `n`
/// unique per rpc process across all prefixes.
#[derive(Clone, Default)]
pub struct Streams {
    inner: Arc<Mutex<StreamsInner>>,
}

#[derive(Default)]
struct StreamsInner {
    next: u64,
    map: HashMap<String, AbortHandle>,
}

impl Streams {
    /// Spawns `make(id)` as a stream task and returns its id. The task is removed
    /// from the registry when it ends.
    pub fn spawn<F, Fut>(&self, prefix: &str, make: F) -> String
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let mut g = self.inner.lock().unwrap();
        g.next += 1;
        let id = format!("{prefix}:{}", g.next);
        let fut = make(id.clone());
        let this = self.clone();
        let task_id = id.clone();
        // Holding the lock until the handle is inserted means the task cannot
        // remove itself before it is registered.
        let handle = tokio::spawn(async move {
            fut.await;
            this.inner.lock().unwrap().map.remove(&task_id);
        });
        g.map.insert(id.clone(), handle.abort_handle());
        id
    }

    /// Stops a stream. Returns false when the id is unknown or the stream already ended.
    pub fn cancel(&self, id: &str) -> bool {
        match self.inner.lock().unwrap().map.remove(id) {
            Some(h) => {
                h.abort();
                true
            }
            None => false,
        }
    }

    fn abort_all(&self) {
        for (_, h) in self.inner.lock().unwrap().map.drain() {
            h.abort();
        }
    }
}

/// Sender side of the single writer task. Later tasks push notifications here too.
pub type Out = mpsc::UnboundedSender<Value>;

pub async fn run<R, W>(input: R, output: W, ctx: Ctx) -> Result<()>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let ctx = Arc::new(ctx);
    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();

    let writer = tokio::spawn(async move {
        let mut output = output;
        while let Some(msg) = rx.recv().await {
            let mut line = msg.to_string();
            line.push('\n');
            if output.write_all(line.as_bytes()).await.is_err() || output.flush().await.is_err() {
                break;
            }
        }
    });

    let mut lines = input.lines();
    let mut tasks = tokio::task::JoinSet::new();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<RpcRequest>(&line) {
            Ok(req) => {
                let (ctx, tx) = (ctx.clone(), tx.clone());
                tasks.spawn(async move {
                    let resp = match dispatch(&ctx, &tx, &req.method, req.params).await {
                        Ok(result) => RpcResponse { id: Some(req.id), result: Some(result), error: None },
                        Err(error) => RpcResponse { id: Some(req.id), result: None, error: Some(error) },
                    };
                    let _ = tx.send(serde_json::to_value(resp).unwrap_or(Value::Null));
                });
            }
            Err(e) => {
                let resp = RpcResponse {
                    id: None,
                    result: None,
                    error: Some(err("bad_request", format!("invalid request: {e}"))),
                };
                let _ = tx.send(serde_json::to_value(resp).unwrap_or(Value::Null));
            }
        }
    }

    // Input closed: let in-flight requests finish, stop streams, then drain the writer.
    while tasks.join_next().await.is_some() {}
    ctx.streams.abort_all();
    drop(tx);
    let _ = writer.await;
    Ok(())
}

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

/// Add new methods here.
async fn dispatch(ctx: &Ctx, out: &Out, method: &str, params: Value) -> Result<Value, RpcError> {
    match method {
        "hello" => hello(ctx).await,
        "ping" => Ok(json!({})),
        "herdr.call" => herdr_call(ctx, params).await,
        "herdr.subscribe" => herdr_subscribe(ctx, out, params).await,
        "rpc.cancel" => rpc_cancel(ctx, params),
        "thread.get" => thread_get(params).await,
        "thread.subagent" => thread_subagent(params).await,
        "thread.resolve" => thread_resolve(ctx, params).await,
        "thread.follow" => thread_follow(ctx, out, params),
        "sessions.recent" => sessions_recent(ctx, params).await,
        "fs.dirs" => fs_dirs(ctx, params).await,
        other => Err(err("unknown_method", format!("unknown method: {other}"))),
    }
}

async fn thread_get(params: Value) -> Result<Value, RpcError> {
    let path = str_param(&params, "log_path", "thread.get")?.to_string();
    read_page(std::path::PathBuf::from(path), &params).await
}

fn str_param<'a>(params: &'a Value, key: &str, method: &str) -> Result<&'a str, RpcError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| err("bad_request", format!("{method} requires {key}")))
}

async fn thread_subagent(params: Value) -> Result<Value, RpcError> {
    let log = str_param(&params, "log_path", "thread.subagent")?;
    let agent = str_param(&params, "agent_id", "thread.subagent")?;
    let path = claude::subagent_path(std::path::Path::new(log), agent)
        .ok_or_else(|| err("bad_request", "invalid agent_id"))?;
    read_page(path, &params).await
}

async fn read_page(path: std::path::PathBuf, params: &Value) -> Result<Value, RpcError> {
    let before = params.get("before").and_then(Value::as_u64);
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map_or(claude::DEFAULT_LIMIT, |n| n as usize);
    let page = tokio::task::spawn_blocking(move || claude::thread_get(&path, before, limit))
        .await
        .map_err(|e| err("internal", e.to_string()))?
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => err("not_found", e.to_string()),
            _ => err("io_error", e.to_string()),
        })?;
    serde_json::to_value(page).map_err(|e| err("internal", e.to_string()))
}

fn herdr_err(e: HerdrError) -> RpcError {
    match e {
        HerdrError::Unavailable(m) => err("herdr_unavailable", m),
        HerdrError::Remote { code, message } => err(&code, message),
    }
}

async fn hello(ctx: &Ctx) -> Result<Value, RpcError> {
    let mut h = Hello {
        host: hostname(),
        os: if cfg!(target_os = "macos") { "macos" } else { "linux" }.into(),
        zogsshd: env!("CARGO_PKG_VERSION").into(),
        herdr_ok: false,
        herdr_version: None,
        herdr_protocol: None,
    };
    if let Ok(mut c) = herdr::Client::connect(&ctx.herdr_socket, ctx.herdr_timeout).await {
        if let Ok(snap) = c.call("session.snapshot", json!({})).await {
            h.herdr_ok = true;
            let s = snap.get("snapshot").unwrap_or(&snap);
            h.herdr_version = s.get("version").and_then(Value::as_str).map(String::from);
            h.herdr_protocol = s.get("protocol").and_then(Value::as_u64);
        }
    }
    serde_json::to_value(h).map_err(|e| err("internal", e.to_string()))
}

fn hostname() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

async fn herdr_call(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let method = params
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| err("bad_request", "herdr.call requires a method"))?
        .to_string();
    let p = params.get("params").cloned().unwrap_or_else(|| json!({}));
    let mut c = herdr::Client::connect(&ctx.herdr_socket, ctx.herdr_timeout).await.map_err(herdr_err)?;
    c.call(&method, p).await.map_err(herdr_err)
}

/// Event types sent when the caller names none. Only types that need no extra
/// parameters (pane.output_matched, pane.agent_status_changed and pane.scroll_changed
/// need a pane id, so they are left out).
const DEFAULT_EVENTS: &[&str] = &[
    "workspace.created", "workspace.updated", "workspace.metadata_updated", "workspace.renamed",
    "workspace.moved", "workspace.reordered", "workspace.closed", "workspace.focused",
    "worktree.created", "worktree.opened", "worktree.removed",
    "tab.created", "tab.closed", "tab.focused", "tab.renamed", "tab.moved",
    "pane.created", "pane.closed", "pane.updated", "pane.focused", "pane.moved",
    "pane.exited", "pane.agent_detected", "layout.updated",
];

fn notify(out: &Out, stream: &str, data: Value) -> bool {
    out.send(json!({ "method": "event", "params": { "stream": stream, "data": data } })).is_ok()
}

async fn herdr_subscribe(ctx: &Ctx, out: &Out, params: Value) -> Result<Value, RpcError> {
    let types: Vec<String> = match params.get("events") {
        None | Some(Value::Null) => DEFAULT_EVENTS.iter().map(|s| s.to_string()).collect(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|v| v.as_str().map(String::from))
            .collect::<Option<_>>()
            .ok_or_else(|| err("bad_request", "events must be an array of strings"))?,
        Some(_) => return Err(err("bad_request", "events must be an array of strings")),
    };
    let subscriptions: Vec<Value> = types.iter().map(|t| json!({ "type": t })).collect();

    // Subscribe before replying, so the caller sees herdr errors and gets no events before the id.
    let mut c = herdr::Client::connect(&ctx.herdr_socket, ctx.herdr_timeout).await.map_err(herdr_err)?;
    c.call("events.subscribe", json!({ "subscriptions": subscriptions })).await.map_err(herdr_err)?;

    let out = out.clone();
    let stream = ctx.streams.spawn("herdr", move |id| async move {
        loop {
            match c.next_event().await {
                Ok(Some(ev)) => {
                    if !notify(&out, &id, ev) {
                        return;
                    }
                }
                Ok(None) | Err(_) => {
                    notify(&out, &id, json!({ "closed": true }));
                    return;
                }
            }
        }
    });
    Ok(json!({ "stream": stream }))
}

fn rpc_cancel(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let stream = params
        .get("stream")
        .and_then(Value::as_str)
        .ok_or_else(|| err("bad_request", "rpc.cancel requires a stream"))?;
    Ok(json!({ "cancelled": ctx.streams.cancel(stream) }))
}

async fn thread_resolve(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let pane = str_param(&params, "pane_id", "thread.resolve")?;
    let r = claude::resolve(&ctx.herdr_socket, ctx.herdr_timeout, &ctx.home, pane).await.map_err(herdr_err)?;
    serde_json::to_value(r).map_err(|e| err("internal", e.to_string()))
}

/// Consecutive poll errors before a follow stream ends.
const FOLLOW_MAX_FAILURES: u32 = 10;

fn thread_follow(ctx: &Ctx, out: &Out, params: Value) -> Result<Value, RpcError> {
    let path = std::path::PathBuf::from(str_param(&params, "log_path", "thread.follow")?);
    let from = params.get("from").and_then(Value::as_u64).unwrap_or(0);
    if !path.is_file() {
        return Err(err("not_found", format!("no such log: {}", path.display())));
    }
    let out = out.clone();
    let stream = ctx.streams.spawn("thread", move |id| async move {
        let mut follower = claude::Follower::new(&path, from);
        let mut failures = 0u32;
        loop {
            let polled = follower.poll();
            failures = if polled.is_err() { failures + 1 } else { 0 };
            match polled {
                Ok(Some((items, offset))) => {
                    if !items.is_empty() && !notify(&out, &id, json!({ "items": items, "offset": offset })) {
                        return;
                    }
                }
                Ok(None) => {}
                // The file may be briefly missing. Give up after repeated failures.
                Err(e) => {
                    if failures >= FOLLOW_MAX_FAILURES {
                        let code = if e.kind() == std::io::ErrorKind::NotFound { "not_found" } else { "io_error" };
                        notify(&out, &id, json!({ "error": code }));
                        return;
                    }
                }
            }
            tokio::time::sleep(claude::POLL_INTERVAL).await;
        }
    });
    Ok(json!({ "stream": stream }))
}

async fn sessions_recent(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let cwd = str_param(&params, "cwd", "sessions.recent")?.to_string();
    let limit = params.get("limit").and_then(Value::as_u64).map_or(20, |n| n as usize);
    let home = ctx.home.clone();
    let list = tokio::task::spawn_blocking(move || claude::recent_sessions(&home, &cwd, limit))
        .await
        .map_err(|e| err("internal", e.to_string()))?;
    serde_json::to_value(list).map_err(|e| err("internal", e.to_string()))
}

async fn fs_dirs(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let path = params.get("path").and_then(Value::as_str).map(String::from);
    let home = ctx.home.clone();
    tokio::task::spawn_blocking(move || crate::fsdirs::dirs(&home, path.as_deref()))
        .await
        .map_err(|e| err("internal", e.to_string()))?
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => err("not_found", e.to_string()),
            _ => err("io_error", e.to_string()),
        })
}
