//! The I/O of the mirror sources: the scrcpy server on an Android emulator, `sim-video stream` (or
//! `idb video-stream`) on an iOS simulator, and the screenshot loops of both. Each source runs until its stop signal or
//! an error, publishes frames to the hub, and reports `Ready` and `Ended` to the session.
//!
//! The rules (stream parsing, input mapping, argument lists) are pure, in `stream.rs` and
//! `input.rs`. Every child process has `kill_on_drop`, and the adb forward is removed on drop.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, watch};

use super::devices::{self, Platform, Tools};
use super::input::{self, Key, PageInput, Phase, Recognizer};
use super::machine::{Input, Mode};
use super::stream::{AnnexB, Demuxed, FrameKind, ScrcpyDemux};
use super::{Hub, SourceCmd, SourceEnv};

/// Where the scrcpy server goes on the device.
pub const DEVICE_JAR: &str = "/data/local/tmp/herdling-scrcpy.jar";
/// The time between the starts of two screenshots.
pub const SHOT_INTERVAL: Duration = Duration::from_millis(250);
/// Screenshots that fail in a row before the source gives up.
const SHOT_FAILURES: u32 = 5;
/// Bound for one screenshot, one adb or idb command.
const CMD_TIMEOUT: Duration = Duration::from_secs(10);
/// Bound for the push of the scrcpy server.
const PUSH_TIMEOUT: Duration = Duration::from_secs(30);
/// How long the scrcpy server may take to accept the video connection.
const CONNECT_WINDOW: Duration = Duration::from_secs(10);
/// The H.264 pipe of sim-video or idb is quiet this long after a frame: the last NAL is complete.
const QUIET: Duration = Duration::from_millis(20);
/// At most one "reset video" to scrcpy in this time.
const KEY_FRAME_EVERY: Duration = Duration::from_secs(1);
/// Input commands queued for a source.
const INPUT_QUEUE: usize = 64;
/// The last bytes of stderr kept for an error message.
const ERR_TAIL: usize = 600;

/// The arguments of one source run.
pub struct Args {
    pub gen: u64,
    pub mode: Mode,
    pub hub: Arc<Hub>,
    pub env: SourceEnv,
    pub stop: watch::Receiver<bool>,
}

/// Why a source ended.
#[derive(Debug)]
struct Fail {
    message: String,
    /// True when screenshots can take over.
    fallback: bool,
}

fn fail(message: impl Into<String>) -> Fail {
    Fail { message: message.into(), fallback: false }
}

fn fallback(message: impl Into<String>) -> Fail {
    Fail { message: message.into(), fallback: true }
}

/// Tells the session once that the source sends frames.
struct Ready {
    gen: u64,
    hub: Arc<Hub>,
    sent: bool,
}

impl Ready {
    fn mark(&mut self) {
        if !self.sent {
            self.sent = true;
            self.hub.event(Input::Ready { gen: self.gen });
        }
    }
}

/// Runs one source until it stops or fails, then reports `Ended`.
pub async fn run(a: Args) {
    let (tx, rx) = mpsc::channel(INPUT_QUEUE);
    a.hub.set_input(a.gen, tx);
    let mut ready = Ready { gen: a.gen, hub: a.hub.clone(), sent: false };
    let target = a.hub.device.target().to_string();
    let r = match (a.hub.device.platform, a.mode) {
        (Platform::Android, Mode::Video) => android_video(&a, &target, rx, &mut ready).await,
        (Platform::Android, Mode::Shots) => android_shots(&a, &target, rx, &mut ready).await,
        (Platform::Ios, Mode::Video) => ios_video(&a, &target, rx, &mut ready).await,
        (Platform::Ios, Mode::Shots) => ios_shots(&a, &target, rx, &mut ready).await,
    };
    a.hub.clear_input(a.gen);
    let (error, fallback) = match r {
        Ok(()) => (None, false),
        Err(f) => (Some(f.message), f.fallback && !ready.sent),
    };
    a.hub.event(Input::Ended { gen: a.gen, error, fallback });
}

fn stopped(stop: &watch::Receiver<bool>) -> bool {
    *stop.borrow()
}

/// Waits until the stop signal is set.
async fn wait_stop(stop: &mut watch::Receiver<bool>) {
    let _ = stop.wait_for(|s| *s).await;
}

fn command(program: &Path) -> Command {
    let mut c = Command::new(program);
    c.stdin(Stdio::null()).kill_on_drop(true);
    c
}

/// Runs a command with a time limit. Ok(stdout) on exit code 0, else the end of stderr.
async fn run_cmd(mut c: Command, timeout: Duration) -> Result<Vec<u8>, String> {
    c.stdout(Stdio::piped()).stderr(Stdio::piped());
    match tokio::time::timeout(timeout, c.output()).await {
        Err(_) => Err("the command timed out".into()),
        Ok(Err(e)) => Err(e.to_string()),
        Ok(Ok(o)) if o.status.success() => Ok(o.stdout),
        Ok(Ok(o)) => Err(tail_text(&o.stderr)),
    }
}

/// The last [`ERR_TAIL`] bytes of `b` as one trimmed line of text.
pub fn tail_text(b: &[u8]) -> String {
    let start = b.len().saturating_sub(ERR_TAIL);
    String::from_utf8_lossy(&b[start..]).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Reads a child's stderr into a shared tail, for the error message when it exits.
fn keep_stderr(child: &mut Child) -> Arc<Mutex<Vec<u8>>> {
    let tail = Arc::new(Mutex::new(Vec::new()));
    if let Some(mut err) = child.stderr.take() {
        let t = tail.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 1024];
            while let Ok(n) = err.read(&mut buf).await {
                if n == 0 {
                    break;
                }
                let mut g = t.lock().unwrap();
                g.extend_from_slice(&buf[..n]);
                let extra = g.len().saturating_sub(4 * ERR_TAIL);
                g.drain(..extra);
            }
        });
    }
    tail
}

// ---------------------------------------------------------------- Android

fn adb(tools: &Tools, serial: &str) -> Result<Command, Fail> {
    let p = tools.adb.as_deref().ok_or_else(|| fail("adb is not installed"))?;
    let mut c = command(p);
    c.args(["-s", serial]);
    Ok(c)
}

/// Removes an adb forward when it goes out of scope.
struct Forward {
    adb: PathBuf,
    serial: String,
    port: u16,
}

impl Drop for Forward {
    fn drop(&mut self) {
        // Synchronous and short: it must also run while the rpc process ends.
        let _ = std::process::Command::new(&self.adb)
            .args(["-s", &self.serial, "forward", "--remove", &format!("tcp:{}", self.port)])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// The arguments after `app_process / com.genymobile.scrcpy.Server`.
pub fn scrcpy_args(version: &str, scid: u32, max_size: u32) -> Vec<String> {
    [
        version.to_string(),
        format!("scid={scid:08x}"),
        "log_level=warn".into(),
        "tunnel_forward=true".into(),
        "audio=false".into(),
        "control=true".into(),
        "video_codec=h264".into(),
        format!("max_size={max_size}"),
        "max_fps=60".into(),
        "send_device_meta=false".into(),
        "clipboard_autosync=false".into(),
        "cleanup=true".into(),
    ]
    .into()
}

/// Connects to the forwarded port until the scrcpy server accepts and sends its dummy byte.
async fn connect_video(port: u16, child: &mut Child) -> Result<TcpStream, Fail> {
    let start = Instant::now();
    loop {
        if let Ok(Some(_)) = child.try_wait() {
            return Err(fallback("the scrcpy server ended at start"));
        }
        if let Ok(mut s) = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).await {
            let mut b = [0u8; 1];
            // With a forward, the connect works even before the server listens: then it closes.
            if let Ok(Ok(1)) = tokio::time::timeout(Duration::from_secs(2), s.read(&mut b)).await {
                let _ = s.set_nodelay(true);
                return Ok(s);
            }
        }
        if start.elapsed() > CONNECT_WINDOW {
            return Err(fallback("the scrcpy server did not answer"));
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

async fn android_video(a: &Args, serial: &str, mut cmds: mpsc::Receiver<SourceCmd>, ready: &mut Ready) -> Result<(), Fail> {
    let env = &a.env;
    let adb_path = env.tools.adb.clone().ok_or_else(|| fail("adb is not installed"))?;
    let jar = super::pin::ensure(&env.home).await.map_err(|e| fallback(format!("scrcpy server: {}", e.message)))?;
    let mut push = adb(&env.tools, serial)?;
    push.arg("push").arg(&jar).arg(DEVICE_JAR);
    run_cmd(push, PUSH_TIMEOUT).await.map_err(|e| fallback(format!("adb push: {e}")))?;
    let scid: u32 = rand::random::<u32>() & 0x7fff_ffff;
    let mut fwd = adb(&env.tools, serial)?;
    fwd.args(["forward", "tcp:0", &format!("localabstract:scrcpy_{scid:08x}")]);
    let out = run_cmd(fwd, CMD_TIMEOUT).await.map_err(|e| fallback(format!("adb forward: {e}")))?;
    let port: u16 = String::from_utf8_lossy(&out).trim().parse().map_err(|_| fallback("adb forward gave no port"))?;
    let _forward = Forward { adb: adb_path, serial: serial.to_string(), port };

    let pin = super::pin::embedded();
    let mut server = adb(&env.tools, serial)?;
    server
        .args(["shell", &format!("CLASSPATH={DEVICE_JAR}"), "app_process", "/", "com.genymobile.scrcpy.Server"])
        .args(scrcpy_args(&pin.version, scid, env.max_size))
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = server.spawn().map_err(|e| fallback(format!("adb shell: {e}")))?;
    let err_tail = keep_stderr(&mut child);
    let mut stop = a.stop.clone();
    let video = tokio::select! {
        v = connect_video(port, &mut child) => v?,
        _ = wait_stop(&mut stop) => return Ok(()),
    };
    let control = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).await.map_err(|e| fallback(format!("scrcpy control: {e}")))?;
    let _ = control.set_nodelay(true);
    let (mut control_r, mut control_w) = control.into_split();
    // The device can send messages on the control socket. They are not used: drop them.
    let drain = tokio::spawn(async move {
        let mut b = [0u8; 4096];
        while let Ok(n) = control_r.read(&mut b).await {
            if n == 0 {
                break;
            }
        }
    });

    let mut video = video;
    let mut demux = ScrcpyDemux::default();
    let mut size: Option<(u32, u32)> = None;
    let mut last_touch = (0.0, 0.0);
    let mut last_reset: Option<Instant> = None;
    let mut buf = vec![0u8; 256 * 1024];
    let result = loop {
        tokio::select! {
            _ = wait_stop(&mut stop) => break Ok(()),
            n = video.read(&mut buf) => {
                let n = match n {
                    Ok(0) | Err(_) => break Err(fail(format!("the scrcpy stream ended: {}", tail_text(&err_tail.lock().unwrap())))),
                    Ok(n) => n,
                };
                match demux.feed(&buf[..n]) {
                    Err(e) => break Err(fallback(e.to_string())),
                    Ok(items) => for it in items {
                        match it {
                            Demuxed::Session { width, height } => size = Some((width, height)),
                            Demuxed::Unit { key, data } => {
                                a.hub.publish(FrameKind::H264, key, &data);
                                ready.mark();
                            }
                        }
                    },
                }
            }
            c = cmds.recv() => {
                let Some(c) = c else { continue };
                let msgs: Vec<Vec<u8>> = match c {
                    SourceCmd::KeyFrame => {
                        if last_reset.is_some_and(|t| t.elapsed() < KEY_FRAME_EVERY) {
                            vec![]
                        } else {
                            last_reset = Some(Instant::now());
                            vec![input::sc_reset_video()]
                        }
                    }
                    SourceCmd::Input(PageInput::Touch { phase, x, y }) => {
                        let Some((w, h)) = size else { continue };
                        let (x, y) = if phase == Phase::Cancel { last_touch } else { (x, y) };
                        last_touch = (x, y);
                        let action = match phase {
                            Phase::Down => 0,
                            Phase::Up | Phase::Cancel => 1,
                            Phase::Move => 2,
                        };
                        vec![input::sc_touch(action, input::to_px(x, w), input::to_px(y, h), w, h)]
                    }
                    SourceCmd::Input(PageInput::Key(k)) => match input::android_keycode(k) {
                        Some(code) => vec![input::sc_key(0, code), input::sc_key(1, code)],
                        None => vec![],
                    },
                    SourceCmd::Input(PageInput::Text(t)) => input::sc_text(&t),
                    SourceCmd::Input(PageInput::Rotate) => vec![input::sc_rotate()],
                };
                let mut broken = false;
                for m in msgs {
                    if control_w.write_all(&m).await.is_err() {
                        broken = true;
                        break;
                    }
                }
                if broken {
                    break Err(fail("the scrcpy control connection closed"));
                }
            }
            _ = child.wait() => {
                break Err(fail(format!("the scrcpy server ended: {}", tail_text(&err_tail.lock().unwrap()))));
            }
        }
    };
    drain.abort();
    // Closing the sockets ends the server on the device; the child goes with kill_on_drop.
    drop(video);
    drop(control_w);
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    result
}

async fn android_shots(a: &Args, serial: &str, cmds: mpsc::Receiver<SourceCmd>, ready: &mut Ready) -> Result<(), Fail> {
    let size = Arc::new(Mutex::new(None::<(u32, u32)>));
    let tools = a.env.tools.clone();
    let (s2, serial2) = (size.clone(), serial.to_string());
    let inputs = tokio::spawn(async move { adb_input(&tools, &serial2, cmds, s2).await });
    let tools = a.env.tools.clone();
    let r = shot_loop(a, ready, FrameKind::Png, || {
        let c = adb(&tools, serial);
        let size = size.clone();
        async move {
            let mut c = c.map_err(|f| f.message)?;
            c.args(["exec-out", "screencap", "-p"]);
            let png = run_cmd(c, CMD_TIMEOUT).await?;
            match super::stream::png_size(&png) {
                Some(wh) => {
                    *size.lock().unwrap() = Some(wh);
                    Ok(png)
                }
                None => Err("screencap gave no PNG image".to_string()),
            }
        }
    })
    .await;
    inputs.abort();
    r
}

/// Runs the input of an Android device with `adb shell input`, in arrival order.
async fn adb_input(tools: &Tools, serial: &str, mut cmds: mpsc::Receiver<SourceCmd>, size: Arc<Mutex<Option<(u32, u32)>>>) {
    let mut rec = Recognizer::default();
    let start = Instant::now();
    while let Some(c) = cmds.recv().await {
        let dims = *size.lock().unwrap();
        rec.set_aspect(dims.map(|(w, h)| f64::from(w) / f64::from(h.max(1))));
        let line = match c {
            SourceCmd::Input(PageInput::Touch { phase, x, y }) => {
                let Some(g) = rec.touch(phase, x, y, start.elapsed().as_millis() as u64) else { continue };
                let Some((w, h)) = dims else { continue };
                input::adb_gesture_command(&g, w, h)
            }
            SourceCmd::Input(PageInput::Key(k)) => match input::adb_key_command(k) {
                Some(l) => l,
                None => continue,
            },
            SourceCmd::Input(PageInput::Text(t)) => match input::adb_text_command(&t) {
                Some(l) => l,
                None => continue,
            },
            SourceCmd::Input(PageInput::Rotate) | SourceCmd::KeyFrame => continue,
        };
        let Ok(mut c) = adb(tools, serial) else { return };
        // `adb shell` gives the one argument to the device shell; the text in it is quoted.
        c.args(["shell", &line]);
        let _ = run_cmd(c, CMD_TIMEOUT).await;
    }
}

/// Takes a screenshot again and again and publishes each new one. `take` gives the image bytes.
async fn shot_loop<F, Fut>(a: &Args, ready: &mut Ready, kind: FrameKind, take: F) -> Result<(), Fail>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u8>, String>>,
{
    let mut stop = a.stop.clone();
    let mut last: Option<Vec<u8>> = None;
    let mut failures = 0;
    while !stopped(&stop) {
        let t0 = Instant::now();
        let shot = tokio::select! {
            s = take() => s,
            _ = wait_stop(&mut stop) => return Ok(()),
        };
        match shot {
            Ok(img) => {
                failures = 0;
                // The same image again is not sent: the page keeps the last one.
                if last.as_deref() != Some(&img[..]) {
                    a.hub.publish(kind, true, &img);
                    ready.mark();
                    last = Some(img);
                }
            }
            Err(e) => {
                failures += 1;
                if failures >= SHOT_FAILURES {
                    return Err(fail(format!("screenshots failed: {e}")));
                }
            }
        }
        let wait = SHOT_INTERVAL.saturating_sub(t0.elapsed());
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = wait_stop(&mut stop) => return Ok(()),
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- iOS

fn idb(tools: &Tools) -> Option<Command> {
    let p = tools.idb.as_deref()?;
    let mut c = command(p);
    if let Some(comp) = &tools.idb_companion {
        // The rpc process of the phone key has the short PATH of sshd: name the companion.
        c.arg("--companion-path").arg(comp);
    }
    Some(c)
}

/// True when idb says that its companion for the target is gone. `idb disconnect` clears the
/// stale entry, so the next idb command starts a new companion.
pub fn companion_stale(stderr: &str) -> bool {
    stderr.contains("Failed to connect to companion") || stderr.contains("Connection lost") || stderr.contains("StreamTerminatedError")
}

async fn idb_disconnect(tools: &Tools, udid: &str) {
    if let Some(mut c) = idb(tools) {
        c.args(["disconnect", udid]);
        let _ = run_cmd(c, CMD_TIMEOUT).await;
    }
}

/// The key frame interval of sim-video in seconds. A new viewer starts at the last key frame.
const SIM_VIDEO_KEY_FRAME_SECS: &str = "1";

/// The arguments of `sim-video stream`: raw Annex B on stdout. Without `--fps`, a frame comes
/// on each screen update, so an idle screen sends nothing.
pub fn sim_video_args(udid: &str, device_set: &Path, scale: Option<f64>) -> Vec<String> {
    let mut a: Vec<String> = vec!["stream".into(), "--set".into(), device_set.display().to_string(), "--udid".into(), udid.into()];
    a.extend(["--transport".into(), "annex-b".into(), "--key-frame-rate".into(), SIM_VIDEO_KEY_FRAME_SECS.into()]);
    if let Some(s) = scale {
        a.extend(["--scale".into(), format!("{s:.4}")]);
    }
    a.push("-".into());
    a
}

/// The pixel size of the main display, from `xcrun simctl io <udid> enumerate`: the first
/// `Default width` and `Default height` pair.
pub fn parse_io_enumerate(text: &str) -> Option<(u32, u32)> {
    let value = |l: &str, key: &str| l.trim().strip_prefix(key).and_then(|v| v.trim().parse::<u32>().ok());
    let mut width = None;
    for l in text.lines() {
        if let Some(w) = value(l, "Default width:") {
            width = Some(w);
        } else if let (Some(w), Some(h)) = (width, value(l, "Default height:")) {
            return (w > 0 && h > 0).then_some((w, h));
        }
    }
    None
}

/// The `--scale` of sim-video that keeps the longest edge at or below `max_size`. None when the
/// screen is small enough. The scale rounds down, so the edge never grows above `max_size`.
pub fn sim_video_scale((w, h): (u32, u32), max_size: u32) -> Option<f64> {
    let long = w.max(h);
    if long <= max_size || long == 0 {
        return None;
    }
    let s = (f64::from(max_size) / f64::from(long) * 10_000.0).floor() / 10_000.0;
    (s > 0.0).then_some(s)
}

/// The simulator video of `sim-video stream`. It reads the simulator framebuffer through
/// CoreSimulator and encodes with VideoToolbox: no gRPC companion and no screen recording
/// permission. The input still goes through `idb ui`.
async fn sim_video(a: &Args, udid: &str, program: &Path, cmds: mpsc::Receiver<SourceCmd>, ready: &mut Ready) -> Result<(), Fail> {
    let tools = a.env.tools.clone();
    let scale = match &tools.xcrun {
        Some(x) => {
            let mut c = command(x);
            c.args(["simctl", "io", udid, "enumerate"]);
            let out = run_cmd(c, CMD_TIMEOUT).await.ok();
            out.and_then(|o| parse_io_enumerate(&String::from_utf8_lossy(&o))).and_then(|d| sim_video_scale(d, a.env.max_size))
        }
        None => None,
    };
    let set = a.env.home.join("Library/Developer/CoreSimulator/Devices");
    let mut c = command(program);
    // sim-video stops when its stdin ends: the pipe stays open while the source runs.
    c.args(sim_video_args(udid, &set, scale)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|e| fallback(format!("sim-video: {e}")))?;
    let stdin = child.stdin.take();
    let err_tail = keep_stderr(&mut child);
    let mut out = child.stdout.take().ok_or_else(|| fallback("sim-video has no output"))?;
    let (t2, u2) = (tools.clone(), udid.to_string());
    let inputs = tokio::spawn(async move { idb_input(&t2, &u2, cmds).await });
    let mut stop = a.stop.clone();
    let r = h264_pipe(&mut out, &mut stop, |u| {
        a.hub.publish(FrameKind::H264, u.key, &u.data);
        ready.mark();
    })
    .await;
    inputs.abort();
    drop(stdin);
    drop(child);
    r.map_err(|e| fallback(format!("{e}: {}", tail_text(&err_tail.lock().unwrap()))))
}

async fn ios_video(a: &Args, udid: &str, cmds: mpsc::Receiver<SourceCmd>, ready: &mut Ready) -> Result<(), Fail> {
    let tools = a.env.tools.clone();
    if let Some(sv) = tools.sim_video.clone() {
        return sim_video(a, udid, &sv, cmds, ready).await;
    }
    let mut c = idb(&tools).ok_or_else(|| fallback("idb is not installed"))?;
    c.args(["video-stream", "--udid", udid, "--format", "h264"]).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|e| fallback(format!("idb video-stream: {e}")))?;
    let err_tail = keep_stderr(&mut child);
    let mut out = child.stdout.take().ok_or_else(|| fallback("idb video-stream has no output"))?;
    let (t2, u2) = (tools.clone(), udid.to_string());
    let inputs = tokio::spawn(async move { idb_input(&t2, &u2, cmds).await });
    let mut stop = a.stop.clone();
    let r = h264_pipe(&mut out, &mut stop, |u| {
        a.hub.publish(FrameKind::H264, u.key, &u.data);
        ready.mark();
    })
    .await;
    inputs.abort();
    drop(child);
    match r {
        Ok(()) => Ok(()),
        Err(e) => {
            let text = tail_text(&err_tail.lock().unwrap());
            if !ready.sent && companion_stale(&text) {
                idb_disconnect(&tools, udid).await;
            }
            Err(fallback(format!("{e}: {text}")))
        }
    }
}

/// Reads an Annex B pipe until it ends or the stop signal comes, and gives each access unit.
async fn h264_pipe<R: AsyncRead + Unpin>(out: &mut R, stop: &mut watch::Receiver<bool>, mut unit: impl FnMut(super::stream::Unit)) -> Result<(), String> {
    let mut split = AnnexB::default();
    let mut buf = vec![0u8; 256 * 1024];
    let mut pending = false;
    loop {
        // While a NAL is pending, a quiet pipe ends it; else wait as long as it takes.
        let limit = if pending { QUIET } else { Duration::from_secs(24 * 3600) };
        let read = tokio::select! {
            _ = wait_stop(stop) => return Ok(()),
            r = tokio::time::timeout(limit, out.read(&mut buf)) => r,
        };
        match read {
            Err(_) => {
                for u in split.flush() {
                    unit(u);
                }
                pending = false;
            }
            Ok(Ok(0)) | Ok(Err(_)) => return Err("the video stream ended".into()),
            Ok(Ok(n)) => {
                for u in split.feed(&buf[..n]) {
                    unit(u);
                }
                pending = true;
            }
        }
    }
}

/// The point size of the simulator screen, from `idb describe`.
async fn ios_screen(tools: &Tools, udid: &str) -> Option<devices::Screen> {
    for attempt in 0..2 {
        let mut c = idb(tools)?;
        c.args(["describe", "--udid", udid, "--json"]);
        match run_cmd(c, CMD_TIMEOUT).await {
            Ok(out) => return serde_json::from_slice(&out).ok().and_then(|v| devices::parse_idb_describe(&v)),
            Err(e) if attempt == 0 && companion_stale(&e) => idb_disconnect(tools, udid).await,
            Err(_) => return None,
        }
    }
    None
}

/// Runs the input of an iOS simulator with `idb ui`, in arrival order.
async fn idb_input(tools: &Tools, udid: &str, mut cmds: mpsc::Receiver<SourceCmd>) {
    if tools.idb.is_none() {
        // View only: drop the input.
        while cmds.recv().await.is_some() {}
        return;
    }
    let mut rec = Recognizer::default();
    let mut screen: Option<devices::Screen> = None;
    let start = Instant::now();
    while let Some(c) = cmds.recv().await {
        let args: Vec<String> = match c {
            SourceCmd::Input(PageInput::Touch { phase, x, y }) => {
                if screen.is_none() {
                    screen = ios_screen(tools, udid).await;
                }
                let Some(s) = screen else { continue };
                rec.set_aspect(Some(s.width_points / s.height_points));
                let Some(g) = rec.touch(phase, x, y, start.elapsed().as_millis() as u64) else { continue };
                input::idb_gesture_args(&g, input::ios_points((s.width_points, s.height_points), None))
            }
            SourceCmd::Input(PageInput::Key(k)) => match input::idb_button(k) {
                Some(b) => vec!["button".into(), b.into()],
                None => continue,
            },
            SourceCmd::Input(PageInput::Text(t)) => vec!["text".into(), "--".into(), t],
            SourceCmd::Input(PageInput::Rotate) | SourceCmd::KeyFrame => continue,
        };
        run_idb_ui(tools, udid, &args).await;
    }
}

/// `idb ui <args> --udid <udid>`; a stale companion gets one `idb disconnect` and one retry.
async fn run_idb_ui(tools: &Tools, udid: &str, args: &[String]) {
    for attempt in 0..2 {
        let Some(mut c) = idb(tools) else { return };
        // `--udid` before the arguments: a text after `--` must stay last.
        c.args(["ui", &args[0], "--udid", udid]).args(&args[1..]);
        match run_cmd(c, CMD_TIMEOUT).await {
            Err(e) if attempt == 0 && companion_stale(&e) => idb_disconnect(tools, udid).await,
            _ => return,
        }
    }
}

/// A private temporary folder (0700) that is removed on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> std::io::Result<TempDir> {
        use std::os::unix::fs::DirBuilderExt;
        let p = std::env::temp_dir().join(format!("herdling-mirror-{}-{:08x}", std::process::id(), rand::random::<u32>()));
        std::fs::DirBuilder::new().mode(0o700).create(&p)?;
        Ok(TempDir(p))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn ios_shots(a: &Args, udid: &str, cmds: mpsc::Receiver<SourceCmd>, ready: &mut Ready) -> Result<(), Fail> {
    let xcrun = a.env.tools.xcrun.clone().ok_or_else(|| fail("xcrun is not installed"))?;
    let dir = TempDir::new().map_err(|e| fail(format!("temporary folder: {e}")))?;
    let (t2, u2) = (a.env.tools.clone(), udid.to_string());
    let inputs = tokio::spawn(async move { idb_input(&t2, &u2, cmds).await });
    let file = dir.0.join("shot.jpg");
    let r = shot_loop(a, ready, FrameKind::Jpeg, || {
        let mut c = command(&xcrun);
        // simctl cannot write to stdout: a file in the private folder.
        c.args(["simctl", "io", udid, "screenshot", "--type=jpeg"]).arg(&file);
        let file = file.clone();
        async move {
            run_cmd(c, CMD_TIMEOUT).await?;
            let b = tokio::fs::read(&file).await.map_err(|e| e.to_string())?;
            let _ = tokio::fs::remove_file(&file).await;
            Ok(b)
        }
    })
    .await;
    inputs.abort();
    r
}

/// The key that the toolbar names as `key`, for the docs and tests.
pub fn key_supported(platform: Platform, k: Key) -> bool {
    match platform {
        Platform::Android => input::android_keycode(k).is_some(),
        Platform::Ios => input::idb_button(k).is_some(),
    }
}
