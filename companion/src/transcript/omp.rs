//! omp (oh-my-pi) session logs: `~/.omp/agent/sessions/<folder>/<ts>_<id>.jsonl`. omp is a fork of
//! Pi and writes the Pi format (see [`super::pi`], which also reads the omp additions). Only the
//! folder names differ:
//!
//! - a cwd under the temp folder: `-tmp-<path from the temp folder>`,
//! - a cwd under home: `-<path from home>` (home itself: `-`),
//! - any other cwd: the Pi name `--<path>--`.
//!
//! In each name, `/`, `\` and `:` become `-`. omp resolves symbolic links in the cwd first. Older
//! omp versions used the Pi name for every cwd, so that folder is read too.
//!
//! Not read: the folders that the environment variables `PI_CONFIG_DIR`, `PI_CODING_AGENT_DIR`,
//! `PI_CODING_AGENT_SESSION_DIR` and the profiles select, and `$XDG_DATA_HOME/omp/sessions`.

use std::path::{Path, PathBuf};

use super::pi;

pub fn sessions_root(home: &Path) -> PathBuf {
    home.join(".omp").join("agent").join("sessions")
}

fn encode(rel: &str) -> String {
    rel.chars().map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c }).collect()
}

/// The omp folder name of `cwd`. All three paths are already resolved.
pub fn dir_name(home: &Path, tmp: &Path, cwd: &Path) -> String {
    let rel = |base: &Path| cwd.strip_prefix(base).ok().map(|r| r.to_string_lossy().into_owned());
    if tmp.parent().is_some() {
        if let Some(r) = rel(tmp) {
            return format!("-tmp-{}", encode(&r));
        }
    }
    if home.parent().is_some() {
        if let Some(r) = rel(home) {
            return format!("-{}", encode(&r));
        }
    }
    let p = cwd.to_string_lossy();
    format!("--{}--", encode(p.strip_prefix(['/', '\\']).unwrap_or(&p)))
}

/// The folders that can hold the sessions of `cwd`: the current name, then the older Pi name.
pub fn project_dirs(home: &Path, cwd: &str) -> Vec<PathBuf> {
    let real = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    let tmp = real(&std::env::temp_dir());
    let name = dir_name(&real(home), &tmp, &real(Path::new(cwd)));
    let root = sessions_root(home);
    let mut dirs = vec![root.join(name)];
    let old = root.join(pi::project_dir(Path::new("/"), cwd).file_name().unwrap_or_default());
    if !dirs.contains(&old) {
        dirs.push(old);
    }
    dirs
}

/// True when the header cwd of a session names `cwd` (the same path, or the same resolved path).
pub fn same_cwd(header: &str, cwd: &str) -> bool {
    if header == cwd {
        return true;
    }
    let real = |p: &str| Path::new(p).canonicalize().ok();
    matches!((real(header), real(cwd)), (Some(a), Some(b)) if a == b)
}
