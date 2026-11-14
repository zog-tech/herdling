//! The calls to a running core that `rpc` and `serve` make. Thin I/O over [`super::client`];
//! the rules are in [`super::project`] and [`super::route`].

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use super::client::{Client, CoreError};
use super::endpoint::CoreSocket;
use super::project::{self, Projection};
use super::route;
use crate::preview::PreviewState;
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
/// A document that cannot be read leaves each terminal in its group (`project`, rules 2 to 4).
pub async fn projection(sock: &CoreSocket, timeout: Duration) -> Result<Projection, CoreError> {
    let mut c = Client::connect(&sock.current(), timeout).await?;
    let list = c.call("terminal.list", json!({})).await?;
    let doc = c.call("doc.get", json!({ "name": project::LAYOUT_DOC })).await.ok();
    let terminals = list.get("terminals").and_then(Value::as_array).cloned().unwrap_or_default();
    let repos = super::repos::lookup(&project::folders(&terminals)).await;
    Ok(project::project(&terminals, doc.as_ref().and_then(|d| d.get("value")).filter(|v| !v.is_null()), &repos))
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

/// One preview line per core agent (only `wanted` panes when given). An agent with a known
/// transcript is read from its log, as herdr 1 agents are. Else the line comes from the 7501
/// message, else from the last line of the screen.
pub async fn previews(
    sock: &CoreSocket,
    timeout: Duration,
    home: &Path,
    state: &PreviewState,
    wanted: Option<&[String]>,
) -> Result<Vec<AgentPreview>, CoreError> {
    let list = once(sock, timeout, "terminal.list", json!({})).await?;
    let terminals = list.get("terminals").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut set = tokio::task::JoinSet::new();
    let mut order = 0;
    for t in terminals.iter().filter(|t| project::counts(t)) {
        let (Some(status), Some(addr)) = (project::agent_status(t), t.get("address").and_then(Value::as_str)) else { continue };
        let pane = project::pane_id(addr);
        if wanted.is_some_and(|w| !w.contains(&pane)) {
            continue;
        }
        let (sock, home, state, t) = (sock.clone(), home.to_path_buf(), state.clone(), t.clone());
        set.spawn(async move { (order, one_preview(&sock, timeout, &home, &state, &t, status, pane).await) });
        order += 1;
    }
    // The agents run at the same time; the result keeps the order of the terminal list.
    let mut out = Vec::new();
    while let Some(r) = set.join_next().await {
        if let Ok(r) = r {
            out.push(r);
        }
    }
    out.sort_by_key(|(order, _)| *order);
    Ok(out.into_iter().map(|(_, p)| p).collect())
}

/// The preview of one core agent. The log gives the reply and, when it has them, the activity or
/// question. What the log lacks for the status comes from the 7501 message, else the screen.
async fn one_preview(sock: &CoreSocket, timeout: Duration, home: &Path, state: &PreviewState, t: &Value, status: AgentStatus, pane: String) -> AgentPreview {
    let mut p = AgentPreview {
        pane_id: pane.clone(),
        activity: None,
        last_reply: None,
        question: None,
        status_since: project::status_since(t),
        source: "screen".into(),
        background: None,
    };
    // The log work of one agent is bounded as herdr 1's is. A timeout falls back to the screen.
    let from_log = tokio::time::timeout(crate::preview::PANE_TIMEOUT, log_preview(home, state, &pane, t)).await;
    let logged = match from_log {
        Ok(Some(lp)) => {
            crate::preview::fill_from_log(&mut p, status, &lp);
            true
        }
        _ => false,
    };
    let missing = match status {
        AgentStatus::Working => p.activity.is_none(),
        AgentStatus::Blocked => p.question.is_none(),
        _ => !logged,
    };
    if !missing {
        return p;
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
    match status {
        AgentStatus::Working => p.activity = line,
        AgentStatus::Blocked => p.question = line,
        _ => p.last_reply = line,
    }
    p
}

/// What the transcript of a core terminal says, or None when the agent has no known log.
/// The log path is cached per pane, as for herdr 1.
async fn log_preview(home: &Path, state: &PreviewState, pane: &str, record: &Value) -> Option<crate::preview::LogPreview> {
    let kind = project::agent_kind(record)?;
    crate::transcript::Agent::from_kind(&kind)?;
    let path = match state.cached_log(pane) {
        Some(l) => l,
        None => {
            let l = crate::transcript::resolve_core(home, record).await.log_path.map(PathBuf::from);
            state.cache_log(pane, l.clone());
            l
        }
    }?;
    tokio::task::spawn_blocking(move || crate::preview::read_any_log(&path)).await.ok()?.ok()
}
