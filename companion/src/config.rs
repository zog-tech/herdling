//! Companion config file (`~/.config/zogsshd/config.toml`). Written only through [`update`].

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

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Config {
    #[serde(default)]
    pub devices: Vec<Device>,
    pub anthropic_key: Option<String>,
    #[serde(default = "default_pair_port")]
    pub pair_port: u16,
    #[serde(default = "default_ssh_port")]
    pub ssh_port: u16,
}

impl Default for Config {
    fn default() -> Self {
        Config { devices: vec![], anthropic_key: None, pair_port: default_pair_port(), ssh_port: default_ssh_port() }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub host_id: String,
    pub public_key: Option<String>,
    pub expo_token: Option<String>,
    #[serde(default)]
    pub prefs: Prefs,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Prefs {
    pub finished: bool,
    pub needs_you: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { finished: true, needs_you: true }
    }
}

pub fn default_path(home: &Path) -> PathBuf {
    home.join(".config/zogsshd/config.toml")
}

/// Reads the config. A missing file gives the default config.
pub fn load(path: &Path) -> Result<Config> {
    match fs::read_to_string(path) {
        Ok(s) => toml::from_str(&s).with_context(|| format!("parse {}", path.display())),
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
