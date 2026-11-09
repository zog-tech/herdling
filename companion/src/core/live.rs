//! The calls to a running core that `rpc` and `serve` make. Thin I/O over [`super::client`];
//! the rules are in [`super::project`] and [`super::route`].

use std::time::Duration;

use serde_json::{json, Value};

use super::client::{Client, CoreError};
use super::endpoint::CoreSocket;
use super::project::{self, Projection};
use super::route;
use crate::types::{AgentPreview, AgentStatus, RpcError};

/// Bound for `terminal.send` and `terminal.keys`: the core waits until nobody types at the
/// computer (about 3 s), and an unfinished draft there holds a send for up to 60 s.
pub const TYPING_TIMEOUT: Duration = Duration::from_secs(75);

/// The RPC error of a core error. `not_found` and `finished` become `pane_not_found`, the code
/// that herdr 1 gives for a closed pane, so the app and the pane checks treat both the same.
pub fn rpc_err(e: CoreError) -> RpcError {
    match e {
        CoreError::Unavailable(m) => RpcError { code: "herdr_unavailable".into(), message: format!("herdr-core: {m}") },
        CoreError::Remote { kind, message } => {
            let code = match kind.as_str() {
                "not_found" | "finished" => "pane_not_found".to_string(),
                _ => kind,
            };
            RpcError { code, message }
        }
    }
}

/// One call on its own connection.
pub async fn once(sock: &CoreSocket, timeout: Duration, method: &str, params: Value) -> Result<Value, CoreError> {
    let mut c = Client::connect(&sock.current(), timeout).await?;
    c.call(method, params).await
}

/// The snapshot entries of the core: `terminal.list` placed by the herdr-app document.
/// A document that cannot be read leaves every terminal in the loose workspace.
pub async fn projection(sock: &CoreSocket, timeout: Duration) -> Result<Projection, CoreError> {
    let mut c = Client::connect(&sock.current(), timeout).await?;
    let list = c.call("terminal.list", json!({})).await?;
    let doc = c.call("doc.get", json!({ "name": project::LAYOUT_DOC })).await.ok();
    let terminals = list.get("terminals").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(project::project(&terminals, doc.as_ref().and_then(|d| d.get("value")).filter(|v| !v.is_null())))
}

/// `hello` of the core: `{version, generation}` for `hello.backends.core`. None when no core
/// answers.
pub async fn backend_info(sock: &CoreSocket, timeout: Duration) -> Option<Value> {
    let mut c = Client::connect(&sock.current(), timeout).await.ok()?;
    let h = c.hello().await.ok()?;
    Some(json!({ "version": h.get("version"), "generation": h.get("generation") }))
}

/// The terminal record of core pane `pane`.
pub async fn record(sock: &CoreSocket, timeout: Duration, pane: &str) -> Result<Value, CoreError> {
    let addr = project::address(pane).ok_or_else(|| CoreError::Remote { kind: "not_found".into(), message: format!("no terminal {pane}") })?;
    once(sock, timeout, "terminal.get", json!({ "terminal": addr })).await
}

/// The text of the screen (plus `lines` of history) of core pane `pane`.
pub async fn read_text(sock: &CoreSocket, timeout: Duration, pane: &str, lines: u64) -> Result<(String, bool), CoreError> {
    let addr = project::address(pane).ok_or_else(|| CoreError::Remote { kind: "not_found".into(), message: format!("no terminal {pane}") })?;
    let r = once(sock, timeout, "terminal.read", json!({ "terminal": addr, "lines": lines })).await?;
    let text = r.get("text").and_then(Value::as_str).unwrap_or("").to_string();
    Ok((text, r.get("complete").and_then(Value::as_bool).unwrap_or(true)))
}

/// `herdr.call` of `method` on the core id `id`. A method with no core equivalent gives the
/// error code `unsupported`.
pub async fn call(sock: &CoreSocket, timeout: Duration, method: &str, params: &Value, id: &str) -> Result<Value, RpcError> {
    let plan = route::plan(method, params, id).map_err(|u| RpcError { code: route::UNSUPPORTED.into(), message: u.0 })?;
    let bound = if matches!(plan.method, "terminal.send" | "terminal.keys") { TYPING_TIMEOUT } else { timeout };
    let mut c = Client::connect(&sock.current(), timeout).await.map_err(rpc_err)?;
    let r = c.call_with(plan.method, plan.params, bound).await.map_err(rpc_err)?;
    Ok(route::shape(&plan.shape, r))
}

/// One preview line per core agent (only `wanted` panes when given), from the 7501 message, else
/// from the last line of the screen.
pub async fn previews(sock: &CoreSocket, timeout: Duration, wanted: Option<&[String]>) -> Result<Vec<AgentPreview>, CoreError> {
    let list = once(sock, timeout, "terminal.list", json!({})).await?;
    let terminals = list.get("terminals").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut out = Vec::new();
    for t in terminals.iter().filter(|t| project::counts(t)) {
        let (Some(status), Some(addr)) = (project::agent_status(t), t.get("address").and_then(Value::as_str)) else { continue };
        let pane = project::pane_id(addr);
        if wanted.is_some_and(|w| !w.contains(&pane)) {
            continue;
        }
        let msg = t.pointer("/status/msg").and_then(Value::as_str).map(str::trim).filter(|m| !m.is_empty()).map(String::from);
        let line = match msg {
            Some(m) => Some(m),
            None => match read_text(sock, timeout, &pane, 0).await {
                Ok((text, _)) if status == AgentStatus::Blocked => crate::preview::screen_question(&text),
                Ok((text, _)) => crate::preview::screen_line(&text),
                Err(_) => None,
            },
        };
        let mut p = AgentPreview {
            pane_id: pane,
            activity: None,
            last_reply: None,
            question: None,
            status_since: project::status_since(t),
            source: "screen".into(),
            background: None,
        };
        match status {
            AgentStatus::Working => p.activity = line,
            AgentStatus::Blocked => p.question = line,
            _ => p.last_reply = line,
        }
        out.push(p);
    }
    Ok(out)
}
