//! Device mirror: an iOS simulator or an Android emulator of this computer as video in the app,
//! with taps, text and keys back to the device. See
//! `docs/superpowers/specs/2026-11-20-device-mirror-design.md`.
//!
//! `mirror.start` starts a small HTTP and WebSocket server on `127.0.0.1` in this rpc process
//! ([`server`]). The app opens its page through the browser preview tunnel. The page gets the
//! frames of a source ([`source`]: scrcpy, `idb video-stream` or screenshots) from the [`Hub`],
//! and sends input back. A pure state machine ([`machine`]) decides when a source runs.
//!
//! Each rpc process has its own mirrors, at most one per device. The mirrors stop with
//! `mirror.stop`, after [`machine::SERVER_IDLE`] with no viewer, and when the rpc loop ends.

pub mod devices;
pub mod input;
pub mod machine;
pub mod pin;
pub mod server;
pub mod source;
pub mod stream;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, watch};

use devices::{Device, Kind, Platform, Tools};
use machine::{Effect, Input, Mode, Phase, State};
use stream::{Frame, FrameCache, FrameKind};

/// Bound for one source to end after a stop.
pub const STOP_TIMEOUT: Duration = Duration::from_secs(3);
/// Frames queued for each viewer before it lags.
const FRAME_QUEUE: usize = 64;
/// The longest edge of the video (scrcpy `max_size`, the `--scale` of sim-video).
pub const DEFAULT_MAX_SIZE: u32 = 1280;

/// A command for the running source.
#[derive(Debug, Clone, PartialEq)]
pub enum SourceCmd {
    Input(input::PageInput),
    /// A viewer needs a key frame.
    KeyFrame,
}

struct HubInner {
    cache: FrameCache,
    seq: u64,
    /// The last state message, for a new viewer.
    state_msg: String,
    /// The input channel of the running source and its generation.
    input: Option<(u64, mpsc::Sender<SourceCmd>)>,
}

/// The meeting point of one mirror: the source publishes frames, the viewers read them and send
/// input. The session task owns the state machine and talks to the hub.
pub struct Hub {
    pub device: Device,
    inner: Mutex<HubInner>,
    frames: broadcast::Sender<Frame>,
    texts: broadcast::Sender<String>,
    events: mpsc::UnboundedSender<Input>,
    closed: watch::Sender<bool>,
}

impl Hub {
    fn new(device: Device, events: mpsc::UnboundedSender<Input>) -> Arc<Hub> {
        let (frames, _) = broadcast::channel(FRAME_QUEUE);
        let (texts, _) = broadcast::channel(16);
        let (closed, _) = watch::channel(false);
        Arc::new(Hub {
            device,
            inner: Mutex::new(HubInner { cache: FrameCache::default(), seq: 0, state_msg: String::new(), input: None }),
            frames,
            texts,
            events,
            closed,
        })
    }

    /// Sends a frame to the viewers and keeps it in the cache.
    pub fn publish(&self, kind: FrameKind, key: bool, payload: &[u8]) {
        let mut g = self.inner.lock().unwrap();
        g.seq += 1;
        let f = Frame { seq: g.seq, key, msg: stream::encode(kind, key, payload).into() };
        g.cache.push(f.clone());
        // Under the lock, so the cache and the channel agree on the order.
        let _ = self.frames.send(f);
    }

    /// A new source starts: its frames do not follow the old ones.
    fn reset_cache(&self) {
        self.inner.lock().unwrap().cache.clear();
    }

    fn set_state(&self, msg: String) {
        self.inner.lock().unwrap().state_msg = msg.clone();
        let _ = self.texts.send(msg);
    }

    fn send_error(&self, message: &str) {
        let _ = self.texts.send(json!({"type": "error", "message": message}).to_string());
    }

    /// The source of `gen` takes input.
    pub fn set_input(&self, gen: u64, tx: mpsc::Sender<SourceCmd>) {
        self.inner.lock().unwrap().input = Some((gen, tx));
    }

    /// The source of `gen` ends: its input channel goes, unless a newer source has one.
    pub fn clear_input(&self, gen: u64) {
        let mut g = self.inner.lock().unwrap();
        if g.input.as_ref().is_some_and(|(g0, _)| *g0 == gen) {
            g.input = None;
        }
    }

    /// Gives a command to the running source. A full queue drops it.
    pub fn command(&self, cmd: SourceCmd) {
        if let Some((_, tx)) = &self.inner.lock().unwrap().input {
            let _ = tx.try_send(cmd);
        }
    }

    /// Sends a session event.
    pub fn event(&self, i: Input) {
        let _ = self.events.send(i);
    }

    /// For a new viewer: the receivers, then the cached frames and the state message.
    pub fn join(&self) -> (broadcast::Receiver<Frame>, broadcast::Receiver<String>, watch::Receiver<bool>, Vec<Frame>, String) {
        let g = self.inner.lock().unwrap();
        (self.frames.subscribe(), self.texts.subscribe(), self.closed.subscribe(), g.cache.snapshot(), g.state_msg.clone())
    }
}

/// The JSON state message for the page.
pub fn state_message(s: &State, d: &Device) -> String {
    let state = match s.phase {
        Phase::Waiting { .. } => "waiting",
        Phase::Starting { .. } => "starting",
        Phase::Streaming { .. } | Phase::Grace { .. } => "streaming",
        Phase::Stopped => "stopped",
    };
    let source = match s.mode {
        Mode::Video => "video",
        Mode::Shots => "screenshots",
    };
    json!({"type": "state", "state": state, "source": source, "input": d.input, "platform": d.platform, "name": d.name}).to_string()
}

/// What a source needs besides the hub.
#[derive(Clone)]
pub struct SourceEnv {
    pub tools: Tools,
    pub home: PathBuf,
    pub max_size: u32,
}

struct Running {
    gen: u64,
    stop: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

async fn stop_source(r: Running) {
    let _ = r.stop.send(true);
    let mut task = r.task;
    if tokio::time::timeout(STOP_TIMEOUT, &mut task).await.is_err() {
        task.abort();
    }
}

/// Runs the state machine of one mirror until it stops.
async fn run_session(hub: Arc<Hub>, mut rx: mpsc::UnboundedReceiver<Input>, mode: Mode, env: SourceEnv) {
    let mut state = State::new(mode, Instant::now());
    hub.set_state(state_message(&state, &hub.device));
    let mut running: Option<Running> = None;
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        let input = tokio::select! {
            i = rx.recv() => i.unwrap_or(Input::Stop),
            _ = tick.tick() => Input::Tick,
        };
        let step = machine::step(&state, input, Instant::now());
        state = step.state;
        for fx in step.effects {
            match fx {
                Effect::StartSource { gen, mode } => {
                    if let Some(r) = running.take() {
                        stop_source(r).await;
                    }
                    hub.reset_cache();
                    let (stop, stop_rx) = watch::channel(false);
                    let task = tokio::spawn(source::run(source::Args {
                        gen,
                        mode,
                        hub: hub.clone(),
                        env: env.clone(),
                        stop: stop_rx,
                    }));
                    running = Some(Running { gen, stop, task });
                }
                Effect::StopSource { gen } => {
                    if running.as_ref().is_some_and(|r| r.gen == gen) {
                        if let Some(r) = running.take() {
                            stop_source(r).await;
                        }
                    }
                }
                Effect::Announce => hub.set_state(state_message(&state, &hub.device)),
                Effect::Error(m) => hub.send_error(&m),
                Effect::Shutdown => {}
            }
        }
        if state.phase == Phase::Stopped {
            break;
        }
    }
    if let Some(r) = running.take() {
        stop_source(r).await;
    }
    hub.set_state(state_message(&state, &hub.device));
    let _ = hub.closed.send(true);
}

/// One running mirror.
pub struct Handle {
    pub device: Device,
    pub port: u16,
    pub token: String,
    hub: Arc<Hub>,
    session: tokio::task::JoinHandle<()>,
    server: tokio::task::JoinHandle<()>,
}

impl Handle {
    fn alive(&self) -> bool {
        !self.session.is_finished()
    }

    /// Stops the mirror and waits a short time for its source to end.
    async fn stop(self) {
        self.hub.event(Input::Stop);
        let mut session = self.session;
        if tokio::time::timeout(STOP_TIMEOUT + Duration::from_secs(1), &mut session).await.is_err() {
            session.abort();
        }
        self.server.abort();
    }
}

/// The mirrors of this rpc process, by device id.
#[derive(Clone, Default)]
pub struct Mirrors(Arc<tokio::sync::Mutex<HashMap<String, Handle>>>);

impl Mirrors {
    /// Stops every mirror. The rpc loop calls it before the process exits.
    pub async fn stop_all(&self) {
        let all: Vec<Handle> = self.0.lock().await.drain().map(|(_, h)| h).collect();
        for h in all {
            h.stop().await;
        }
    }

    /// The ids of the running mirrors.
    pub async fn running(&self) -> Vec<String> {
        self.0.lock().await.iter().filter(|(_, h)| h.alive()).map(|(k, _)| k.clone()).collect()
    }
}

/// The mirror settings of an rpc process.
#[derive(Clone, Default)]
pub struct MirrorCtx {
    /// The tools. None turns the mirror off: `Ctx::new` leaves it unset, so a test never runs a
    /// real `adb` or `xcrun`. `main` sets it.
    pub tools: Option<Tools>,
    pub mirrors: Mirrors,
}

fn err(code: &str, message: impl Into<String>) -> crate::types::RpcError {
    crate::types::RpcError { code: code.into(), message: message.into() }
}

/// True for a device id of the form `ios:<udid>` or `android:<serial>`.
pub fn valid_device_id(id: &str) -> bool {
    match id.split_once(':') {
        Some(("ios", u)) => devices::valid_udid(u),
        Some(("android", s)) => devices::valid_serial(s),
        _ => false,
    }
}

/// `devices.list`.
pub async fn devices_list(m: &MirrorCtx) -> Value {
    let tools = m.tools.clone().unwrap_or_default();
    let list = devices::list(&tools).await;
    let running = m.mirrors.running().await;
    let devices: Vec<Value> = list
        .iter()
        .map(|d| {
            let mut v = serde_json::to_value(d).unwrap_or(Value::Null);
            if running.contains(&d.id) {
                v["mirroring"] = json!(true);
            }
            v
        })
        .collect();
    json!({
        "devices": devices,
        "tools": {
            "xcrun": tools.xcrun.is_some(),
            "idb": tools.idb.is_some(),
            "idb_companion": tools.idb_companion.is_some(),
            "sim_video": tools.sim_video.is_some(),
            "adb": tools.adb.is_some(),
        },
        "scrcpy": pin::embedded().version,
    })
}

/// `mirror.start`: starts or reuses the mirror of a device and issues a preview grant for its port.
pub async fn mirror_start(m: &MirrorCtx, home: &std::path::Path, params: &Value) -> Result<Value, crate::types::RpcError> {
    let id = params
        .get("device")
        .and_then(Value::as_str)
        .filter(|d| valid_device_id(d))
        .ok_or_else(|| err("bad_request", "mirror.start requires device, an id from devices.list"))?
        .to_string();
    let allow_device = params.get("allow_device").and_then(Value::as_bool).unwrap_or(false);
    let max_size = match params.get("max_size") {
        None | Some(Value::Null) => DEFAULT_MAX_SIZE,
        Some(v) => v
            .as_u64()
            .filter(|n| (320..=4096).contains(n))
            .ok_or_else(|| err("bad_request", "mirror.start: max_size must be a number from 320 to 4096"))? as u32,
    };
    let Some(tools) = m.tools.clone() else { return Err(err("not_installed", "the device mirror is off on this computer")) };
    let mut map = m.mirrors.0.lock().await;
    let reuse = map.get(&id).filter(|h| h.alive()).map(|h| (h.port, h.token.clone(), h.device.clone()));
    let (port, token, device) = match reuse {
        Some(r) => r,
        None => {
            if let Some(old) = map.remove(&id) {
                old.stop().await;
            }
            let device = devices::list(&tools)
                .await
                .into_iter()
                .find(|d| d.id == id)
                .ok_or_else(|| err("not_found", "the device is not booted, or its tools are missing"))?;
            if device.kind == Kind::Device && !allow_device {
                return Err(err("unsupported", "mirror.start: a real device needs allow_device"));
            }
            match device.platform {
                Platform::Ios if tools.xcrun.is_none() => return Err(err("not_installed", "xcrun is not installed")),
                Platform::Android if tools.adb.is_none() => return Err(err("not_installed", "adb is not installed")),
                _ => {}
            }
            let h = start(device, SourceEnv { tools, home: home.to_path_buf(), max_size }).await?;
            let r = (h.port, h.token.clone(), h.device.clone());
            map.insert(id.clone(), h);
            r
        }
    };
    drop(map);
    let (home2, ip) = (home.to_path_buf(), std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
    let g = tokio::task::spawn_blocking(move || crate::proxy::issue(&crate::proxy::grants_path(&home2), port, Some(ip), crate::proxy::now_secs()))
        .await
        .map_err(|e| err("internal", e.to_string()))?
        .map_err(|e| err("io_error", format!("mirror.start: {e}")))?;
    Ok(json!({
        "device": device.id,
        "platform": device.platform,
        "name": device.name,
        "port": port,
        "path": format!("/m/{token}/"),
        "grant": g.grant,
        "expires_at": g.expires,
        "source": if device.video { "video" } else { "screenshots" },
        "input": device.input,
    }))
}

/// Starts the server and the session of a new mirror.
async fn start(device: Device, env: SourceEnv) -> Result<Handle, crate::types::RpcError> {
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|e| err("io_error", format!("mirror.start: listen: {e}")))?;
    let port = listener.local_addr().map_err(|e| err("io_error", e.to_string()))?.port();
    let token = crate::proxy::new_grant();
    let (tx, rx) = mpsc::unbounded_channel();
    let hub = Hub::new(device.clone(), tx);
    let mode = if device.video { Mode::Video } else { Mode::Shots };
    let session = tokio::spawn(run_session(hub.clone(), rx, mode, env));
    let app = server::router(hub.clone(), token.clone());
    let mut closed = hub.closed.subscribe();
    let server = tokio::spawn(async move {
        // The viewers end when the hub closes, so the graceful end does not wait long.
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = closed.wait_for(|c| *c).await;
            })
            .await;
    });
    Ok(Handle { device, port, token, hub, session, server })
}

/// `mirror.stop`: stops the mirror of a device. `stopped: false` when none ran.
pub async fn mirror_stop(m: &MirrorCtx, params: &Value) -> Result<Value, crate::types::RpcError> {
    let id = params
        .get("device")
        .and_then(Value::as_str)
        .filter(|d| valid_device_id(d))
        .ok_or_else(|| err("bad_request", "mirror.stop requires device, an id from devices.list"))?;
    let h = m.mirrors.0.lock().await.remove(id);
    let stopped = match h {
        Some(h) => {
            let alive = h.alive();
            h.stop().await;
            alive
        }
        None => false,
    };
    Ok(json!({ "stopped": stopped }))
}
