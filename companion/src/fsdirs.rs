//! `fs.dirs`: list sub-directories of a path, for the folder picker.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::transcript;

/// Cap on `recent_cwds`.
pub const RECENT_CAP: usize = 30;

/// Optional params of `fs.dirs`. The defaults give the result of herdlingd 0.1.0.
#[derive(Debug, Clone, Copy)]
pub struct DirsOpts {
    /// Also list hidden directories (names that start with a dot).
    pub hidden: bool,
    /// Read `recent_cwds`. The app turns it off while it browses: the scan of agent logs costs
    /// more than the listing itself.
    pub recent: bool,
}

impl Default for DirsOpts {
    fn default() -> Self {
        DirsOpts { hidden: false, recent: true }
    }
}

/// `path` defaults to home; a leading `~` means home. Hidden directories are skipped.
pub fn dirs(home: &Path, path: Option<&str>) -> std::io::Result<Value> {
    dirs_with(home, path, DirsOpts::default())
}

/// As [`dirs`], with the optional params. `git_dirs` names the entries that have a `.git`
/// (a repo or a worktree root). `hidden` echoes the option, so the app knows this herdlingd
/// can list hidden directories. Without `recent`, `recent_cwds` is empty.
pub fn dirs_with(home: &Path, path: Option<&str>, opts: DirsOpts) -> std::io::Result<Value> {
    let target: PathBuf = match path {
        None | Some("") | Some("~") => home.to_path_buf(),
        Some(p) => match p.strip_prefix("~/") {
            Some(rest) => home.join(rest),
            None => PathBuf::from(p),
        },
    };
    let target = target.canonicalize()?;
    let mut entries: Vec<(String, PathBuf)> = std::fs::read_dir(&target)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| Some((e.file_name().into_string().ok()?, e.path())))
        .filter(|(n, _)| opts.hidden || !n.starts_with('.'))
        .collect();
    entries.sort_by_key(|(n, _)| n.to_lowercase());
    // One stat per entry: cheap next to the read of the folder itself.
    let git_dirs: Vec<&str> = entries.iter().filter(|(_, p)| p.join(".git").exists()).map(|(n, _)| n.as_str()).collect();
    let recent = if opts.recent { transcript::recent_cwds(home, RECENT_CAP) } else { Vec::new() };
    Ok(json!({
        "path": target.to_string_lossy(),
        "dirs": entries.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(),
        "git_dirs": git_dirs,
        "hidden": opts.hidden,
        "recent_cwds": recent,
    }))
}
