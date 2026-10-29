//! `fs.dirs`: list sub-directories of a path, for the folder picker.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::claude;

/// Cap on `recent_cwds`.
pub const RECENT_CAP: usize = 30;

/// `path` defaults to home; a leading `~` means home. Hidden directories are skipped.
pub fn dirs(home: &Path, path: Option<&str>) -> std::io::Result<Value> {
    let target: PathBuf = match path {
        None | Some("") | Some("~") => home.to_path_buf(),
        Some(p) => match p.strip_prefix("~/") {
            Some(rest) => home.join(rest),
            None => PathBuf::from(p),
        },
    };
    let target = target.canonicalize()?;
    let mut names: Vec<String> = std::fs::read_dir(&target)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| !n.starts_with('.'))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    Ok(json!({
        "path": target.to_string_lossy(),
        "dirs": names,
        "recent_cwds": claude::recent_cwds(home, RECENT_CAP),
    }))
}
