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
use crate::transcript;
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
/// Longest request line accepted, without the newline. An `stt.make` of the largest
/// recording (25 MiB, about 33.4 MiB as base64) must fit.
pub const MAX_LINE: usize = 34 << 20;

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
    /// Bound for one `stt_command` run.
    pub stt_timeout: Duration,
    /// Status start times and resolved logs kept for `agents.preview`.
    pub preview: crate::preview::PreviewState,
    /// Settings for `update.check` and `update.apply`. None turns updates off: `Ctx::new`
    /// leaves it unset, so a test never downloads or replaces a binary. `main` sets it.
    pub update: Option<crate::update::UpdateCtx>,
    /// Runs the system commands of `hello.boot`, `boot.check` and `mac.open_settings`. None
    /// turns them off: `Ctx::new` leaves it unset, so a test never runs a real system command.
    /// `main` sets it.
    pub sys: Option<Arc<dyn crate::boot::SysRunner>>,
    /// The OS that the boot check and `mac.open_settings` act for. Tests can change it.
    pub host_os: crate::boot::Os,
    /// The last boot state, see [`crate::boot::CACHE_TTL`].
    pub boot_cache: crate::boot::BootCache,
    /// Keeps typing calls to one pane in arrival order, see [`crate::input_order`].
    pub input_order: crate::input_order::InputOrder,
    /// The last listener list of `ports.list` and `preview.open`, see [`crate::ports::CACHE_TTL`].
    pub ports_cache: crate::ports::PortsCache,
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
            stt_timeout: crate::stt::TIMEOUT,
            preview: crate::preview::PreviewState::default(),
            update: None,
            sys: None,
            host_os: crate::boot::Os::current(),
            boot_cache: crate::boot::BootCache::default(),
            input_order: crate::input_order::InputOrder::default(),
            ports_cache: crate::ports::PortsCache::default(),
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
                // Taken here, in arrival order, so typing calls to one pane reach herdr in order.
                let mut turn = ctx.input_order.take_for(&req.method, &req.params);
                tasks.spawn(async move {
                    if let Some(t) = turn.as_mut() {
                        t.wait().await;
                    }
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

/// Every method name that `dispatch` accepts. `hello` sends this list to the app.
/// Add a new method here and in `dispatch`. A test keeps the two the same.
pub const METHODS: &[&str] = &[
    "hello",
    "ping",
    "herdr.call",
    "herdr.subscribe",
    "rpc.cancel",
    "thread.get",
    "thread.subagent",
    "thread.resolve",
    "thread.follow",
    "sessions.recent",
    "fs.dirs",
    "push.register",
    "pair.revoke",
    "stats.get",
    "usage.get",
    "automations.list",
    "automations.runs",
    "automations.approve",
    "summary.make",
    "tts.make",
    "agents.preview",
    "commands.list",
    "files.put",
    "stt.make",
    "update.check",
    "update.apply",
    "boot.check",
    "mac.open_settings",
    "git.status",
    "git.diff",
    "git.worktree_add",
    "pane.watch",
    "agents.installed",
    "pane.answer",
    "ports.list",
    "preview.open",
    "preview.close",
];

/// Add new methods to `METHODS` too.
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
        "commands.list" => commands_list(ctx, params).await,
        "files.put" => files_put(ctx, params).await,
        "stt.make" => stt_make(ctx, params).await,
        "update.check" => update_check(ctx, params).await,
        "update.apply" => update_apply(ctx, params).await,
        "boot.check" => boot_check(ctx).await,
        "mac.open_settings" => mac_open_settings(ctx, params).await,
        "git.status" => git_status(ctx, params).await,
        "git.diff" => git_diff(ctx, params).await,
        "git.worktree_add" => git_worktree_add(ctx, params).await,
        "pane.watch" => crate::watch::pane_watch(ctx, out, params).await,
        "agents.installed" => agents_installed(ctx).await,
        "pane.answer" => pane_answer(ctx, params).await,
        "ports.list" => ports_list(ctx, params).await,
        "preview.open" => preview_open(ctx, params).await,
        "preview.close" => preview_close(ctx, params).await,
        other => Err(err("unknown_method", format!("unknown method: {other}"))),
    }
}

async fn thread_get(params: Value) -> Result<Value, RpcError> {
    let path = str_param(&params, "log_path", "thread.get")?.to_string();
    let page = read_page(path, &params).await?;
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
    let running = claude::subagents::transcript_running(&path, std::time::SystemTime::now());
    let page = read_page(log_path.clone(), &params).await?;
    serde_json::to_value(crate::types::SubagentPage { page, log_path, running }).map_err(|e| err("internal", e.to_string()))
}

async fn read_page(log: String, params: &Value) -> Result<crate::types::ThreadPage, RpcError> {
    let before = params.get("before").and_then(Value::as_u64);
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map_or(transcript::DEFAULT_LIMIT, |n| n as usize);
    let page = tokio::task::spawn_blocking(move || transcript::thread_get(&log, before, limit))
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
        herdlingd: env!("CARGO_PKG_VERSION").into(),
        herdr_ok: false,
        herdr_version: None,
        herdr_protocol: None,
        methods: METHODS.iter().map(|m| (*m).to_string()).collect(),
        thread_kinds: transcript::KINDS.iter().map(|k| (*k).to_string()).collect(),
        command_kinds: crate::commands::KINDS.iter().map(|k| (*k).to_string()).collect(),
        boot: read_boot(ctx, false).await,
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

/// The boot state, from the cache unless `fresh`. None when system commands are off.
async fn read_boot(ctx: &Ctx, fresh: bool) -> Option<crate::types::Boot> {
    let runner = ctx.sys.clone()?;
    let (os, user, cache) = (ctx.host_os, crate::serve::http::current_user(&ctx.home), ctx.boot_cache.clone());
    tokio::task::spawn_blocking(move || cache.get(fresh, || crate::boot::detect(os, &user, runner.as_ref())))
        .await
        .ok()
}

/// `boot.check`: reads the boot state again (no cache).
async fn boot_check(ctx: &Ctx) -> Result<Value, RpcError> {
    if ctx.sys.is_none() {
        return Err(err("unsupported_platform", "system checks are off in this process"));
    }
    let b = read_boot(ctx, true).await.ok_or_else(|| err("internal", "the boot check did not finish"))?;
    serde_json::to_value(b).map_err(|e| err("internal", e.to_string()))
}

/// `mac.open_settings`: opens one allow-listed System Settings page on the Mac screen.
async fn mac_open_settings(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    use crate::boot::OpenError;
    let pane = str_param(&params, "pane", "mac.open_settings")?.to_string();
    let Some(runner) = ctx.sys.clone() else {
        return Err(err("unsupported_platform", "system commands are off in this process"));
    };
    let os = ctx.host_os;
    let r = tokio::task::spawn_blocking(move || crate::boot::open_settings(os, &pane, runner.as_ref()).map(|_| pane))
        .await
        .map_err(|e| err("internal", e.to_string()))?;
    match r {
        Ok(pane) => Ok(json!({ "opened": pane })),
        Err(OpenError::UnsupportedPlatform) => Err(err("unsupported_platform", "mac.open_settings works on macOS only")),
        Err(OpenError::UnknownPane) => Err(err("bad_request", "pane must be users_groups, sharing or filevault")),
        Err(OpenError::Failed(m)) => Err(err("command_failed", format!("open failed: {m}"))),
    }
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
    // Mark phone input before herdr gets it, so `serve` does not count the start of work
    // that follows as activity at the desk.
    if let Some(pane) = crate::phone_input::input_pane(&method, &p) {
        let _ = crate::phone_input::mark(&ctx.home, pane, std::time::SystemTime::now());
    }
    let mut c = herdr::Client::connect(&ctx.herdr_socket, timeout).await.map_err(herdr_err)?;
    c.call(&method, p).await.map_err(herdr_err)
}

/// One herdr call on its own connection (herdr 0.9.0 closes a connection after one answer).
async fn herdr_once(ctx: &Ctx, method: &str, params: Value) -> Result<Value, HerdrError> {
    let mut c = herdr::Client::connect(&ctx.herdr_socket, ctx.herdr_timeout).await?;
    c.call(method, params).await
}

fn stale(message: &str) -> RpcError {
    err("stale", message)
}

/// `pane.answer`: answers a permission menu with one digit, after a check on the computer.
/// The pane must still wait for the user, and the option at `key` must still have
/// `expect_label` (or its cut form from a push). Otherwise the error is `stale` and no key is sent.
async fn pane_answer(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let pane = str_param(&params, "pane_id", "pane.answer")?;
    let key = str_param(&params, "key", "pane.answer")?;
    let expect = str_param(&params, "expect_label", "pane.answer")?;
    if pane.is_empty() {
        return Err(err("bad_request", "pane.answer requires pane_id"));
    }
    if !matches!(key.as_bytes(), [b'1'..=b'9']) {
        return Err(err("bad_request", "pane.answer: key must be one digit from 1 to 9"));
    }
    let gone = |e: HerdrError| match e {
        HerdrError::Remote { code, .. } if code == "pane_not_found" => stale("the pane is gone"),
        e => herdr_err(e),
    };
    let got = herdr_once(ctx, "pane.get", json!({ "pane_id": pane })).await.map_err(gone)?;
    let status = got.get("pane").unwrap_or(&got).get("agent_status").and_then(Value::as_str);
    if status.is_some_and(|s| s != "blocked") {
        return Err(stale("the agent does not wait for an answer"));
    }
    let read = herdr_once(ctx, "pane.read", json!({ "pane_id": pane, "source": "visible", "format": "text" }))
        .await
        .map_err(gone)?;
    let text = read.get("read").unwrap_or(&read).get("text").and_then(Value::as_str).unwrap_or("");
    let choices = crate::choices::parse_choices(text);
    let Some(choice) = choices.iter().find(|c| c.key == key) else {
        return Err(stale("the menu changed"));
    };
    if !crate::choices::label_matches(&choice.label, expect) {
        return Err(stale("the menu changed"));
    }
    // Mark phone input before herdr gets it, as `herdr.call` does.
    let _ = crate::phone_input::mark(&ctx.home, pane, std::time::SystemTime::now());
    herdr_once(ctx, "pane.send_keys", json!({ "pane_id": pane, "keys": [key] })).await.map_err(herdr_err)?;
    Ok(json!({ "answered": true }))
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
    let r = transcript::resolve(&ctx.herdr_socket, ctx.herdr_timeout, &ctx.home, pane).await.map_err(herdr_err)?;
    serde_json::to_value(r).map_err(|e| err("internal", e.to_string()))
}

/// Consecutive poll errors before a follow stream ends.
const FOLLOW_MAX_FAILURES: u32 = 10;

fn thread_follow(ctx: &Ctx, out: &Out, params: Value) -> Result<Value, RpcError> {
    let log = str_param(&params, "log_path", "thread.follow")?.to_string();
    let path = std::path::PathBuf::from(&log);
    let from = params.get("from").and_then(Value::as_u64).unwrap_or(0);
    let mut follower = transcript::Follower::new(&log, from).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => err("not_found", e.to_string()),
        _ => err("io_error", e.to_string()),
    })?;
    let claude_log = transcript::Agent::of_log(&log) == transcript::Agent::Claude;
    let out = out.clone();
    let stream = ctx.streams.spawn("thread", move |id| async move {
        let mut failures = 0u32;
        // On a subagent transcript, tell the app when the subagent stops (`agent_running`).
        let mut running =
            if claude_log { claude::subagents::transcript_running(&path, std::time::SystemTime::now()) } else { None };
        let mut next_check = tokio::time::Instant::now() + claude::subagents::AGENT_POLL;
        loop {
            if running == Some(true) && tokio::time::Instant::now() >= next_check {
                next_check = tokio::time::Instant::now() + claude::subagents::AGENT_POLL;
                let now = claude::subagents::transcript_running(&path, std::time::SystemTime::now());
                if now == Some(false) {
                    running = now;
                    let data = json!({ "items": [], "offset": follower.offset(), "agent_running": false });
                    if !notify(&out, &id, data).await {
                        return;
                    }
                }
            }
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
            if let Some(code) = follower.ended() {
                notify(&out, &id, json!({ "error": code })).await;
                return;
            }
            tokio::time::sleep(claude::POLL_INTERVAL).await;
        }
    });
    Ok(json!({ "stream": stream }))
}

async fn sessions_recent(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let cwd = str_param(&params, "cwd", "sessions.recent")?.to_string();
    let limit = params.get("limit").and_then(Value::as_u64).map_or(20, |n| n as usize);
    // Older apps send no kind: they ask for Claude sessions.
    let kind = params.get("kind").and_then(Value::as_str).unwrap_or("claude").to_string();
    let home = ctx.home.clone();
    let list = tokio::task::spawn_blocking(move || transcript::recent_sessions(&home, &kind, &cwd, limit))
        .await
        .map_err(|e| err("internal", e.to_string()))?;
    serde_json::to_value(list).map_err(|e| err("internal", e.to_string()))
}

async fn fs_dirs(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let path = params.get("path").and_then(Value::as_str).map(String::from);
    let defaults = crate::fsdirs::DirsOpts::default();
    let opts = crate::fsdirs::DirsOpts {
        hidden: params.get("hidden").and_then(Value::as_bool).unwrap_or(defaults.hidden),
        recent: params.get("recent").and_then(Value::as_bool).unwrap_or(defaults.recent),
    };
    let home = ctx.home.clone();
    tokio::task::spawn_blocking(move || crate::fsdirs::dirs_with(&home, path.as_deref(), opts))
        .await
        .map_err(|e| err("internal", e.to_string()))?
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => err("not_found", e.to_string()),
            _ => err("io_error", e.to_string()),
        })
}

async fn agents_installed(ctx: &Ctx) -> Result<Value, RpcError> {
    let (home, base) = (ctx.home.clone(), ctx.bin_dirs.clone());
    tokio::task::spawn_blocking(move || crate::agents::installed(&crate::agents::search_dirs(&home, &base)))
        .await
        .map_err(|e| err("internal", e.to_string()))
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

/// Transcribes a recording with the host's `stt_command`. No command gives `no_command`.
async fn stt_make(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let audio = crate::stt::decode(str_param(&params, "audio_b64", "stt.make")?)?;
    let cfg = load_config(ctx).await?;
    let argv = crate::hostcmd::argv(cfg.stt_command.as_deref())
        .ok_or_else(|| err("no_command", "no stt_command in the companion config"))?;
    let text = crate::stt::make(argv, audio, ctx.stt_timeout).await?;
    serde_json::to_value(crate::types::SttText { text }).map_err(|e| err("internal", e.to_string()))
}

fn update_ctx(ctx: &Ctx) -> Result<&crate::update::UpdateCtx, RpcError> {
    ctx.update.as_ref().ok_or_else(|| err("update_unavailable", "updates are off in this process"))
}

fn version_param(params: &Value) -> Result<Option<&str>, RpcError> {
    match params.get("version") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(v)) => Ok(Some(v.as_str())),
        Some(_) => Err(err("bad_request", "version must be a string")),
    }
}

/// See [`crate::update::check`].
async fn update_check(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let u = update_ctx(ctx)?;
    let r = crate::update::check(u, version_param(&params)?).await?;
    serde_json::to_value(r).map_err(|e| err("internal", e.to_string()))
}

/// See [`crate::update::apply`]. The app reconnects after the reply to run the new binary.
async fn update_apply(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let u = update_ctx(ctx)?;
    let allow_downgrade = params.get("allow_downgrade").and_then(Value::as_bool).unwrap_or(false);
    let r = crate::update::apply(u, version_param(&params)?, allow_downgrade).await?;
    serde_json::to_value(r).map_err(|e| err("internal", e.to_string()))
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

/// Slash commands and skills for the folder `cwd`. When `cwd` is missing, the folder of
/// `pane_id` comes from herdr. No folder gives the built-in, user and plugin commands only.
/// `kind` picks the list (`codex`, `pi`, `opencode` or Claude). When `kind` is missing, herdr gives the kind of the pane.
async fn commands_list(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let text = |k: &str| params.get(k).and_then(Value::as_str).filter(|c| !c.is_empty()).map(String::from);
    let (mut cwd, mut kind) = (text("cwd"), text("kind"));
    if cwd.is_none() || kind.is_none() {
        if let Some(pane) = params.get("pane_id").and_then(Value::as_str) {
            let (pane_cwd, pane_kind) = pane_info(ctx, pane).await;
            cwd = cwd.or(pane_cwd);
            kind = kind.or(pane_kind);
        }
    }
    let home = ctx.home.clone();
    let env_path = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(std::path::PathBuf::from);
    let (codex_home, pi_agent_dir) = (env_path("CODEX_HOME"), env_path("PI_CODING_AGENT_DIR"));
    // The XDG rule: a relative `XDG_CONFIG_HOME` is not valid.
    let xdg_config = env_path("XDG_CONFIG_HOME").filter(|p| p.is_absolute());
    let commands = tokio::task::spawn_blocking(move || {
        let roots = crate::commands::Roots {
            home: &home,
            codex_home: codex_home.as_deref(),
            admin_skills: std::path::Path::new("/etc/codex/skills"),
            pi_agent_dir: pi_agent_dir.as_deref(),
            xdg_config: xdg_config.as_deref(),
        };
        crate::commands::list_for(kind.as_deref(), &roots, cwd.as_deref().map(std::path::Path::new))
    })
    .await
    .map_err(|e| err("internal", e.to_string()))?;
    Ok(json!({ "commands": commands }))
}

/// Saves a file for the agents to read. See [`crate::uploads`].
async fn files_put(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let name = str_param(&params, "name", "files.put")?.to_string();
    let data = str_param(&params, "data_b64", "files.put")?.to_string();
    let home = ctx.home.clone();
    let path = tokio::task::spawn_blocking(move || crate::uploads::put(&home, &name, &data, std::time::SystemTime::now()))
        .await
        .map_err(|e| err("internal", e.to_string()))??;
    Ok(json!({ "path": path.to_string_lossy() }))
}

/// The folder of a git call: `cwd`, else the folder of `pane_id` from herdr.
async fn git_cwd(ctx: &Ctx, params: &Value, method: &str) -> Result<std::path::PathBuf, RpcError> {
    if let Some(cwd) = params.get("cwd").and_then(Value::as_str).filter(|c| !c.is_empty()) {
        let p = match cwd.strip_prefix("~/") {
            Some(rest) => ctx.home.join(rest),
            None if cwd == "~" => ctx.home.clone(),
            None => std::path::PathBuf::from(cwd),
        };
        if !p.is_absolute() {
            return Err(err("bad_request", format!("{method}: cwd must be an absolute path")));
        }
        return Ok(p);
    }
    let pane = params
        .get("pane_id")
        .and_then(Value::as_str)
        .ok_or_else(|| err("bad_request", format!("{method} requires cwd or pane_id")))?;
    let (cwd, _) = pane_info(ctx, pane).await;
    cwd.map(std::path::PathBuf::from).ok_or_else(|| err("not_found", format!("{method}: herdr did not report the folder of the pane")))
}

/// Branch and changed files of the repo that holds the folder. See [`crate::git::status`].
async fn git_status(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let cwd = git_cwd(ctx, &params, "git.status").await?;
    let s = crate::git::status(&cwd).await?;
    serde_json::to_value(s).map_err(|e| err("internal", e.to_string()))
}

/// The unified diff of the repo, or of one file. See [`crate::git::diff`].
async fn git_diff(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let cwd = git_cwd(ctx, &params, "git.diff").await?;
    let path = match params.get("path") {
        None | Some(Value::Null) => None,
        Some(Value::String(p)) => Some(p.as_str()),
        Some(_) => return Err(err("bad_request", "git.diff: path must be a string")),
    };
    let staged = params.get("staged").and_then(Value::as_bool);
    let d = crate::git::diff(&cwd, path, staged).await?;
    serde_json::to_value(d).map_err(|e| err("internal", e.to_string()))
}

/// A new branch and worktree for a new session. See [`crate::git::worktree_add`].
async fn git_worktree_add(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let cwd = git_cwd(ctx, &params, "git.worktree_add").await?;
    let branch = str_param(&params, "branch", "git.worktree_add")?;
    let w = crate::git::worktree_add(&cwd, branch).await?;
    serde_json::to_value(w).map_err(|e| err("internal", e.to_string()))
}

/// The folder and the agent kind of a pane from herdr `pane.get`. Both `None` when herdr does not answer.
async fn pane_info(ctx: &Ctx, pane_id: &str) -> (Option<String>, Option<String>) {
    let Ok(mut c) = herdr::Client::connect(&ctx.herdr_socket, ctx.herdr_timeout).await else { return (None, None) };
    let Ok(got) = c.call("pane.get", json!({ "pane_id": pane_id })).await else { return (None, None) };
    let pane = got.get("pane").unwrap_or(&got);
    let text = |k: &str| pane.get(k).and_then(Value::as_str).filter(|c| !c.is_empty()).map(String::from);
    (text("cwd").or_else(|| text("foreground_cwd")), text("agent"))
}

/// Most entries accepted in `push.register` `capabilities`.
const MAX_CAPABILITIES: usize = 16;

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
    // An older app does not send `quiet_at_desk`: keep the saved value, else the default.
    let quiet_at_desk = flag("quiet_at_desk");
    // An older app does not send `capabilities`: it has none, so the list is cleared.
    let capabilities = match params.get("capabilities") {
        None | Some(Value::Null) => vec![],
        Some(Value::Array(a)) if a.len() <= MAX_CAPABILITIES => a
            .iter()
            .map(|v| v.as_str().filter(|s| !s.is_empty() && s.len() <= 64).map(String::from))
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| err("bad_request", "capabilities must be short strings"))?,
        Some(_) => return Err(err("bad_request", "capabilities must be an array of at most 16 strings")),
    };
    let path = ctx.config_path.clone();
    tokio::task::spawn_blocking(move || {
        config::update(&path, |c| {
            let old = c.devices.iter().find(|d| d.id == id);
            let public_key = old.and_then(|d| d.public_key.clone());
            let quiet_at_desk = quiet_at_desk.unwrap_or_else(|| old.map_or(Prefs::default().quiet_at_desk, |d| d.prefs.quiet_at_desk));
            config::upsert_device(
                c,
                Device { id, name, host_id, public_key, expo_token, capabilities, prefs: Prefs { finished, needs_you, quiet_at_desk } },
            );
        })
    })
    .await
    .map_err(|e| err("internal", e.to_string()))?
    .map_err(|e| err("io_error", format!("{e:#}")))?;
    Ok(json!({ "ok": true }))
}

/// Removes the device's `herdling:` key line from `authorized_keys` and the device from the
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
        let removed_keys = crate::pair::remove_herdling_key(&keys_path, &key).map_err(|e| io(e.into()))?;
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

/// The pairing port of `serve`. It is never listed or proxied.
fn reserved_port(ctx: &Ctx) -> u16 {
    crate::config::load(&ctx.config_path).unwrap_or_default().pair_port
}

/// The shell and foreground PIDs of a pane, from herdr `pane.process_info`. Empty when herdr does not answer.
async fn pane_roots(ctx: &Ctx, pane_id: &str) -> Vec<u32> {
    let Ok(mut c) = herdr::Client::connect(&ctx.herdr_socket, ctx.herdr_timeout).await else { return Vec::new() };
    let info = c.call("pane.process_info", json!({ "pane_id": pane_id })).await.unwrap_or(Value::Null);
    let (fg, shell) = crate::transcript::procs::pane_pids(info.get("process_info").unwrap_or(&info));
    shell.into_iter().chain(fg).collect()
}

/// `ports.list`: the TCP ports that a process of this user listens on, on loopback or on all
/// addresses. With `pane_id`, the ports of that pane come first. See [`crate::ports`].
async fn ports_list(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let pane = match params.get("pane_id") {
        None | Some(Value::Null) => None,
        Some(Value::String(p)) if !p.is_empty() => Some(p.clone()),
        Some(_) => return Err(err("bad_request", "ports.list: pane_id must be a string")),
    };
    let roots = match &pane {
        Some(p) => pane_roots(ctx, p).await,
        None => Vec::new(),
    };
    let (cache, reserved) = (ctx.ports_cache.clone(), reserved_port(ctx));
    let ports = tokio::task::spawn_blocking(move || {
        let listeners = cache.get(crate::ports::host_listeners);
        let procs = crate::transcript::procs::host_procs();
        crate::ports::build(&listeners, &procs, pane.as_deref().map(|id| (id, roots.as_slice())), reserved)
    })
    .await
    .map_err(|e| err("internal", e.to_string()))?;
    Ok(json!({ "ports": ports }))
}

/// `preview.open`: a grant for the proxy mode, for one port that a process of this user listens
/// on, on loopback or on all addresses. See [`crate::proxy`].
async fn preview_open(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let port = params
        .get("port")
        .and_then(Value::as_u64)
        .filter(|p| (1..=65535).contains(p))
        .ok_or_else(|| err("bad_request", "preview.open requires port, a number from 1 to 65535"))? as u16;
    if port == reserved_port(ctx) {
        return Err(err("bad_request", "preview.open: this port is reserved for herdlingd"));
    }
    let (cache, home) = (ctx.ports_cache.clone(), ctx.home.clone());
    tokio::task::spawn_blocking(move || {
        use crate::ports::{host_listeners, is_listening};
        // A dev server that started after the last list is not in the cache: look again once.
        if !is_listening(&cache.get(host_listeners), port) && !is_listening(&cache.refresh(host_listeners), port) {
            return Err(err("port_not_listening", format!("nothing of this user listens on port {port} on loopback")));
        }
        let g = crate::proxy::issue(&crate::proxy::grants_path(&home), port, crate::proxy::now_secs())
            .map_err(|e| err("io_error", format!("preview.open: {e}")))?;
        Ok(json!({ "grant": g.grant, "port": g.port, "expires_at": g.expires }))
    })
    .await
    .map_err(|e| err("internal", e.to_string()))?
}

/// `preview.close`: removes a grant. A grant that is not live gives `closed: false`.
async fn preview_close(ctx: &Ctx, params: Value) -> Result<Value, RpcError> {
    let grant = str_param(&params, "grant", "preview.close")?.to_string();
    if !crate::proxy::valid_grant(&grant) {
        return Err(err("grant_invalid", "preview.close: grant must be 32 lowercase hex characters"));
    }
    let path = crate::proxy::grants_path(&ctx.home);
    let closed = tokio::task::spawn_blocking(move || crate::proxy::revoke(&path, &grant, crate::proxy::now_secs()))
        .await
        .map_err(|e| err("internal", e.to_string()))?
        .map_err(|e| err("io_error", format!("preview.close: {e}")))?;
    Ok(json!({ "closed": closed }))
}
