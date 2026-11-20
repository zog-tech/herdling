//! Pure input rules of the mirror: the page messages, the gesture recognizer for adb and idb, the
//! position mapping, the scrcpy control messages and the argument lists of `adb` and `idb`.
//!
//! The page sends positions as fractions of the frame (0 to 1). scrcpy takes video pixels with
//! the video size, `adb shell input` takes device pixels, and `idb ui` takes points.

use serde_json::Value;

/// Longest text of one `text` message, in characters.
pub const MAX_TEXT: usize = 1000;
/// scrcpy refuses a text message of more than 300 bytes.
pub const SCRCPY_TEXT_BYTES: usize = 300;
/// A press shorter than this, that moves less than [`TAP_SLOP`], is a tap.
pub const TAP_MS: u64 = 500;
/// The largest move of a tap, as a fraction of the larger frame side.
pub const TAP_SLOP: f64 = 0.02;
/// The shortest and the longest swipe that adb and idb get.
pub const SWIPE_MIN_MS: u64 = 50;
pub const SWIPE_MAX_MS: u64 = 2000;
/// The longest press of a long press.
pub const PRESS_MAX_MS: u64 = 5000;

/// The phase of a touch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Down,
    Move,
    Up,
    Cancel,
}

/// A hardware button or a system key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    Home,
    Back,
    AppSwitch,
    Power,
    VolumeUp,
    VolumeDown,
    Lock,
    Siri,
}

/// One checked message of the page.
#[derive(Debug, Clone, PartialEq)]
pub enum PageInput {
    Touch { phase: Phase, x: f64, y: f64 },
    Key(Key),
    Text(String),
    Rotate,
}

fn frac(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|f| f.is_finite()).map(|f| f.clamp(0.0, 1.0))
}

/// Reads one text message of the page. An unknown or bad message gives None and is ignored.
pub fn parse_page(text: &str) -> Option<PageInput> {
    let v: Value = serde_json::from_str(text).ok()?;
    match v.get("t")?.as_str()? {
        "touch" => {
            let phase = match v.get("phase")?.as_str()? {
                "down" => Phase::Down,
                "move" => Phase::Move,
                "up" => Phase::Up,
                "cancel" => Phase::Cancel,
                _ => return None,
            };
            Some(PageInput::Touch { phase, x: frac(v.get("x"))?, y: frac(v.get("y"))? })
        }
        "key" => {
            let key = match v.get("key")?.as_str()? {
                "home" => Key::Home,
                "back" => Key::Back,
                "app_switch" => Key::AppSwitch,
                "power" => Key::Power,
                "volume_up" => Key::VolumeUp,
                "volume_down" => Key::VolumeDown,
                "lock" => Key::Lock,
                "siri" => Key::Siri,
                _ => return None,
            };
            Some(PageInput::Key(key))
        }
        "text" => {
            let t = v.get("text")?.as_str()?;
            let t: String = t.chars().filter(|c| !c.is_control() || *c == '\n').take(MAX_TEXT).collect();
            (!t.is_empty()).then_some(PageInput::Text(t))
        }
        "rotate" => Some(PageInput::Rotate),
        _ => None,
    }
}

/// True for `{"t":"keyframe"}`: the page decoder lost its place and needs a key frame.
pub fn is_key_frame_request(text: &str) -> bool {
    serde_json::from_str::<Value>(text).ok().and_then(|v| v.get("t").and_then(Value::as_str).map(|t| t == "keyframe")).unwrap_or(false)
}

/// A gesture for a device that has no touch down and up (adb, idb).
#[derive(Debug, Clone, PartialEq)]
pub enum Gesture {
    Tap { x: f64, y: f64 },
    /// From one point to another in `ms`. A long press is a swipe to the same point.
    Swipe { x0: f64, y0: f64, x1: f64, y1: f64, ms: u64 },
}

/// Turns touch events into one gesture at the end of the touch. Pure: the caller gives the time
/// in milliseconds.
#[derive(Debug, Clone, Default)]
pub struct Recognizer {
    down: Option<(f64, f64, u64)>,
    last: Option<(f64, f64)>,
    /// The frame aspect (width / height), so the slop is the same in both directions.
    aspect: Option<f64>,
}

impl Recognizer {
    /// `aspect`: frame width / height, when known.
    pub fn set_aspect(&mut self, aspect: Option<f64>) {
        self.aspect = aspect.filter(|a| a.is_finite() && *a > 0.0);
    }

    pub fn touch(&mut self, phase: Phase, x: f64, y: f64, now_ms: u64) -> Option<Gesture> {
        match phase {
            Phase::Down => {
                self.down = Some((x, y, now_ms));
                self.last = Some((x, y));
                None
            }
            Phase::Move => {
                if self.down.is_some() {
                    self.last = Some((x, y));
                }
                None
            }
            Phase::Cancel => {
                self.down = None;
                self.last = None;
                None
            }
            Phase::Up => {
                let (x0, y0, t0) = self.down.take()?;
                self.last = None;
                let ms = now_ms.saturating_sub(t0);
                // Distance in units of the larger side.
                let a = self.aspect.unwrap_or(1.0);
                let (dx, dy) = if a < 1.0 { ((x - x0) * a, y - y0) } else { (x - x0, (y - y0) / a) };
                let moved = (dx * dx + dy * dy).sqrt() >= TAP_SLOP;
                Some(match (moved, ms < TAP_MS) {
                    (false, true) => Gesture::Tap { x: x0, y: y0 },
                    (false, false) => Gesture::Swipe { x0, y0, x1: x0, y1: y0, ms: ms.min(PRESS_MAX_MS) },
                    (true, _) => Gesture::Swipe { x0, y0, x1: x, y1: y, ms: ms.clamp(SWIPE_MIN_MS, SWIPE_MAX_MS) },
                })
            }
        }
    }
}

/// A fraction of a side to a whole pixel in `0..size`.
pub fn to_px(f: f64, size: u32) -> u32 {
    if size == 0 {
        return 0;
    }
    ((f.clamp(0.0, 1.0) * f64::from(size)).floor() as u32).min(size - 1)
}

/// A fraction of a side to whole points in `0..size` (idb takes whole numbers).
pub fn to_points(f: f64, size_points: f64) -> i64 {
    let max = (size_points.floor() as i64 - 1).max(0);
    ((f.clamp(0.0, 1.0) * size_points).floor() as i64).min(max)
}

/// The point size of an iOS screen for a frame of `frame_w` × `frame_h`: the portrait size, or the
/// sizes swapped when the frame is landscape. Without a frame size, portrait.
pub fn ios_points(portrait: (f64, f64), frame: Option<(u32, u32)>) -> (f64, f64) {
    match frame {
        Some((w, h)) if w > h && portrait.0 < portrait.1 => (portrait.1, portrait.0),
        _ => portrait,
    }
}

// scrcpy control messages (`ControlMessageReader.java` of the pinned version).
const SC_INJECT_KEYCODE: u8 = 0;
const SC_INJECT_TEXT: u8 = 1;
const SC_INJECT_TOUCH: u8 = 2;
const SC_ROTATE_DEVICE: u8 = 11;
const SC_RESET_VIDEO: u8 = 17;
/// scrcpy `POINTER_ID_GENERIC_FINGER`.
const SC_FINGER: i64 = -2;

/// The Android key code of a key. None: no such key on Android.
pub fn android_keycode(k: Key) -> Option<u32> {
    Some(match k {
        Key::Home => 3,
        Key::Back => 4,
        Key::AppSwitch => 187,
        Key::Power | Key::Lock => 26,
        Key::VolumeUp => 24,
        Key::VolumeDown => 25,
        Key::Siri => return None,
    })
}

/// A scrcpy touch event. `action`: 0 down, 1 up, 2 move. The position is in video pixels with
/// the video size.
pub fn sc_touch(action: u8, x: u32, y: u32, w: u32, h: u32) -> Vec<u8> {
    let mut m = Vec::with_capacity(32);
    m.push(SC_INJECT_TOUCH);
    m.push(action);
    m.extend_from_slice(&SC_FINGER.to_be_bytes());
    m.extend_from_slice(&(x as i32).to_be_bytes());
    m.extend_from_slice(&(y as i32).to_be_bytes());
    m.extend_from_slice(&(w.min(0xffff) as u16).to_be_bytes());
    m.extend_from_slice(&(h.min(0xffff) as u16).to_be_bytes());
    // Pressure as u16 fixed point: 1.0 while down, 0 on up.
    m.extend_from_slice(&(if action == 1 { 0u16 } else { 0xffff }).to_be_bytes());
    // Action button and buttons: none for a finger.
    m.extend_from_slice(&0i32.to_be_bytes());
    m.extend_from_slice(&0i32.to_be_bytes());
    m
}

/// A scrcpy key event: down (0) or up (1).
pub fn sc_key(action: u8, keycode: u32) -> Vec<u8> {
    let mut m = Vec::with_capacity(14);
    m.push(SC_INJECT_KEYCODE);
    m.push(action);
    m.extend_from_slice(&keycode.to_be_bytes());
    m.extend_from_slice(&0u32.to_be_bytes());
    m.extend_from_slice(&0u32.to_be_bytes());
    m
}

/// scrcpy text messages: the text cut into parts of at most 300 bytes on character limits.
pub fn sc_text(text: &str) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut part = String::new();
    for c in text.chars() {
        if part.len() + c.len_utf8() > SCRCPY_TEXT_BYTES {
            out.push(std::mem::take(&mut part));
        }
        part.push(c);
    }
    if !part.is_empty() {
        out.push(part);
    }
    out.into_iter()
        .map(|p| {
            let mut m = Vec::with_capacity(p.len() + 5);
            m.push(SC_INJECT_TEXT);
            m.extend_from_slice(&(p.len() as u32).to_be_bytes());
            m.extend_from_slice(p.as_bytes());
            m
        })
        .collect()
}

/// scrcpy "rotate device".
pub fn sc_rotate() -> Vec<u8> {
    vec![SC_ROTATE_DEVICE]
}

/// scrcpy "reset video": a new session with a key frame.
pub fn sc_reset_video() -> Vec<u8> {
    vec![SC_RESET_VIDEO]
}

/// Quotes a word for the device shell of `adb shell`.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// The device command for `adb shell input text`: printable ASCII only (the `input` tool types
/// no other characters), a space as `%s`, and quoted for the device shell.
pub fn adb_text_command(text: &str) -> Option<String> {
    let t: String = text.chars().filter(|c| c.is_ascii_graphic() || *c == ' ').map(|c| if c == ' ' { "%s".to_string() } else { c.to_string() }).collect();
    (!t.is_empty()).then(|| format!("input text {}", sh_quote(&t)))
}

/// The device command for a gesture in device pixels (`w` × `h`).
pub fn adb_gesture_command(g: &Gesture, w: u32, h: u32) -> String {
    match *g {
        Gesture::Tap { x, y } => format!("input tap {} {}", to_px(x, w), to_px(y, h)),
        Gesture::Swipe { x0, y0, x1, y1, ms } => {
            format!("input swipe {} {} {} {} {ms}", to_px(x0, w), to_px(y0, h), to_px(x1, w), to_px(y1, h))
        }
    }
}

/// The device command for a key.
pub fn adb_key_command(k: Key) -> Option<String> {
    android_keycode(k).map(|c| format!("input keyevent {c}"))
}

/// The `idb ui` arguments for a gesture, after `--udid <udid>` is added by the caller.
pub fn idb_gesture_args(g: &Gesture, points: (f64, f64)) -> Vec<String> {
    let (w, h) = points;
    match *g {
        Gesture::Tap { x, y } => vec!["tap".into(), to_points(x, w).to_string(), to_points(y, h).to_string()],
        Gesture::Swipe { x0, y0, x1, y1, ms } if (x0, y0) == (x1, y1) => {
            vec!["tap".into(), "--duration".into(), format!("{:.2}", ms as f64 / 1000.0), to_points(x0, w).to_string(), to_points(y0, h).to_string()]
        }
        Gesture::Swipe { x0, y0, x1, y1, ms } => vec![
            "swipe".into(),
            "--duration".into(),
            format!("{:.2}", ms as f64 / 1000.0),
            to_points(x0, w).to_string(),
            to_points(y0, h).to_string(),
            to_points(x1, w).to_string(),
            to_points(y1, h).to_string(),
        ],
    }
}

/// The `idb ui button` name of a key. None: no such button on an iOS simulator.
pub fn idb_button(k: Key) -> Option<&'static str> {
    match k {
        Key::Home => Some("HOME"),
        Key::Lock | Key::Power => Some("LOCK"),
        Key::Siri => Some("SIRI"),
        Key::Back | Key::AppSwitch | Key::VolumeUp | Key::VolumeDown => None,
    }
}
