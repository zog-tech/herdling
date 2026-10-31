//! Expo push messages. Push tokens are never logged.

use anyhow::{bail, Context};
use serde::Serialize;
use serde_json::Value;

use crate::config::Config;
use crate::serve::debounce::Notice;

#[derive(Serialize, Debug, PartialEq)]
pub struct PushMessage {
    pub to: String,
    pub title: String,
    pub body: String,
    pub sound: &'static str,
    pub data: PushData,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushData {
    pub host_id: String,
    pub pane_id: String,
}

/// One message per device that has a push token and wants `notice`. While the user is
/// `at_desk`, devices with `quiet_at_desk` get no message.
pub fn messages(cfg: &Config, notice: Notice, pane: &str, title: &str, body: &str, at_desk: bool) -> Vec<PushMessage> {
    let title = match notice {
        Notice::Finished => format!("{title} finished"),
        Notice::NeedsYou => format!("{title} needs you"),
    };
    cfg.devices
        .iter()
        .filter(|d| match notice {
            Notice::Finished => d.prefs.finished,
            Notice::NeedsYou => d.prefs.needs_you,
        })
        .filter(|d| !(at_desk && d.prefs.quiet_at_desk))
        .filter_map(|d| {
            let to = d.expo_token.clone()?;
            Some(PushMessage {
                to,
                title: title.clone(),
                body: body.to_string(),
                sound: "default",
                data: PushData { host_id: d.host_id.clone(), pane_id: pane.to_string() },
            })
        })
        .collect()
}

/// Posts `msgs` to the Expo push API at `url`. Returns the tokens Expo reports as
/// `DeviceNotRegistered`; the caller removes them from the config.
pub async fn send(client: &reqwest::Client, url: &str, msgs: &[PushMessage]) -> anyhow::Result<Vec<String>> {
    if msgs.is_empty() {
        return Ok(vec![]);
    }
    let resp = client.post(url).json(msgs).send().await.context("push request")?;
    let status = resp.status();
    if !status.is_success() {
        bail!("push request failed: HTTP {status}");
    }
    let body: Value = resp.json().await.context("push response")?;
    // Tickets come back in the order of the messages. One message may give a bare object.
    let tickets = match body.get("data") {
        Some(Value::Array(a)) => a.clone(),
        Some(t @ Value::Object(_)) => vec![t.clone()],
        _ => bail!("push response has no data"),
    };
    Ok(msgs
        .iter()
        .zip(&tickets)
        .filter(|(_, t)| t.pointer("/details/error").and_then(Value::as_str) == Some("DeviceNotRegistered"))
        .map(|(m, _)| m.to.clone())
        .collect())
}

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.trim().is_empty())
}

fn list<'a>(snap: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    snap.get(key).and_then(Value::as_array).into_iter().flatten()
}

/// Push title and body of `pane`, with the names the herdr apps use.
/// Title: the agent's own name, else the pane label, else the workspace label (plus
/// " · <tab label>" when the workspace has more than one tab), else the terminal title, the
/// agent kind or the pane id. Body: the agent kind, plus the terminal title when it is not the title.
pub fn describe(snap: &Value, pane: &str) -> (String, String) {
    let Some(agent) = list(snap, "agents").find(|a| text(a, "pane_id") == Some(pane)) else {
        return (pane.to_string(), String::new());
    };
    let pane_label = list(snap, "panes").find(|p| text(p, "pane_id") == Some(pane)).and_then(|p| text(p, "label"));
    let ws_id = text(agent, "workspace_id");
    let ws = list(snap, "workspaces").find(|w| ws_id.is_some() && text(w, "workspace_id") == ws_id);
    let tab_id = text(agent, "tab_id");
    let tab = list(snap, "tabs").find(|t| tab_id.is_some() && text(t, "tab_id") == tab_id);
    let tab_count = ws
        .and_then(|w| w.get("tab_count").and_then(Value::as_u64))
        .unwrap_or_else(|| list(snap, "tabs").filter(|t| ws_id.is_some() && text(t, "workspace_id") == ws_id).count() as u64);
    let place = ws.and_then(|w| text(w, "label")).map(|w| match tab.and_then(|t| text(t, "label")) {
        Some(t) if tab_count > 1 => format!("{w} · {t}"),
        _ => w.to_string(),
    });
    let terminal = text(agent, "terminal_title_stripped");
    let kind = text(agent, "display_agent").or_else(|| text(agent, "agent"));
    let title = text(agent, "name")
        .or(pane_label)
        .map(String::from)
        .or(place)
        .or_else(|| terminal.map(String::from))
        .or_else(|| kind.map(String::from))
        .unwrap_or_else(|| pane.to_string());
    let body = [kind, terminal.filter(|t| *t != title)].into_iter().flatten().collect::<Vec<_>>().join(" · ");
    (title, body)
}
