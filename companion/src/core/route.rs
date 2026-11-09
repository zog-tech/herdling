//! `herdr.call` on a core id: which herdr-core method answers a herdr 1 method, and how the
//! answer gets the herdr 1 shape. Pure; `core::live` does the calls.
//!
//! Methods with no core equivalent give the error code [`UNSUPPORTED`].

use serde_json::{json, Value};

use super::project::{self, address};

/// The error code of a herdr method that a core entry cannot do.
pub const UNSUPPORTED: &str = "unsupported";

/// Lines of history for a `pane.read` of source `recent` without `lines`.
const DEFAULT_LINES: u64 = 200;
const MAX_LINES: u64 = 1000;

/// The core id that `params` names: the value of `target` or of a key that ends with `_id`,
/// when it starts with `hc:`. Text params never count.
pub fn core_target(params: &Value) -> Option<&str> {
    let obj = params.as_object()?;
    obj.iter()
        .filter(|(k, _)| *k == "target" || k.ends_with("_id"))
        .filter_map(|(_, v)| v.as_str())
        .find(|v| project::is_core_id(v))
}

/// How the core answer becomes the herdr 1 answer.
#[derive(Debug, Clone, PartialEq)]
pub enum Shape {
    /// `terminal.read` to `pane.read`.
    Read { pane_id: String },
    /// `terminal.get` to `pane.get`.
    PaneGet,
    /// `terminal.get` to `pane.process_info`.
    ProcessInfo,
    /// The core answer as it is.
    Plain,
}

/// One core call for a herdr 1 call.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub method: &'static str,
    pub params: Value,
    pub shape: Shape,
}

/// Why a call cannot go to the core.
#[derive(Debug, Clone, PartialEq)]
pub struct Unsupported(pub String);

fn unsupported(m: impl Into<String>) -> Unsupported {
    Unsupported(m.into())
}

/// The core keys that type `text` exactly, when every character has a key. The page sequences
/// of the app (`\x1b[5~`, `\x1b[6~`) are the page keys.
pub fn text_keys(text: &str) -> Option<Vec<String>> {
    match text {
        "\x1b[5~" => return Some(vec!["pageup".into()]),
        "\x1b[6~" => return Some(vec!["pagedown".into()]),
        "" => return None,
        _ => {}
    }
    text.chars()
        .map(|c| {
            Some(match c {
                'a'..='z' | '0'..='9' | '`' | '[' | ']' | ',' | '=' | '-' | '.' | '\'' | ';' | '/' => c.to_string(),
                'A'..='Z' => format!("shift+{}", c.to_ascii_lowercase()),
                '\\' => "backslash".into(),
                ' ' => "space".into(),
                '\r' | '\n' => "enter".into(),
                '\t' => "tab".into(),
                '\x1b' => "esc".into(),
                '\x7f' | '\x08' => "backspace".into(),
                '\x01'..='\x1a' => format!("ctrl+{}", (b'a' + (c as u8) - 1) as char),
                _ => return None,
            })
        })
        .collect()
}

fn keys_param(params: &Value) -> Result<Vec<String>, Unsupported> {
    match params.get("keys") {
        None | Some(Value::Null) => Ok(vec![]),
        Some(Value::Array(a)) => a
            .iter()
            .map(|k| k.as_str().map(|s| s.to_ascii_lowercase()))
            .collect::<Option<_>>()
            .ok_or_else(|| unsupported("keys must be strings")),
        Some(_) => Err(unsupported("keys must be an array")),
    }
}

/// Typing `text`, then pressing `keys`: one `terminal.send` when it is a line and Enter,
/// else one `terminal.keys`. `force` types into a blocked program too.
fn typing(addr: &str, text: &str, keys: Vec<String>, force: bool) -> Result<Plan, Unsupported> {
    let plain = |method, params| Ok(Plan { method, params, shape: Shape::Plain });
    if !text.is_empty() && keys == ["enter"] {
        return plain("terminal.send", json!({ "terminal": addr, "text": text, "force": force }));
    }
    let mut all = if text.is_empty() {
        vec![]
    } else {
        text_keys(text).ok_or_else(|| {
            unsupported("Herdr 2 cannot type this text without Enter. Send it as a line, or use herdr 1.")
        })?
    };
    all.extend(keys);
    if all.is_empty() {
        return plain("terminal.keys", json!({ "terminal": addr, "keys": [] }));
    }
    plain("terminal.keys", json!({ "terminal": addr, "keys": all }))
}

/// The core call for the herdr 1 call `method` on the core pane `id`.
pub fn plan(method: &str, params: &Value, id: &str) -> Result<Plan, Unsupported> {
    let need_herdr1 = || unsupported(format!("{method} needs herdr 1; Herdr 2 terminals do not support it yet"));
    let addr = address(id).ok_or_else(need_herdr1)?;
    let s = |k: &str| params.get(k).and_then(Value::as_str).unwrap_or("");
    let get = |shape| Ok(Plan { method: "terminal.get", params: json!({ "terminal": addr }), shape });
    match method {
        "pane.read" => {
            let lines = if s("source") == "visible" {
                0
            } else {
                params.get("lines").and_then(Value::as_u64).unwrap_or(DEFAULT_LINES).min(MAX_LINES)
            };
            Ok(Plan {
                method: "terminal.read",
                params: json!({ "terminal": addr, "lines": lines }),
                shape: Shape::Read { pane_id: id.to_string() },
            })
        }
        "pane.send_input" => typing(addr, s("text"), keys_param(params)?, true),
        "pane.send_text" => {
            let text = s("text");
            match text.strip_suffix('\n').or_else(|| text.strip_suffix('\r')) {
                Some(line) if !line.is_empty() && !line.contains(['\n', '\r']) => typing(addr, line, vec!["enter".into()], true),
                _ => typing(addr, text, vec![], true),
            }
        }
        "pane.send_keys" => typing(addr, "", keys_param(params)?, true),
        "agent.prompt" => {
            let text = s("text");
            if text.is_empty() {
                return Err(unsupported("agent.prompt requires text"));
            }
            Ok(Plan { method: "terminal.send", params: json!({ "terminal": addr, "text": text }), shape: Shape::Plain })
        }
        "pane.get" => get(Shape::PaneGet),
        "pane.process_info" => get(Shape::ProcessInfo),
        "pane.close" => Ok(Plan { method: "terminal.kill", params: json!({ "terminal": addr }), shape: Shape::Plain }),
        _ => Err(need_herdr1()),
    }
}

/// The herdr 1 shape of the core answer `result`.
pub fn shape(shape: &Shape, result: Value) -> Value {
    match shape {
        Shape::Read { pane_id } => json!({
            "type": "pane_read",
            "read": {
                "pane_id": pane_id,
                "text": result.get("text").and_then(Value::as_str).unwrap_or(""),
                "revision": 0,
                "truncated": !result.get("complete").and_then(Value::as_bool).unwrap_or(true),
                "format": "text",
            }
        }),
        Shape::PaneGet => project::pane_get(&result),
        Shape::ProcessInfo => project::process_info(&result),
        Shape::Plain => result,
    }
}
