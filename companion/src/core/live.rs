//! The calls to a running core that `rpc` and `serve` make. Thin I/O over [`super::client`];
//! the rules are in [`super::project`] and [`super::route`].

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use super::client::{Client, CoreError};
use super::endpoint::CoreSocket;
use super::project::{self, Projection};
use super::actions;
use super::route::{self, Action};
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
    run(sock, timeout, route::action(method, params, id)?).await
}

/// Checks that the core has each of `methods` (`hello.methods`). A core that does not list its
/// methods is tried. A missing method gives `unsupported`, before any change.
pub async fn require(c: &mut Client, methods: &[&str]) -> Result<(), RpcError> {
    let h = c.hello().await.map_err(rpc_err)?;
    let Some(list) = h.get("methods").and_then(Value::as_array) else { return Ok(()) };
    match methods.iter().find(|m| !list.iter().any(|l| l.as_str() == Some(m))) {
        Some(m) => Err(RpcError {
            code: route::UNSUPPORTED.into(),
            message: format!("this herdr-core has no {m}; update herdr-core"),
        }),
        None => Ok(()),
    }
}

async fn connect(sock: &CoreSocket, timeout: Duration) -> Result<Client, RpcError> {
    Client::connect(&sock.current(), timeout).await.map_err(rpc_err)
}

/// The projection, as an RPC result.
async fn placed(sock: &CoreSocket, timeout: Duration) -> Result<Projection, RpcError> {
    projection(sock, timeout).await.map_err(rpc_err)
}

/// A new shell at `place` (see [`actions::place_labels`]) in `cwd`. Returns the new terminal
/// address and the workspace and tab ids that the projection gives it.
pub async fn run_shell(sock: &CoreSocket, timeout: Duration, place: &actions::Place, cwd: Option<&str>) -> Result<(String, String, String), RpcError> {
    let ids = actions::fresh_ids();
    let shell = std::env::var("SHELL").ok();
    let params = actions::run_params(cwd, actions::place_labels(place, &ids), actions::shell_argv(shell.as_deref()));
    let mut c = connect(sock, timeout).await?;
    require(&mut c, &["terminal.run"]).await?;
    let t = c.call("terminal.run", params).await.map_err(rpc_err)?;
    let addr = t
        .get("address")
        .or_else(|| t.pointer("/terminal/address"))
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError { code: "internal".into(), message: "terminal.run gave no address".into() })?
        .to_string();
    let (ws, tab) = actions::placed_ids(place, &ids, &addr);
    Ok((addr, ws, tab))
}

/// The place of the workspace id `workspace`. Only a group id needs the projection.
pub async fn place(sock: &CoreSocket, timeout: Duration, workspace: Option<&str>) -> Result<actions::Place, RpcError> {
    let needs = workspace.and_then(super::ids::workspace).is_some_and(|w| matches!(w, super::ids::Workspace::Group(_)));
    let p = if needs { placed(sock, timeout).await? } else { Projection::default() };
    Ok(actions::place_of(workspace, &p)?)
}

/// Sends `text` to `addr` with the typing bound, after the method check.
pub async fn send(sock: &CoreSocket, timeout: Duration, addr: &str, text: &str) -> Result<Value, RpcError> {
    let mut c = connect(sock, timeout).await?;
    require(&mut c, &["terminal.send"]).await?;
    c.call_with("terminal.send", json!({ "terminal": addr, "text": text }), TYPING_TIMEOUT).await.map_err(rpc_err)
}

/// Sets `labels` on terminal `addr`. Only the labels that `core::actions` names come here.
pub async fn label(sock: &CoreSocket, timeout: Duration, addr: &str, labels: serde_json::Map<String, Value>) -> Result<Value, RpcError> {
    let mut c = connect(sock, timeout).await?;
    require(&mut c, &["terminal.label"]).await?;
    c.call("terminal.label", json!({ "terminal": addr, "labels": labels })).await.map_err(rpc_err)
}

/// Runs one action of [`route::action`].
pub async fn run(sock: &CoreSocket, timeout: Duration, action: Action) -> Result<Value, RpcError> {
    match action {
        Action::Call(plan) => {
            let bound = if matches!(plan.method, "terminal.send" | "terminal.keys") { TYPING_TIMEOUT } else { timeout };
            let mut c = connect(sock, timeout).await?;
            let r = c.call_with(plan.method, plan.params, bound).await.map_err(rpc_err)?;
            Ok(route::shape(&plan.shape, r))
        }
        Action::Run { kind, workspace, cwd } => {
            let place = place(sock, timeout, workspace.as_deref()).await?;
            let (addr, ws, tab) = run_shell(sock, timeout, &place, cwd.as_deref()).await?;
            Ok(actions::created(kind, &ws, &tab, &project::pane_id(&addr)))
        }
        Action::Start { addr, kind, args } => {
            let t = once(sock, timeout, "terminal.get", json!({ "terminal": addr })).await.map_err(rpc_err)?;
            let login = std::env::var("SHELL").ok();
            let line = actions::agent_line(&kind, &args, actions::family_of_terminal(&t, login.as_deref()))?;
            send(sock, timeout, &addr, &line).await?;
            Ok(json!({ "type": "agent_started", "agent": { "pane_id": project::pane_id(&addr) } }))
        }
        Action::Prompt { addr, text } => {
            let t = once(sock, timeout, "terminal.get", json!({ "terminal": addr })).await.map_err(rpc_err)?;
            if project::agent_status(&t).is_none() {
                // The app retries on this text while a new agent starts (`startSession`).
                return Err(RpcError {
                    code: "agent_not_ready".into(),
                    message: format!("not an active named agent yet: {} has reported no agent status", project::pane_id(&addr)),
                });
            }
            send(sock, timeout, &addr, &text).await
        }
        Action::Label { addr, labels } => Ok(project::pane_get(&label(sock, timeout, &addr, labels).await?)),
        Action::Kill(scope) => {
            let members = actions::members(&placed(sock, timeout).await?, &scope)?;
            let mut c = connect(sock, timeout).await?;
            require(&mut c, &["terminal.kill"]).await?;
            let mut closed = Vec::new();
            for addr in members {
                match c.call("terminal.kill", json!({ "terminal": addr })).await {
                    Ok(_) => closed.push(project::pane_id(&addr)),
                    // A terminal that ended meanwhile is closed already.
                    Err(e) if matches!(e.kind(), Some("not_found" | "finished")) => {}
                    Err(e) => return Err(rpc_err(e)),
                }
            }
            Ok(json!({ "closed": closed }))
        }
        Action::Explain { addr } => {
            let mut c = connect(sock, timeout).await?;
            let t = c.call("terminal.get", json!({ "terminal": addr })).await.map_err(rpc_err)?;
            let screen = c.call("terminal.read", json!({ "terminal": addr, "lines": 0 })).await.map_err(rpc_err)?;
            Ok(actions::explain(&t, screen.get("text").and_then(Value::as_str).unwrap_or("")))
        }
        Action::WorkspaceGet(id) => Ok(actions::workspace_get(&placed(sock, timeout).await?, &id)?),
    }
}

/// One preview line per core agent (only `wanted` panes when given). An agent with a known
/// transcript is read from its log. Else the line comes from the 7501
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
    // The log work of one agent is bounded. A timeout falls back to the screen.
    let from_log = tokio::time::timeout(crate::preview::PANE_TIMEOUT, log_preview(home, state, &pane, t)).await;
    let logged = match from_log {
        Ok(Some((path, lp))) => {
            crate::preview::fill_from_log(&mut p, status, &lp);
            // Claude Code also reports the background shells and subagents that still run.
            if crate::transcript::Agent::of_log(&path.to_string_lossy()) == crate::transcript::Agent::Claude {
                let info = project::process_info(t);
                p.background = crate::preview::claude_background(state, &pane, &path, &info["process_info"]).await;
            }
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

/// The log of a core terminal and what it says, or None when the agent has no known log.
/// The log path is cached per pane.
async fn log_preview(home: &Path, state: &PreviewState, pane: &str, record: &Value) -> Option<(PathBuf, crate::preview::LogPreview)> {
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
    let p = path.clone();
    let lp = tokio::task::spawn_blocking(move || crate::preview::read_any_log(&p)).await.ok()?.ok()?;
    Some((path, lp))
}

/// The result of `session.start`.
pub struct Started {
    pub addr: String,
    pub workspace: String,
    pub tab: String,
    pub prompt_error: Option<String>,
}

/// Starts an agent with the steps of [`super::start`]: a shell at `place` in `cwd`, the agent
/// command `plan.line`, then the first prompt once the agent reports a status.
pub async fn start_agent(sock: &CoreSocket, timeout: Duration, place: &actions::Place, cwd: &str, plan: &super::start::Plan) -> Result<Started, RpcError> {
    use super::start::{begin, step, Effect, Input, Outcome};
    let (mut state, mut effects) = begin();
    let mut ids: Option<(String, String)> = None;
    loop {
        let mut input = None;
        for effect in effects {
            match effect {
                Effect::Run => {
                    input = Some(match run_shell(sock, timeout, place, Some(cwd)).await {
                        Ok((addr, ws, tab)) => {
                            ids = Some((ws, tab));
                            Input::Ran(addr)
                        }
                        // A refusal before the shell runs keeps its code (unsupported, not found).
                        Err(e) => return Err(e),
                    });
                }
                Effect::Type { addr, line } => {
                    input = Some(match send(sock, timeout, &addr, &line).await {
                        Ok(_) => Input::Typed,
                        Err(e) => Input::Failed(e.message),
                    });
                }
                Effect::Wait(d) => tokio::time::sleep(d).await,
                Effect::Get(addr) => {
                    input = Some(match once(sock, timeout, "terminal.get", json!({ "terminal": addr })).await {
                        Ok(t) => Input::Record(t),
                        Err(e) => Input::Failed(rpc_err(e).message),
                    });
                }
                Effect::Send { addr, text } => {
                    input = Some(match send(sock, timeout, &addr, &text).await {
                        Ok(_) => Input::Sent,
                        Err(e) => Input::Failed(e.message),
                    });
                }
                Effect::Kill(addr) => {
                    let _ = once(sock, timeout, "terminal.kill", json!({ "terminal": addr })).await;
                }
                Effect::Finish(Outcome::Started { addr, prompt_error }) => {
                    let (workspace, tab) = ids.clone().unwrap_or_default();
                    return Ok(Started { addr, workspace, tab, prompt_error });
                }
                Effect::Finish(Outcome::Failed(message)) => return Err(RpcError { code: "start_failed".into(), message }),
            }
        }
        let Some(i) = input else {
            return Err(RpcError { code: "internal".into(), message: "session.start stopped with no result".into() });
        };
        (state, effects) = step(state, i, plan);
    }
}
