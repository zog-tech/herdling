//! NDJSON JSON-RPC loop. One request per line in, one response per line out.

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Result;
use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio::task::{AbortHandle, JoinSet};

use crate::claude;
use crate::herdr::{self, HerdrError};
use crate::types::{Hello, RpcError, RpcRequest, RpcResponse};

/// Default bound for a herdr connect or request/response round trip.
pub const HERDR_TIMEOUT: Duration = Duration::from_secs(10);
const AGENT_START_TIMEOUT: Duration = Duration::from_secs(40);
/// The process exits when no request line arrives for this long. The app pings every 15 s.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// The process exits when one stdout write does not finish in this time.
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(30);
/// Messages queued for stdout before senders wait.
const OUT_CAPACITY: usize = 1024;
/// Longest request line accepted, without the newline.
pub const MAX_LINE: usize = 1 << 20;

#[derive(Clone)]
pub struct Ctx {
    pub herdr_socket: PathBuf,
    pub home: PathBuf,
    /// Companion config file, written by `push.register`.
    pub config_path: PathBuf,
    /// `~/.ssh/authorized_keys`, edited by `pair.revoke`.
    pub authorized_keys: PathBuf,
    /// Bound for herdr connect and request/response. Long-lived streams are not bound by it.
    pub herdr_timeout: Duration,
    /// See [`IDLE_TIMEOUT`].
    pub idle_timeout: Duration,
    /// See [`WRITE_TIMEOUT`].
    pub write_timeout: Duration,
    /// Running streams, keyed by stream id. Shared by every clone of the context.
    pub streams: Streams,
    /// Kept between `stats.get` calls: CPU usage is a delta against the last refresh.
    pub stats: Arc<Mutex<sysinfo::System>>,
    /// False until the first `stats.get` has primed the CPU counters.
    pub stats_primed: Arc<AtomicBool>,
    /// Endpoints asked by `usage.get`.
    pub usage_urls: crate::usage::UsageUrls,
    /// Whether `usage.get` may read the Claude token from the macOS keychain.
    pub usage_keychain: bool,
    /// Directories searched for `herdr-automate`.
    pub bin_dirs: Vec<PathBuf>,
    /// Bound for one `summary_command` run.
    pub summary_timeout: Duration,
    /// Bound for one `tts_command` run.
    pub tts_timeout: Duration,
    /// Status start times and resolved logs kept for `agents.preview`.
    pub preview: crate::preview::PreviewState,
}

impl Ctx {
    pub fn new(herdr_socket: PathBuf, home: PathBuf) -> Ctx {
        Ctx {
            herdr_socket,
            config_path: crate::config::default_path(&home),
            authorized_keys: home.join(".ssh/authorized_keys"),
            bin_dirs: crate::automations::default_bin_dirs(&home),
            home,
            herdr_timeout: HERDR_TIMEOUT,
            idle_timeout: IDLE_TIMEOUT,
            write_timeout: WRITE_TIMEOUT,
            streams: Streams::default(),
            stats: Arc::new(Mutex::new(sysinfo::System::new())),
            stats_primed: Arc::new(AtomicBool::new(false)),
            usage_urls: crate::usage::UsageUrls::default(),
            usage_keychain: cfg!(target_os = "macos"),
            summary_timeout: crate::summary::TIMEOUT,
            tts_timeout: crate::tts::TIMEOUT,
            preview: crate::preview::PreviewState::default(),
        }
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

/// Sender side of the single writer task. Bounded, so a stalled stdout makes senders wait.
pub type Out = mpsc::Sender<Value>;

/// Why the request loop stopped.
enum Exit {
    /// Input closed.
    Eof,
    /// No request line for `idle_timeout`, or stdout stalled or closed.
    Dead,
}

/// One read from the input.
enum Line {
    Text(Vec<u8>),
    TooLong,
    Eof,
}

/// Reads one line into `buf` (without the newline). A line longer than `max` bytes is
/// read to its end and discarded, so the input stays in sync.
async fn read_line_capped<R: AsyncBufRead + Unpin>(r: &mut R, buf: &mut Vec<u8>, max: usize) -> std::io::Result<Line> {
    buf.clear();
    let mut too_long = false;
    loop {
        let chunk = r.fill_buf().await?;
        if chunk.is_empty() {
            return Ok(if too_long {
                Line::TooLong
            } else if buf.is_empty() {
                Line::Eof
            } else {
                Line::Text(std::mem::take(buf))
            });
        }
        let (used, done) = match chunk.iter().position(|&b| b == b'\n') {
            Some(i) => (i + 1, true),
            None => (chunk.len(), false),
        };
        if !too_long {
            let content = if done { used - 1 } else { used };
            if buf.len() + content > max {
                too_long = true;
                buf.clear();
            } else {
                buf.extend_from_slice(&chunk[..content]);
            }
        }
        r.consume(used);
        if done {
            if too_long {
                return Ok(Line::TooLong);
            }
            if buf.last() == Some(&b'\r') {
                buf.pop();
            }
            return Ok(Line::Text(std::mem::take(buf)));
        }
    }
}

fn bad_request(message: String) -> Value {
    let resp = RpcResponse { id: None, result: None, error: Some(err("bad_request", message)) };
    serde_json::to_value(resp).unwrap_or(Value::Null)
}

/// Serves requests until the input closes. Also returns when no request line arrives
/// for `ctx.idle_timeout` or a stdout write stalls for `ctx.write_timeout`: an ssh
/// session whose peer vanished never closes stdin, so the process must notice itself.
pub async fn run<R, W>(input: R, output: W, ctx: Ctx) -> Result<()>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let ctx = Arc::new(ctx);
    let (tx, mut rx) = mpsc::channel::<Value>(OUT_CAPACITY);

    let write_timeout = ctx.write_timeout;
    let mut writer = tokio::spawn(async move {
        let mut output = output;
        while let Some(msg) = rx.recv().await {
            let mut line = msg.to_string();
            line.push('\n');
            let write = async {
                output.write_all(line.as_bytes()).await?;
                output.flush().await
            };
            match tokio::time::timeout(write_timeout, write).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) | Err(_) => break,
            }
        }
    });
    let mut writer_done = false;

    let mut input = input;
    let mut buf = Vec::new();
    let mut tasks = JoinSet::new();
    let exit = loop {
        while tasks.try_join_next().is_some() {}
        let read = tokio::select! {
            r = tokio::time::timeout(ctx.idle_timeout, read_line_capped(&mut input, &mut buf, MAX_LINE)) => r,
            _ = &mut writer => {
                writer_done = true;
                break Exit::Dead;
            }
        };
        let line = match read {
            Err(_) => break Exit::Dead,
            Ok(Err(e)) => {
                // Input broke: treat like a vanished peer, but report the error.
                abort_everything(&ctx, &mut tasks, &writer, writer_done).await;
                return Err(e.into());
            }
            Ok(Ok(Line::Eof)) => break Exit::Eof,
            Ok(Ok(Line::TooLong)) => {
                let _ = tx.send(bad_request(format!("request line longer than {MAX_LINE} bytes"))).await;
                continue;
            }
            Ok(Ok(Line::Text(l))) => l,
        };
        let line = match String::from_utf8(line) {
            Ok(l) => l,
            Err(_) => {
                let _ = tx.send(bad_request("request line is not UTF-8".into())).await;
                continue;
            }
        };
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
                    let _ = tx.send(serde_json::to_value(resp).unwrap_or(Value::Null)).await;
                });
            }
            Err(e) => {
                let _ = tx.send(bad_request(format!("invalid request: {e}"))).await;
            }
        }
    };

    match exit {
        Exit::Eof => {
            // Input closed: let in-flight requests finish, stop streams, then drain the writer.
            while tasks.join_next().await.is_some() {}
            ctx.streams.abort_all();
            drop(tx);
            if !writer_done {
                let _ = writer.await;
            }
        }
        Exit::Dead => abort_everything(&ctx, &mut tasks, &writer, writer_done).await,
    }
    Ok(())
}

/// Stops requests, streams (dropping their herdr connections) and the writer.
async fn abort_everything(ctx: &Ctx, tasks: &mut JoinSet<()>, writer: &tokio::task::JoinHandle<()>, writer_done: bool) {
    tasks.shutdown().await;
    ctx.streams.abort_all();
    if !writer_done {
        writer.abort();
    }
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
        "push.register" => push_register(ctx, params).await,
        "pair.revoke" => pair_revoke(ctx, params).await,
        "stats.get" => stats_get(ctx).await,
        "usage.get" => usage_get(ctx).await,
        "automations.list" => automations_list(ctx).await,
        "automations.runs" => automations_runs(ctx, params).await,
        "automations.approve" => automations_approve(ctx, params).await,
        "summary.make" => summary_make(ctx, params).await,
        "tts.make" => tts_make(ctx, params).await,
        "agents.preview" => agents_preview(ctx, params).await,
        other => Err(err("unknown_method", format!("unknown method: {other}"))),
    }
}

async fn thread_get(params: Value) -> Result<Value, RpcError> {
    let path = str_param(&params, "log_path", "thread.get")?.to_string();
    let page = read_page(std::path::PathBuf::from(path), &params).await?;
    serde_json::to_value(page).map_err(|e| err("internal", e.to_string()))
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
    let log_path = path.to_string_lossy().into_owned();
    let page = read_page(path, &params).await?;
    serde_json::to_value(crate::types::SubagentPage { page, log_path }).map_err(|e| err("internal", e.to_string()))
}

async fn read_page(path: std::path::PathBuf, params: &Value) -> Result<crate::types::ThreadPage, RpcError> {
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
    Ok(page)
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

pub fn hostname() -> String {
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
    // `agent.start` waits for the agent to boot, which can take much longer than other calls.
    let timeout = if method == "agent.start" { AGENT_START_TIMEOUT } else { ctx.herdr_timeout };
    let mut c = herdr::Client::connect(&ctx.herdr_socket, timeout).await.map_err(herdr_err)?;
    c.call(&method, p).await.map_err(herdr_err)
}

async fn notify(out: &Out, stream: &str, data: Value) -> bool {
    out.send(json!({ "method": "event", "params": { "stream": stream, "data": data } })).await.is_ok()
}

async fn herdr_subscribe(ctx: &Ctx, out: &Out, params: Value) -> Result<Value, RpcError> {
    // With no explicit list the caller gets the lifecycle events plus status changes of every pane.
    let events: Option<Vec<String>> = match params.get("events") {
        None | Some(Value::Null) => None,
        Some(Value::Array(a)) => Some(
            a.iter()
                .map(|v| v.as_str().map(String::from))
                .collect::<Option<_>>()
                .ok_or_else(|| err("bad_request", "events must be an array of strings"))?,
        ),
        Some(_) => return Err(err("bad_request", "events must be an array of strings")),
    };

    // Subscribe before replying, so the caller sees herdr errors and gets no events before the id.
    let mut events = crate::events::subscribe(&ctx.herdr_socket, ctx.herdr_timeout, events).await.map_err(herdr_err)?;

    let out = out.clone();
    let preview = ctx.preview.clone();
    let stream = ctx.streams.spawn("herdr", move |id| async move {
        loop {
            match events.next().await {
                Some(ev) => {
                    preview.observe_event(&ev);
                    if !notify(&out, &id, ev).await {
                        return;
                    }
                }
                None => {
                    notify(&out, &id, json!({ "closed": true })).await;
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
                    if !items.is_empty() && !notify(&out, &id, json!({ "items": items, "offset": offset })).await {
                        return;
                    }
                }
                Ok(None) => {}
                // The file may be briefly missing. Give up after repeated failures.
                Err(e) => {
                    if failures >= FOLLOW_MAX_FAILURES {
                        let code = if e.kind() == std::io::ErrorKind::NotFound { "not_found" } else { "io_error" };
                        notify(&out, &id, json!({ "error": code })).await;
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

async fn stats_get(ctx: &Ctx) -> Result<Value, RpcError> {
    let (sys, primed) = (ctx.stats.clone(), ctx.stats_primed.clone());
    let stats = tokio::task::spawn_blocking(move || crate::stats::read(&sys, &primed))
        .await
        .map_err(|e| err("internal", e.to_string()))?;
    serde_json::to_value(stats).map_err(|e| err("internal", e.to_string()))
}

async fn usage_get(ctx: &Ctx) -> Result<Value, RpcError> {
    let usage = crate::usage::get(&ctx.home, &ctx.usage_urls, ctx.usage_keychain).await;
    serde_json::to_value(usage).map_err(|e| err("internal", e.to_string()))
}

async fn automations_list(ctx: &Ctx) -> Result<Value, RpcError> {
    let automations = crate::automations::list(&ctx.bin_dirs).await?;
    Ok(json!({ "automations": automations }))
}

async fn automations_runs(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let id = params.get("id").and_then(Value::as_str);
    let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(20).clamp(1, 200);
    let runs = crate::automations::runs(&ctx.bin_dirs, id, limit).await?;
    Ok(json!({ "runs": runs }))
}

async fn automations_approve(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let id = str_param(&params, "id", "automations.approve")?;
    let hash = str_param(&params, "content_hash", "automations.approve")?;
    crate::automations::approve(&ctx.bin_dirs, id, hash).await?;
    Ok(json!({ "approved": true }))
}

async fn load_config(ctx: &Ctx) -> Result<crate::config::Config, RpcError> {
    let path = ctx.config_path.clone();
    tokio::task::spawn_blocking(move || crate::config::load(&path))
        .await
        .map_err(|e| err("internal", e.to_string()))?
        .map_err(|e| err("io_error", format!("{e:#}")))
}

/// Summarizes `text` with the host's `summary_command`. No command gives `no_command`.
async fn summary_make(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let text = str_param(&params, "text", "summary.make")?;
    let cfg = load_config(ctx).await?;
    let argv = crate::hostcmd::argv(cfg.summary_command.as_deref())
        .ok_or_else(|| err("no_command", "no summary_command in the companion config"))?;
    let summary = crate::summary::make(argv, text, ctx.summary_timeout).await?;
    serde_json::to_value(crate::types::Summary { summary }).map_err(|e| err("internal", e.to_string()))
}

/// Speaks `text` with the host's `tts_command`. No command gives `no_command`.
async fn tts_make(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let text = str_param(&params, "text", "tts.make")?;
    let cfg = load_config(ctx).await?;
    let argv = crate::hostcmd::argv(cfg.tts_command.as_deref())
        .ok_or_else(|| err("no_command", "no tts_command in the companion config"))?;
    let audio = crate::tts::make(argv, text, ctx.tts_timeout).await?;
    serde_json::to_value(audio).map_err(|e| err("internal", e.to_string()))
}

/// One preview line per agent (only `pane_ids` when given). See [`crate::preview`].
async fn agents_preview(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let pane_ids: Option<Vec<String>> = match params.get("pane_ids") {
        None | Some(Value::Null) => None,
        Some(Value::Array(a)) => Some(
            a.iter()
                .map(|v| v.as_str().map(String::from))
                .collect::<Option<_>>()
                .ok_or_else(|| err("bad_request", "pane_ids must be an array of strings"))?,
        ),
        Some(_) => return Err(err("bad_request", "pane_ids must be an array of strings")),
    };
    let previews = crate::preview::previews(
        &ctx.herdr_socket,
        ctx.herdr_timeout,
        &ctx.home,
        &ctx.preview,
        pane_ids,
        crate::preview::PANE_TIMEOUT,
    )
    .await
    .map_err(herdr_err)?;
    Ok(json!({ "previews": previews }))
}

async fn push_register(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    use crate::config::{self, Device, Prefs};
    let req = |key: &str| str_param(&params, key, "push.register").map(String::from);
    let (id, host_id, name) = (req("device_id")?, req("host_id")?, req("name")?);
    if id.is_empty() {
        return Err(err("bad_request", "push.register requires device_id"));
    }
    let expo_token = match params.get("expo_token") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(_) => return Err(err("bad_request", "expo_token must be a string or null")),
    };
    let prefs = params.get("prefs");
    let flag = |k: &str| prefs.and_then(|p| p.get(k)).and_then(Value::as_bool);
    let (Some(finished), Some(needs_you)) = (flag("finished"), flag("needs_you")) else {
        return Err(err("bad_request", "push.register requires prefs.finished and prefs.needs_you"));
    };
    let path = ctx.config_path.clone();
    tokio::task::spawn_blocking(move || {
        config::update(&path, |c| {
            let public_key = c.devices.iter().find(|d| d.id == id).and_then(|d| d.public_key.clone());
            config::upsert_device(
                c,
                Device { id, name, host_id, public_key, expo_token, prefs: Prefs { finished, needs_you } },
            );
        })
    })
    .await
    .map_err(|e| err("internal", e.to_string()))?
    .map_err(|e| err("io_error", format!("{e:#}")))?;
    Ok(json!({ "ok": true }))
}

/// Removes the device's `zogssh:` key line from `authorized_keys` and the device from the
/// config. The device must be paired and the key must be the one saved for it, so a call
/// can never remove a line the user added (for example a laptop key).
async fn pair_revoke(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let id = str_param(&params, "device_id", "pair.revoke")?.to_string();
    let key = str_param(&params, "public_key", "pair.revoke")?;
    let key = crate::pair::parse_public_key(key).map_err(|e| err("bad_request", e.to_string()))?;
    let (keys_path, config_path) = (ctx.authorized_keys.clone(), ctx.config_path.clone());
    tokio::task::spawn_blocking(move || -> Result<Value, RpcError> {
        let io = |e: anyhow::Error| err("io_error", format!("{e:#}"));
        let cfg = crate::config::load(&config_path).map_err(io)?;
        let Some(device) = cfg.devices.iter().find(|d| d.id == id) else {
            return Err(err("not_found", "pair.revoke: no paired device with this device_id"));
        };
        if device.public_key.as_deref() != Some(key.as_str()) {
            return Err(err("bad_request", "pair.revoke: public_key is not the key saved for this device"));
        }
        let removed_keys = crate::pair::remove_zogssh_key(&keys_path, &key).map_err(|e| io(e.into()))?;
        let removed_device = crate::config::update(&config_path, |c| {
            let before = c.devices.len();
            c.devices.retain(|d| d.id != id);
            c.devices.len() != before
        })
        .map_err(io)?;
        Ok(json!({ "removed_keys": removed_keys, "removed_device": removed_device }))
    })
    .await
    .map_err(|e| err("internal", e.to_string()))?
}
