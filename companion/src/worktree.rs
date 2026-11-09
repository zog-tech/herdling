//! `git.worktree_add` through herdr: herdr `worktree.create` makes the worktree and opens it
//! as a workspace in the worktree group of the repo, in the herdr sidebar.
//!
//! [`crate::git::worktree_plan`] checks the branch name and finds the folder first. herdr gets
//! only these checked values. When herdr is not there, has no `worktree.create`, or cannot use
//! the folder as a worktree source (a linked worktree), the caller uses `git worktree add`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use crate::git::{Worktree, WorktreePlan};
use crate::herdr::{Client, HerdrError};

/// Bound for herdr `worktree.create`. herdr answers after `git worktree add` ends, so it is
/// longer than the git bound. The app waits 90 s for `git.worktree_add`.
pub const HERDR_WORKTREE_TIMEOUT: Duration = Duration::from_secs(75);

/// herdr sockets that answered "unknown method" to `worktree.create`. The cache lives as long as
/// the process: one SSH channel for `herdlingd rpc`.
static UNSUPPORTED: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// True when the herdr error means that herdr does not have the method. herdr answers an
/// unknown method with `invalid_request` ("unknown variant"). A fake or a proxy can say
/// `unknown_method`.
pub fn is_unknown_method(code: &str, message: &str) -> bool {
    code == "unknown_method" || (code == "invalid_request" && message.contains("unknown variant"))
}

/// True when herdr refuses the folder as a worktree source, but git can still make the worktree.
/// herdr starts new worktrees only from the main checkout of a repo.
fn git_can_do_it(code: &str) -> bool {
    matches!(code, "linked_worktree_source" | "not_git_worktree")
}

/// Makes the worktree of `plan` with herdr `worktree.create`. `Ok(None)` tells the caller to use
/// git: herdr is not there, has no `worktree.create`, or refuses the source folder. Any other
/// herdr error comes back as an error and the caller does not try git: herdr can still be at work.
pub async fn create(socket: &Path, plan: &WorktreePlan) -> Result<Option<Worktree>, HerdrError> {
    if UNSUPPORTED.lock().map(|s| s.contains(socket)).unwrap_or(false) {
        return Ok(None);
    }
    let Ok(mut client) = Client::connect(socket, HERDR_WORKTREE_TIMEOUT).await else {
        return Ok(None);
    };
    let params = json!({
        "cwd": plan.root.to_string_lossy(),
        "branch": plan.branch,
        "path": plan.path.to_string_lossy(),
        "base": "HEAD",
        "focus": false,
    });
    let got = match client.call("worktree.create", params).await {
        Ok(v) => v,
        Err(HerdrError::Remote { code, message }) if is_unknown_method(&code, &message) => {
            if let Ok(mut s) = UNSUPPORTED.lock() {
                s.insert(socket.to_path_buf());
            }
            return Ok(None);
        }
        Err(HerdrError::Remote { code, .. }) if git_can_do_it(&code) => return Ok(None),
        Err(e) => return Err(e),
    };
    crate::git::exclude_worktrees(&plan.root).await;
    Ok(Some(from_herdr(plan, &got)))
}

/// The `git.worktree_add` result from the `worktree_created` answer of herdr.
pub fn from_herdr(plan: &WorktreePlan, got: &Value) -> Worktree {
    let text = |a: &str, b: &str| got.get(a).and_then(|o| o.get(b)).and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from);
    let mut w = plan.git_result();
    w.via = "herdr";
    // An older herdr can put the worktree in its own folder. The app needs the real folder.
    if let Some(path) = text("worktree", "path") {
        w.path = path;
    }
    w.workspace_id = text("workspace", "workspace_id");
    w.tab_id = text("tab", "tab_id");
    w.pane_id = text("root_pane", "pane_id");
    w
}
