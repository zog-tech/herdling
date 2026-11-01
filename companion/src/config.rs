//! Companion config file (`~/.config/herdling/config.toml`). Written only through [`update`].

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

fn default_pair_port() -> u16 {
    7790
}

fn default_ssh_port() -> u16 {
    22
}

/// Unknown keys are ignored, so an old file with `anthropic_key` still loads (the key is
/// dropped on the next write).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Config {
    #[serde(default)]
    pub devices: Vec<Device>,
    /// argv run by `summary.make`. Unset or empty means no host summary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_command: Option<Vec<String>>,
    /// argv run by `tts.make`. Unset or empty means no host voice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tts_command: Option<Vec<String>>,
    /// argv run by `stt.make`. Unset or empty means no host transcription.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stt_command: Option<Vec<String>>,
    #[serde(default = "default_pair_port")]
    pub pair_port: u16,
    #[serde(default = "default_ssh_port")]
    pub ssh_port: u16,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            devices: vec![],
            summary_command: None,
            tts_command: None,
            stt_command: None,
            pair_port: default_pair_port(),
            ssh_port: default_ssh_port(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub host_id: String,
    pub public_key: Option<String>,
    pub expo_token: Option<String>,
    /// Push features the app on this device can show, from `push.register` (for example
    /// [`CHOICE_ACTIONS`]). Empty for an older app.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub prefs: Prefs,
}

/// The app shows Yes and No buttons on a "needs you" push (category `herdling_choice`).
pub const CHOICE_ACTIONS: &str = "choice_actions";

impl Device {
    /// True when the app on this device registered `capability`.
    pub fn can(&self, capability: &str) -> bool {
        self.capabilities.iter().any(|c| c == capability)
    }
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Prefs {
    pub finished: bool,
    pub needs_you: bool,
    /// No pushes while the user is active at the computer. A file without the key gets true.
    #[serde(default = "default_true")]
    pub quiet_at_desk: bool,
    /// One notification per agent: a new push replaces the old one of the same pane
    /// (`collapseId`, `tag`). A file without the key gets true.
    #[serde(default = "default_true")]
    pub replace: bool,
    /// Group the notifications of this computer (iOS `threadId`). A file without the key gets true.
    #[serde(default = "default_true")]
    pub group: bool,
    /// A "finished" push has no sound and no banner (iOS `interruptionLevel: passive`).
    /// A file without the key gets true.
    #[serde(default = "default_true")]
    pub quiet_finished: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { finished: true, needs_you: true, quiet_at_desk: true, replace: true, group: true, quiet_finished: true }
    }
}

pub fn default_path(home: &Path) -> PathBuf {
    home.join(".config/herdling/config.toml")
}

/// Reads the config. A missing file gives the default config.
pub fn load(path: &Path) -> Result<Config> {
    match fs::read_to_string(path) {
        Ok(s) => toml::from_str(&s).map_err(|e| parse_error(path, &s, &e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(e).with_context(|| format!("read {}", path.display())),
    }
}

/// Applies `f` to the config under an exclusive lock and writes it back atomically
/// (temp file, mode 0600, rename). Creates the directory with mode 0700.
pub fn update<T>(path: &Path, f: impl FnOnce(&mut Config) -> T) -> Result<T> {
    let dir = path.parent().context("config path has no parent")?;
    fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    let lock = open_private(&path.with_extension("toml.lock"), false)?;
    fs4::fs_std::FileExt::lock_exclusive(&lock).context("lock config")?;
    let mut cfg = load(path)?;
    let out = f(&mut cfg);
    let tmp = path.with_extension("toml.tmp");
    let mut file = open_private(&tmp, true)?;
    file.write_all(toml::to_string_pretty(&cfg)?.as_bytes())?;
    file.sync_all()?;
    fs::rename(&tmp, path)?;
    // The lock is released when `lock` drops.
    Ok(out)
}

fn open_private(path: &Path, truncate: bool) -> std::io::Result<File> {
    OpenOptions::new().create(true).write(true).truncate(truncate).mode(0o600).open(path)
}

/// Replaces the device with the same id, else appends.
pub fn upsert_device(c: &mut Config, d: Device) {
    match c.devices.iter_mut().find(|x| x.id == d.id) {
        Some(slot) => *slot = d,
        None => c.devices.push(d),
    }
}

/// Parse error with line and column only. The toml error text embeds the source
/// snippet, which can hold secrets, so it is never passed on.
fn parse_error(path: &Path, src: &str, e: &toml::de::Error) -> anyhow::Error {
    let at = e.span().map(|r| {
        let before = &src[..r.start.min(src.len())];
        let line = before.matches('\n').count() + 1;
        let col = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
        format!(" at line {line}, column {col}")
    });
    anyhow::anyhow!("parse {}{}: {}", path.display(), at.unwrap_or_default(), e.message())
}
