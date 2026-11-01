//! Expo push messages. Push tokens are never logged.

use anyhow::{bail, Context};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::choices::PushChoice;
use crate::config::{Config, CHOICE_ACTIONS};
use crate::serve::debounce::Notice;

/// The notification category with the Yes and No actions. The app registers it.
pub const CHOICE_CATEGORY: &str = "herdling_choice";

/// The longest `collapseId` that APNs accepts (`apns-collapse-id`), in bytes.
pub const MAX_COLLAPSE_ID: usize = 64;

/// `herdling:<parts joined by ":">`, or `herdling:<32 hex digits of SHA-256>` when that is longer
/// than [`MAX_COLLAPSE_ID`] bytes. The same parts always give the same id.
pub fn stable_id(parts: &[&str]) -> String {
    let joined = parts.join(":");
    let id = format!("herdling:{joined}");
    if id.len() <= MAX_COLLAPSE_ID {
        return id;
    }
    let hex: String = Sha256::digest(joined.as_bytes()).iter().take(16).map(|b| format!("{b:02x}")).collect();
    format!("herdling:{hex}")
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushMessage {
    pub to: String,
    pub title: String,
    pub body: String,
    /// `None` gives a push without a sound: Expo plays no sound when the field is missing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound: Option<&'static str>,
    /// iOS 15 and later: `time-sensitive` for "needs you", `passive` for a quiet "finished".
    /// `time-sensitive` needs the Time Sensitive entitlement; without it iOS uses `active`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruption_level: Option<&'static str>,
    /// One notification per pane: a new push with the same id replaces the old one (APNs
    /// `apns-collapse-id`, at most [`MAX_COLLAPSE_ID`] bytes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapse_id: Option<String>,
    /// Android: the same id as `collapse_id`. A new push replaces the shown one with this tag.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// iOS: groups the notifications of one computer (APNs `thread-id`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    /// [`CHOICE_CATEGORY`] on a "needs you" push with Yes and No buttons.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
    pub data: PushData,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushData {
    pub host_id: String,
    pub pane_id: String,
    /// The Yes and No options of the menu, for the buttons of [`CHOICE_CATEGORY`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub choice: Option<PushChoice>,
}

/// One message per device that has a push token and wants `notice`. While the user is
/// `at_desk`, devices with `quiet_at_desk` get no message.
/// `choice` adds the Yes and No buttons to a "needs you" push, only for devices that registered
/// [`CHOICE_ACTIONS`]. Their body also shows the two labels, so the user knows what each button does.
/// The device prefs set the presentation: `replace` gives a `collapseId` and `tag` per host and pane,
/// `group` gives a `threadId` per host, and `quiet_finished` makes a "finished" push passive and silent.
pub fn messages(
    cfg: &Config,
    notice: Notice,
    pane: &str,
    title: &str,
    body: &str,
    at_desk: bool,
    choice: Option<&PushChoice>,
) -> Vec<PushMessage> {
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
            let choice = choice.filter(|_| notice == Notice::NeedsYou && d.can(CHOICE_ACTIONS));
            let body = match choice {
                Some(c) if body.is_empty() => format!("{} · {}", c.yes.label, c.no.label),
                Some(c) => format!("{body}\n{} · {}", c.yes.label, c.no.label),
                None => body.to_string(),
            };
            let quiet = notice == Notice::Finished && d.prefs.quiet_finished;
            let collapse = d.prefs.replace.then(|| stable_id(&[&d.host_id, pane]));
            Some(PushMessage {
                to,
                title: title.clone(),
                body,
                sound: (!quiet).then_some("default"),
                interruption_level: match notice {
                    Notice::NeedsYou => Some("time-sensitive"),
                    Notice::Finished => quiet.then_some("passive"),
                },
                tag: collapse.clone(),
                collapse_id: collapse,
                thread_id: d.prefs.group.then(|| stable_id(&[&d.host_id])),
                category_id: choice.map(|_| CHOICE_CATEGORY.to_string()),
                data: PushData { host_id: d.host_id.clone(), pane_id: pane.to_string(), choice: choice.cloned() },
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
