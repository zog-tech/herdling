//! `agents.installed`: which agent programs are on this computer, for the agent picker.
//!
//! herdr starts an agent in the login shell of the user, which can have a longer PATH than the
//! rpc process under SSH. So the search adds the usual install folders (Homebrew, npm, bun, nvm,
//! fnm, mise, pnpm) to the PATH. A kind with no known program name is in neither list: the app
//! shows it normally.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// herdr agent kinds and their program names. Only kinds with a known program are here.
pub const AGENT_BINS: &[(&str, &[&str])] = &[
    ("claude", &["claude"]),
    ("codex", &["codex"]),
    ("pi", &["pi"]),
    ("gemini", &["gemini"]),
    ("opencode", &["opencode"]),
    ("amp", &["amp"]),
    ("cursor", &["cursor-agent"]),
    ("copilot", &["copilot"]),
    ("droid", &["droid"]),
    ("kimi", &["kimi"]),
    ("qwen", &["qwen"]),
    ("grok", &["grok"]),
    ("cline", &["cline"]),
    ("omp", &["omp"]),
    ("kiro", &["kiro-cli"]),
    ("hermes", &["hermes"]),
    ("kilo", &["kilocode", "kilo"]),
    ("qodercli", &["qodercli"]),
    ("letta", &["letta"]),
];

/// Folders with one node version each: the `bin` folder of every version is searched.
const VERSION_ROOTS: &[(&str, &str)] = &[
    (".nvm/versions/node", "bin"),
    (".local/share/fnm/node-versions", "installation/bin"),
    (".fnm/node-versions", "installation/bin"),
    ("Library/Application Support/fnm/node-versions", "installation/bin"),
];

/// `base` (the PATH of the process and its extras) and the usual install folders, in that order,
/// without duplicates.
pub fn search_dirs(home: &Path, base: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = base.to_vec();
    let mut extra: Vec<PathBuf> = [
        ".local/bin",
        ".cargo/bin",
        ".bun/bin",
        ".npm-global/bin",
        ".yarn/bin",
        ".volta/bin",
        ".deno/bin",
        ".opencode/bin",
        ".claude/local",
        ".amp/bin",
        ".local/share/pnpm",
        "Library/pnpm",
        ".local/share/mise/shims",
        ".asdf/shims",
        "go/bin",
        "bin",
    ]
    .iter()
    .map(|d| home.join(d))
    .collect();
    extra.extend(["/opt/homebrew/bin", "/usr/local/bin", "/home/linuxbrew/.linuxbrew/bin"].map(PathBuf::from));
    for (root, sub) in VERSION_ROOTS {
        if let Ok(rd) = std::fs::read_dir(home.join(root)) {
            extra.extend(rd.filter_map(|e| e.ok()).map(|e| e.path().join(sub)));
        }
    }
    for d in extra {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

fn executable(p: &Path) -> bool {
    std::fs::metadata(p).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

/// `{"installed": [...], "missing": [...]}`: the kinds of [`AGENT_BINS`] with a program in
/// `dirs`, and the ones without. Both lists keep the order of `AGENT_BINS`.
pub fn installed(dirs: &[PathBuf]) -> Value {
    let (mut found, mut missing) = (Vec::new(), Vec::new());
    for (kind, bins) in AGENT_BINS {
        let has = bins.iter().any(|b| dirs.iter().any(|d| executable(&d.join(b))));
        if has { found.push(*kind) } else { missing.push(*kind) }
    }
    json!({ "installed": found, "missing": missing })
}
