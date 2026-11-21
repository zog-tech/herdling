//! `devices.list`: the booted iOS simulators and the Android emulators of this computer, and the
//! tools that the mirror needs. The parsers are pure; [`list`] runs the read-only commands.
//!
//! Real Android devices show with `kind: "device"`. herdlingd asks a serial for its name and
//! Android version only when it is an emulator (`emulator-<port>`), so a real device gets no
//! command from `devices.list`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

/// Bound for one command of `devices.list`.
pub const LIST_TIMEOUT: Duration = Duration::from_secs(5);
/// At most this many devices of each platform.
pub const MAX_DEVICES: usize = 32;

/// The platform of a device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Ios,
    Android,
}

/// What a device is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// An iOS simulator.
    Simulator,
    /// An Android emulator (`emulator-<port>`).
    Emulator,
    /// A real Android device (USB or network). The app does not offer it.
    Device,
}

/// One item of the `devices.list` result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Device {
    /// `ios:<udid>` or `android:<serial>`.
    pub id: String,
    pub platform: Platform,
    pub kind: Kind,
    pub name: String,
    /// For example `iOS 26.5` or `Android 15`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os: Option<String>,
    /// For example `iPhone-17` (a simulator) or the AVD name (an emulator).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// True when the mirror can try video (else it uses screenshots).
    pub video: bool,
    /// True when the mirror can send taps, text and keys.
    pub input: bool,
}

impl Device {
    /// The UDID of a simulator or the serial of an Android device.
    pub fn target(&self) -> &str {
        self.id.split_once(':').map_or("", |(_, t)| t)
    }
}

/// The programs that the mirror uses. None: not found.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Tools {
    pub xcrun: Option<PathBuf>,
    pub adb: Option<PathBuf>,
    pub idb: Option<PathBuf>,
    pub idb_companion: Option<PathBuf>,
    /// `sim-video` of idb (v1.7.8 and later): H.264 of a simulator, without the gRPC companion.
    pub sim_video: Option<PathBuf>,
}

/// The folders searched for the tools: `PATH`, then the usual install folders. The rpc process
/// of the phone key gets the short `PATH` of sshd, so the usual folders matter.
pub fn search_dirs(path_var: Option<&str>, home: &Path, android_home: &[String]) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = path_var.unwrap_or("").split(':').filter(|d| !d.is_empty()).map(PathBuf::from).collect();
    for a in android_home.iter().filter(|a| !a.is_empty()) {
        dirs.push(Path::new(a).join("platform-tools"));
    }
    dirs.push(home.join("Library/Android/sdk/platform-tools"));
    dirs.push(home.join("Android/Sdk/platform-tools"));
    dirs.push(home.join(".local/bin"));
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(d));
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
    dirs
}

/// Finds the tools in `dirs`. `exists` tells if a file is there (production: `Path::is_file`).
/// `xcrun` counts only on macOS.
pub fn find_tools(dirs: &[PathBuf], macos: bool, exists: &dyn Fn(&Path) -> bool) -> Tools {
    let find = |name: &str| dirs.iter().map(|d| d.join(name)).find(|p| exists(p));
    Tools {
        xcrun: if macos { find("xcrun") } else { None },
        adb: find("adb"),
        idb: find("idb"),
        idb_companion: find("idb_companion"),
        sim_video: find(SIM_VIDEO),
    }
}

/// The file name of the simulator video tool of idb.
pub const SIM_VIDEO: &str = "sim-video";

/// Where `sim-video` is when it is not on the search path: next to the real `idb_companion`.
/// The Homebrew formula of idb puts the whole release in `libexec` and links only
/// `idb_companion` into `bin`. `companion_real` is the companion path with its links resolved.
pub fn sim_video_beside(companion_real: &Path) -> Option<PathBuf> {
    Some(companion_real.parent()?.join(SIM_VIDEO))
}

/// The tools of this computer, from the environment.
pub fn host_tools(home: &Path) -> Tools {
    let android: Vec<String> = ["ANDROID_HOME", "ANDROID_SDK_ROOT"].iter().filter_map(|k| std::env::var(k).ok()).collect();
    let dirs = search_dirs(std::env::var("PATH").ok().as_deref(), home, &android);
    let mut t = find_tools(&dirs, cfg!(target_os = "macos"), &|p| p.is_file());
    if t.sim_video.is_none() {
        let real = t.idb_companion.as_deref().and_then(|c| std::fs::canonicalize(c).ok());
        t.sim_video = real.as_deref().and_then(sim_video_beside).filter(|p| p.is_file());
    }
    t
}

/// `com.apple.CoreSimulator.SimRuntime.iOS-26-5` → `iOS 26.5`. None for an unknown form.
pub fn runtime_name(key: &str) -> Option<String> {
    let rest = key.rsplit('.').next()?;
    let (os, ver) = rest.split_once('-')?;
    if os.is_empty() || ver.is_empty() || !ver.split('-').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    let os = match os {
        "iOS" | "tvOS" | "watchOS" | "xrOS" | "visionOS" => os,
        _ => return None,
    };
    Some(format!("{os} {}", ver.replace('-', ".")))
}

/// `com.apple.CoreSimulator.SimDeviceType.iPhone-17` → `iPhone-17`.
fn device_type(id: &str) -> Option<String> {
    id.rsplit('.').next().filter(|s| !s.is_empty()).map(str::to_string)
}

/// True for a simulator UDID: hex digits and dashes, 8 to 64 characters.
pub fn valid_udid(s: &str) -> bool {
    (8..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

/// True for an adb serial that herdlingd passes to `adb -s`: 1 to 64 characters of
/// `[A-Za-z0-9._:-]`, not starting with `-`.
pub fn valid_serial(s: &str) -> bool {
    (1..=64).contains(&s.len()) && !s.starts_with('-') && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}

/// True for an emulator serial: `emulator-<port>`.
pub fn is_emulator(serial: &str) -> bool {
    serial.strip_prefix("emulator-").is_some_and(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

/// The booted iOS simulators of `xcrun simctl list devices booted -j`. Only iOS runtimes count.
/// `video`: `sim-video` or idb is there; `input`: idb is there.
pub fn parse_simctl(json: &Value, video: bool, input: bool) -> Vec<Device> {
    let mut out = Vec::new();
    let Some(runtimes) = json.get("devices").and_then(Value::as_object) else { return out };
    for (runtime, list) in runtimes {
        let os = runtime_name(runtime);
        if !os.as_deref().is_some_and(|o| o.starts_with("iOS ")) {
            continue;
        }
        for d in list.as_array().into_iter().flatten() {
            let (Some(udid), Some(name)) = (d.get("udid").and_then(Value::as_str), d.get("name").and_then(Value::as_str)) else {
                continue;
            };
            if d.get("state").and_then(Value::as_str) != Some("Booted") || !valid_udid(udid) {
                continue;
            }
            if d.get("isAvailable").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            out.push(Device {
                id: format!("ios:{udid}"),
                platform: Platform::Ios,
                kind: Kind::Simulator,
                name: name.chars().take(80).collect(),
                os: os.clone(),
                model: d.get("deviceTypeIdentifier").and_then(Value::as_str).and_then(device_type),
                video,
                input,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    out.truncate(MAX_DEVICES);
    out
}

/// The ready devices of `adb devices -l`: lines `<serial> device key:value…`. Other states
/// (`offline`, `unauthorized`) are left out.
pub fn parse_adb_devices(text: &str) -> Vec<Device> {
    let mut out = Vec::new();
    for line in text.lines().skip_while(|l| !l.starts_with("List of devices")).skip(1) {
        let mut words = line.split_whitespace();
        let (Some(serial), Some(state)) = (words.next(), words.next()) else { continue };
        if state != "device" || !valid_serial(serial) {
            continue;
        }
        let model = words.find_map(|w| w.strip_prefix("model:")).map(|m| m.replace('_', " "));
        let emulator = is_emulator(serial);
        out.push(Device {
            id: format!("android:{serial}"),
            platform: Platform::Android,
            kind: if emulator { Kind::Emulator } else { Kind::Device },
            name: model.clone().unwrap_or_else(|| serial.to_string()),
            os: None,
            model,
            video: true,
            input: true,
        });
        if out.len() >= MAX_DEVICES {
            break;
        }
    }
    out
}

/// The AVD name from `adb -s <serial> emu avd name`: the first line, without the `OK` line.
pub fn parse_avd_name(text: &str) -> Option<String> {
    text.lines().map(str::trim).find(|l| !l.is_empty() && *l != "OK").map(|l| l.chars().take(80).collect())
}

/// The screen of an iOS simulator in points, from `idb describe --json`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Screen {
    pub width_points: f64,
    pub height_points: f64,
    pub density: f64,
}

/// `screen_dimensions` of `idb describe --udid <udid> --json`.
pub fn parse_idb_describe(json: &Value) -> Option<Screen> {
    let s = json.get("screen_dimensions")?;
    let f = |k: &str| s.get(k).and_then(Value::as_f64).filter(|v| v.is_finite() && *v > 0.0);
    Some(Screen { width_points: f("width_points")?, height_points: f("height_points")?, density: f("density")? })
}

/// Runs `program args` and returns stdout when it exits with 0 in `timeout`.
pub async fn run_out(program: &Path, args: &[&str], timeout: Duration) -> Option<Vec<u8>> {
    let run = tokio::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(timeout, run).await {
        Ok(Ok(o)) if o.status.success() => Some(o.stdout),
        _ => None,
    }
}

/// The devices of this computer: booted simulators first, then Android devices.
pub async fn list(tools: &Tools) -> Vec<Device> {
    let ios = async {
        let Some(xcrun) = &tools.xcrun else { return Vec::new() };
        let Some(out) = run_out(xcrun, &["simctl", "list", "devices", "booted", "-j"], LIST_TIMEOUT).await else {
            return Vec::new();
        };
        serde_json::from_slice::<Value>(&out).map(|v| parse_simctl(&v, tools.idb.is_some() || tools.sim_video.is_some(), tools.idb.is_some())).unwrap_or_default()
    };
    let android = async {
        let Some(adb) = &tools.adb else { return Vec::new() };
        let Some(out) = run_out(adb, &["devices", "-l"], LIST_TIMEOUT).await else { return Vec::new() };
        let mut devices = parse_adb_devices(&String::from_utf8_lossy(&out));
        // Few emulators run at once: ask them one after the other.
        for d in devices.iter_mut().filter(|d| d.kind == Kind::Emulator) {
            let serial = d.target().to_string();
            let name = run_out(adb, &["-s", &serial, "emu", "avd", "name"], LIST_TIMEOUT).await;
            if let Some(n) = name.and_then(|n| parse_avd_name(&String::from_utf8_lossy(&n))) {
                d.name = n.replace('_', " ");
                d.model = Some(n);
            }
            let ver = run_out(adb, &["-s", &serial, "shell", "getprop", "ro.build.version.release"], LIST_TIMEOUT).await;
            let ver = ver.map(|v| String::from_utf8_lossy(&v).trim().to_string()).filter(|v| !v.is_empty() && v.len() < 16);
            d.os = ver.map(|v| format!("Android {v}"));
        }
        devices
    };
    let (mut a, b) = tokio::join!(ios, android);
    a.extend(b);
    a
}
