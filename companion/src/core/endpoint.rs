//! Where the herdr-core (Herdr 2) socket of this user is, found with the rules of `hc`
//! (herdr-core `crates/herdr-core/src/paths.rs` and `platform/unix.rs`, version 0.1.19):
//!
//! 1. `HC_SOCKET`.
//! 2. `socket` in `$XDG_CONFIG_HOME/herdr-core/config.toml` (default `~/.config/...`).
//! 3. `$XDG_RUNTIME_DIR/herdr-core/<session>.sock`.
//! 4. `/run/user/<uid>/herdr-core/<session>.sock` when that folder exists.
//! 5. `$XDG_STATE_HOME/herdr-core/<session>/<session>.sock` (default `~/.local/state/...`).
//!
//! `<session>` is `HC_SESSION`, else `default`. The forced SSH command and launchd often have no
//! `XDG_RUNTIME_DIR`, and the core can have started in a session that had one. So rules 3 to 5
//! give a list of candidates, and the first one that exists at use time wins. On macOS the core
//! ("Herdr Core.app", since 0.1.18) has no runtime folder, so its socket is the one of rule 5.
//!
//! Pure: the environment, the uid and the file checks come in as parameters.

use std::path::{Path, PathBuf};

/// The socket candidates of one core session, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreSocket {
    candidates: Vec<PathBuf>,
}

impl CoreSocket {
    /// One fixed socket path (an override, or a test).
    pub fn fixed(path: impl Into<PathBuf>) -> CoreSocket {
        CoreSocket { candidates: vec![path.into()] }
    }

    pub fn candidates(&self) -> &[PathBuf] {
        &self.candidates
    }

    /// The first candidate for which `exists` is true, else the first candidate.
    pub fn pick(&self, exists: &dyn Fn(&Path) -> bool) -> PathBuf {
        self.candidates.iter().find(|p| exists(p)).or(self.candidates.first()).cloned().unwrap_or_default()
    }

    /// [`CoreSocket::pick`] with the real file system.
    pub fn current(&self) -> PathBuf {
        self.pick(&|p| p.exists())
    }
}

/// What the resolution reads from the machine.
pub struct Inputs<'a> {
    /// An environment variable. Empty values count as unset.
    pub var: &'a dyn Fn(&str) -> Option<String>,
    /// The uid of this process.
    pub uid: u32,
    /// True when the folder exists.
    pub dir_exists: &'a dyn Fn(&Path) -> bool,
    /// The text of a file, when it can be read.
    pub read: &'a dyn Fn(&Path) -> Option<String>,
}

#[derive(serde::Deserialize)]
struct Config {
    socket: Option<String>,
}

/// The session name, as `hc` takes it. None when `hc` refuses the name.
pub fn session(raw: Option<&str>) -> Option<String> {
    let name = raw.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("default");
    if name == "." || name == ".." || name.chars().any(|c| c.is_control() || r#"/\:*?"<>|"#.contains(c)) {
        return None;
    }
    Some(name.to_string())
}

/// The socket candidates for `home`. None when the session name is not valid.
pub fn resolve(home: &Path, inputs: &Inputs) -> Option<CoreSocket> {
    let set = |k: &str| (inputs.var)(k).filter(|v| !v.is_empty());
    let session = session(set("HC_SESSION").as_deref())?;
    if let Some(s) = set("HC_SOCKET") {
        return Some(CoreSocket::fixed(s));
    }
    let config_home = set("XDG_CONFIG_HOME").map_or_else(|| home.join(".config"), PathBuf::from);
    let config = config_home.join("herdr-core").join("config.toml");
    // A config that `hc` cannot read is ignored there too.
    if let Some(s) = (inputs.read)(&config).and_then(|t| toml::from_str::<Config>(&t).ok()).and_then(|c| c.socket) {
        if !s.is_empty() {
            return Some(CoreSocket::fixed(s));
        }
    }
    let name = format!("{session}.sock");
    let mut candidates = Vec::new();
    if let Some(run) = set("XDG_RUNTIME_DIR") {
        candidates.push(PathBuf::from(run).join("herdr-core").join(&name));
    }
    let run_user = PathBuf::from(format!("/run/user/{}", inputs.uid));
    if (inputs.dir_exists)(&run_user) {
        let p = run_user.join("herdr-core").join(&name);
        if !candidates.contains(&p) {
            candidates.push(p);
        }
    }
    let state_home = set("XDG_STATE_HOME").map_or_else(|| home.join(".local/state"), PathBuf::from);
    candidates.push(state_home.join("herdr-core").join(&session).join(&name));
    Some(CoreSocket { candidates })
}

/// [`resolve`] with the real environment of this process.
pub fn from_env(home: &Path) -> Option<CoreSocket> {
    let var = |k: &str| std::env::var(k).ok();
    let dir_exists = |p: &Path| p.is_dir();
    let read = |p: &Path| std::fs::read_to_string(p).ok();
    // SAFETY: getuid has no preconditions and cannot fail.
    let uid = unsafe { libc::getuid() };
    resolve(home, &Inputs { var: &var, uid, dir_exists: &dir_exists, read: &read })
}
