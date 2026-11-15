//! `herdr.call` on a core id: which herdr-core method answers a herdr 1 method, and how the
//! answer gets the herdr 1 shape. [`plan`] gives the single-call rows; [`action`] gives every
//! row, also the ones with more steps. Pure; `core::live` does the calls.
//!
//! Methods with no core equivalent give the error code [`UNSUPPORTED`].

use serde_json::{json, Map, Value};

use super::actions::{agent_line, rename_labels, ActionError, Scope};
use super::ids::{self, Tab};
use super::project::{self, address};

/// The error code of a herdr method that a core entry cannot do.
pub const UNSUPPORTED: &str = "unsupported";

/// Lines of history for a `pane.read` of source `recent` without `lines`.
const DEFAULT_LINES: u64 = 200;
const MAX_LINES: u64 = 1000;

/// The id of the entry that a herdr 1 call names: the first non-empty string of `pane_id`,
/// `target`, `tab_id`, `workspace_id`, without the legacy `hc:` prefix. None for a call that
/// names no entry.
pub fn target(params: &Value) -> Option<String> {
    ids::ID_KEYS
        .iter()
        .find_map(|k| params.get(*k).and_then(Value::as_str).filter(|v| !v.is_empty()).map(|v| ids::strip_legacy(v).to_string()))
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
            unsupported("Herdr 2 cannot type this text without Enter. Send it as a line.")
        })?
    };
    all.extend(keys);
    if all.is_empty() {
        return plain("terminal.keys", json!({ "terminal": addr, "keys": [] }));
    }
    plain("terminal.keys", json!({ "terminal": addr, "keys": all }))
}

/// The herdr 1 methods of [`plan`]: each names a pane.
const PANE_METHODS: [&str; 8] = ["pane.read", "pane.send_input", "pane.send_text", "pane.send_keys", "agent.prompt", "pane.get", "pane.process_info", "pane.close"];

/// The core call for the herdr 1 call `method` on the core pane `id`.
pub fn plan(method: &str, params: &Value, id: &str) -> Result<Plan, Unsupported> {
    let need_herdr1 = || unsupported(format!("{method} has no meaning on Herdr 2"));
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

/// What a herdr 1 call on a core id does. [`Action::Call`] is one core call; the other actions
/// need more than one call or a projection (`core::live::run`).
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// One core call, see [`plan`].
    Call(Plan),
    /// `tab.create` (and `workspace.create` for the core): a new shell in a new tab of
    /// `workspace` (None: a new space). `kind` is the herdr 1 answer type.
    Run { kind: &'static str, workspace: Option<String>, cwd: Option<String> },
    /// `agent.start`: type the agent command `line` into the shell of `addr`.
    Start { addr: String, line: String },
    /// `agent.prompt`: send `text` once the terminal reports an agent status.
    Prompt { addr: String, text: String },
    /// `agent.rename` and the rename of a task tab: set these labels.
    Label { addr: String, labels: Map<String, Value> },
    /// `tab.close`, `workspace.close`: kill every terminal of the scope.
    Kill(Scope),
    /// `agent.explain`.
    Explain { addr: String },
    /// `workspace.get` of a core workspace.
    WorkspaceGet(String),
}

/// The action of the herdr 1 call `method` on the core id `id`.
pub fn action(method: &str, params: &Value, id: &str) -> Result<Action, ActionError> {
    let s = |k: &str| params.get(k).and_then(Value::as_str);
    // A pane method on an id that is no terminal address names no pane.
    let pane = || address(id).map(String::from).ok_or_else(|| ActionError::not_found("pane", id));
    let owned_names = "The Herdr app owns the names of its spaces and tabs. Rename the task instead.";
    Ok(match method {
        "tab.create" => Action::Run { kind: "tab_created", workspace: Some(id.to_string()), cwd: s("cwd").map(String::from) },
        "agent.start" => {
            let addr = pane()?;
            let kind = s("kind").filter(|k| !k.is_empty()).ok_or_else(|| ActionError::bad("agent.start requires kind"))?;
            let args: Vec<String> = match params.get("args") {
                None | Some(Value::Null) => vec![],
                Some(Value::Array(a)) => a
                    .iter()
                    .map(|v| v.as_str().map(String::from))
                    .collect::<Option<_>>()
                    .ok_or_else(|| ActionError::bad("agent.start: args must be strings"))?,
                Some(_) => return Err(ActionError::bad("agent.start: args must be an array")),
            };
            Action::Start { addr, line: agent_line(kind, &args)? }
        }
        "agent.prompt" => {
            let text = s("text").filter(|t| !t.is_empty()).ok_or_else(|| ActionError::unsupported("agent.prompt requires text"))?;
            Action::Prompt { addr: pane()?, text: text.to_string() }
        }
        "agent.rename" => Action::Label { addr: pane()?, labels: rename_labels(s("name")) },
        "tab.rename" => match ids::tab(id) {
            Some(Tab::Task(addr)) => Action::Label { addr: addr.to_string(), labels: rename_labels(s("label")) },
            Some(Tab::Space(_)) => return Err(ActionError::unsupported(owned_names)),
            None => return Err(ActionError::not_found("tab", id)),
        },
        "workspace.rename" => return Err(ActionError::unsupported(owned_names)),
        "tab.close" => Action::Kill(Scope::Tab(id.to_string())),
        "workspace.close" => Action::Kill(Scope::Workspace(id.to_string())),
        "agent.explain" => Action::Explain { addr: pane()? },
        "workspace.get" => Action::WorkspaceGet(id.to_string()),
        _ if address(id).is_none() && PANE_METHODS.contains(&method) => return Err(ActionError::not_found("pane", id)),
        _ => Action::Call(plan(method, params, id).map_err(|u| ActionError::unsupported(u.0))?),
    })
}
