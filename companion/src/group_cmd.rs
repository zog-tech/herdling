//! `herdlingd group <name>` and `herdlingd group --clear`: set or remove the `herdling.group`
//! label of the Herdr 2 terminal that runs the command. The core puts `HC_TERMINAL_ID` and
//! `HC_TERMINAL_SOCKET` in each terminal. Only that one label changes.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

use crate::core::actions::group_name;
use crate::core::client::Client;
use crate::core::endpoint::CoreSocket;
use crate::core::groups::GROUP_LABEL;
use crate::core::live;

pub const USAGE: &str = "herdlingd group <name> | herdlingd group --clear";

/// What the command does.
#[derive(Debug, Clone, PartialEq)]
pub enum GroupCmd {
    Set(String),
    Clear,
}

/// The command from its arguments (after `group`). The words of the name are joined with one
/// space, so `herdlingd group web app` is the group "web app".
pub fn parse(args: &[String]) -> Result<GroupCmd, String> {
    match args {
        [] => Err(format!("give a group name\nusage: {USAGE}")),
        [flag] if flag == "--clear" => Ok(GroupCmd::Clear),
        _ if args.iter().any(|a| a.starts_with('-')) => Err(format!("unknown option\nusage: {USAGE}")),
        _ => {
            let name = group_name(&args.join(" ")).map_err(|e| e.message)?;
            if name.is_empty() {
                return Err(format!("give a group name\nusage: {USAGE}"));
            }
            Ok(GroupCmd::Set(name))
        }
    }
}

/// The `terminal.label` labels of the command. An empty value removes the label.
pub fn labels(cmd: &GroupCmd) -> Value {
    match cmd {
        GroupCmd::Set(name) => json!({ GROUP_LABEL: name }),
        GroupCmd::Clear => json!({ GROUP_LABEL: "" }),
    }
}

/// Runs the command for terminal `terminal` (`HC_TERMINAL_ID`) on `socket`
/// (`HC_TERMINAL_SOCKET`, else `fallback`). Returns the text for the user.
pub async fn run(cmd: &GroupCmd, terminal: Option<String>, socket: Option<PathBuf>, fallback: Option<CoreSocket>, timeout: Duration) -> Result<String, String> {
    let terminal = terminal
        .filter(|t| !t.is_empty())
        .ok_or("herdlingd group works only in a Herdr 2 terminal: HC_TERMINAL_ID is not set")?;
    let path = socket.filter(|p| !p.as_os_str().is_empty()).or_else(|| fallback.map(|f| f.current())).ok_or("no herdr-core socket")?;
    let mut c = Client::connect(&path, timeout).await.map_err(|e| e.to_string())?;
    live::require(&mut c, &["terminal.label"]).await.map_err(|e| e.message)?;
    c.call("terminal.label", json!({ "terminal": terminal, "labels": labels(cmd) })).await.map_err(|e| e.to_string())?;
    Ok(match cmd {
        GroupCmd::Set(name) => format!("Terminal {terminal} is in the group \"{name}\" in Herdling."),
        GroupCmd::Clear => format!("Terminal {terminal} has no group label now. Herdling groups it by its repo or folder."),
    })
}
