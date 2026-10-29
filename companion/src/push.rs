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

/// One message per device that has a push token and wants `notice`.
pub fn messages(cfg: &Config, notice: Notice, pane: &str, title: &str, workspace: &str) -> Vec<PushMessage> {
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
        .filter_map(|d| {
            let to = d.expo_token.clone()?;
            Some(PushMessage {
                to,
                title: title.clone(),
                body: workspace.to_string(),
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
