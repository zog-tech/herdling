//! Pure rules that put a herdr-core terminal into a group: the Herdr app space, a user label,
//! the git repo or the folder. No I/O and no clock: the terminal records and the repo facts
//! come in as parameters.

use std::collections::HashMap;

use serde_json::Value;

use super::project::{agent_kind, agent_status, cwd_now, text};

/// The terminal label that sets the group by hand.
pub const GROUP_LABEL: &str = "herdling.group";
/// The group label of a terminal that has no folder.
pub const NO_FOLDER_LABEL: &str = "Terminals";

/// Facts about a git repo.
#[derive(Debug, Clone, PartialEq)]
pub struct RepoInfo {
    pub root: String,
    pub name: String,
    pub branch: Option<String>,
}

/// Where a group name comes from.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum GroupSource {
    Space,
    Label,
    Repo,
    Folder,
}

impl GroupSource {
    /// The word of the source in the protocol.
    pub fn word(self) -> &'static str {
        match self {
            GroupSource::Space => "space",
            GroupSource::Label => "label",
            GroupSource::Repo => "repo",
            GroupSource::Folder => "folder",
        }
    }
}

/// A group of terminals.
#[derive(Debug, Clone, PartialEq)]
pub struct Group {
    pub key: String,
    pub label: String,
    pub source: GroupSource,
}

/// The repo of a folder, or `None` when the folder is in no repo. The key is a folder path
/// as [`folder_of`] gives it.
pub type Repos = HashMap<String, Option<RepoInfo>>;

/// The space and tab that the labels of a terminal name.
#[derive(Debug, Clone, PartialEq)]
pub struct LabelSpace {
    pub space: String,
    pub tab: Option<String>,
    pub name: Option<String>,
}

/// The foreground folder of a terminal, else the start folder.
pub fn folder_of(t: &Value) -> Option<&str> {
    cwd_now(t)
}

fn label<'a>(t: &'a Value, key: &str) -> Option<&'a str> {
    t.get("labels").and_then(|l| text(l, key))
}

/// The space name in the `where` label of a terminal: the part before the last `" / "`,
/// trimmed. A label with no `" / "` gives the whole label. None when the result is empty.
pub fn where_name(t: &Value) -> Option<String> {
    label(t, "where")
        .map(|w| w.rsplit_once(" / ").map_or(w, |(head, _)| head).trim())
        .filter(|n| !n.is_empty())
        .map(String::from)
}

/// The space that the `herdr.*` labels name. None when the space label is missing or empty.
/// The name is [`where_name`].
pub fn label_space(t: &Value) -> Option<LabelSpace> {
    let space = label(t, "herdr.space")?.to_string();
    let tab = label(t, "herdr.tab").map(String::from);
    Some(LabelSpace { space, tab, name: where_name(t) })
}

/// The group of a terminal when no Herdr space names it: the label, the repo, the folder.
pub fn fallback_group(t: &Value, repos: &Repos) -> Group {
    let make = |label: &str, source| Group { key: group_key(label), label: label.to_string(), source };
    if let Some(l) = label(t, GROUP_LABEL) {
        return make(l.trim(), GroupSource::Label);
    }
    let Some(folder) = folder_of(t) else {
        return make(NO_FOLDER_LABEL, GroupSource::Folder);
    };
    if let Some(Some(repo)) = repos.get(folder) {
        return make(&repo.name, GroupSource::Repo);
    }
    let last = folder.trim_end_matches('/').rsplit('/').next().filter(|s| !s.is_empty());
    make(last.unwrap_or(NO_FOLDER_LABEL), GroupSource::Folder)
}

/// A stable key of a group label: trimmed, lower case. Each run of characters other than
/// `a-z0-9-_.` becomes one `-`. An empty label gives `terminals`.
pub fn group_key(label: &str) -> String {
    let mut key = String::new();
    let mut in_run = false;
    for c in label.trim().to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.') {
            key.push(c);
            in_run = false;
        } else if !in_run {
            key.push('-');
            in_run = true;
        }
    }
    if key.is_empty() {
        "terminals".into()
    } else {
        key
    }
}

fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace() && !matches!(c, '-' | '_')).flat_map(char::to_lowercase).collect()
}

/// The task name of a terminal: the `herdling.name` label (a rename from the phone), else the
/// name, else the status title, else the terminal title.
/// A candidate that only repeats the reported app or the agent kind (for example the title
/// "Claude Code" of a new agent) is skipped. None when no candidate is left.
pub fn task_name(t: &Value) -> Option<String> {
    let generic: Vec<String> = t
        .get("status")
        .and_then(|s| text(s, "app"))
        .map(String::from)
        .into_iter()
        .chain(agent_kind(t))
        .map(|g| squash(&g))
        .collect();
    [label(t, super::actions::NAME_LABEL), text(t, "name"), t.get("status").and_then(|s| text(s, "title")), text(t, "title")]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|c| !generic.contains(&squash(c)))
        .map(String::from)
}

/// The live agent that started helper `t`. None when the parent is gone, is not an agent, is
/// `t` itself, or runs on another machine.
pub fn live_parent<'a>(t: &Value, live: &[&'a Value]) -> Option<&'a Value> {
    let parent = text(t, "parent").filter(|p| !p.contains('/'))?;
    if text(t, "address") == Some(parent) {
        return None;
    }
    live.iter().copied().find(|r| text(r, "address") == Some(parent) && agent_status(r).is_some())
}

/// The name that an entry and a pane of terminal `t` show on a card. The first that exists:
/// the task name, the Herdr app tab name `tab_name`, the terminal name, the status title, the
/// terminal title, the reported app, the agent kind, the address. Never empty, and never the
/// space name: an old app shows the space name when a card has no name.
pub fn display_name(t: &Value, tab_name: Option<&str>) -> String {
    let status = t.get("status");
    task_name(t)
        .or_else(|| tab_name.map(str::trim).filter(|n| !n.is_empty()).map(String::from))
        .or_else(|| {
            [text(t, "name"), status.and_then(|s| text(s, "title")), text(t, "title"), status.and_then(|s| text(s, "app"))]
                .into_iter()
                .flatten()
                .map(|s| s.trim().to_string())
                .next()
        })
        .or_else(|| agent_kind(t))
        .or_else(|| text(t, "address").map(String::from))
        .unwrap_or_else(|| "terminal".into())
}
