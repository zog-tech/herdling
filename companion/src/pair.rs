//! Pairing: the short pairing window (`pair.json`), code checks, and the
//! `authorized_keys` line for a paired phone.
//!
//! Every input that ends up in `authorized_keys` is validated here. The key line
//! never contains text from the request other than the base64 key blob and the
//! sanitized device name.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use base64::Engine;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const WINDOW: Duration = Duration::from_secs(300);
pub const MAX_WRONG: u32 = 5;
/// Longest kept device name in the key comment.
pub const MAX_NAME: usize = 40;

const KEY_TYPE: &str = "ssh-ed25519";
const KEY_OPTIONS: &str = "no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty";

#[derive(thiserror::Error, Debug, PartialEq)]
pub enum PairError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("no pairing window is open")]
    NoWindow,
    #[error("wrong pairing code")]
    BadCode,
    #[error("too many wrong codes")]
    TooManyAttempts,
}

impl PairError {
    /// Wire code for the `{error}` body.
    pub fn code(&self) -> &'static str {
        match self {
            PairError::BadRequest(_) => "bad_request",
            PairError::NoWindow => "no_window",
            PairError::BadCode => "bad_code",
            PairError::TooManyAttempts => "too_many_attempts",
        }
    }
}

/// Contents of `pair.json`.
#[derive(Serialize, Deserialize, Debug)]
struct Window {
    code: String,
    expires_at: u64,
    #[serde(default)]
    wrong: u32,
}

pub fn window_path(cfg_dir: &Path) -> PathBuf {
    cfg_dir.join("pair.json")
}

/// Opens a new pairing window that ends `WINDOW` after `now` and returns its 6-digit code.
/// Replaces any open window.
pub fn open_window(cfg_dir: &Path, now: u64) -> anyhow::Result<String> {
    let code = format!("{:06}", rand::rng().random_range(0..1_000_000u32));
    write_window(cfg_dir, &Window { code: code.clone(), expires_at: now + WINDOW.as_secs(), wrong: 0 })?;
    Ok(code)
}

fn write_window(cfg_dir: &Path, w: &Window) -> std::io::Result<()> {
    fs::DirBuilder::new().recursive(true).mode(0o700).create(cfg_dir)?;
    let path = window_path(cfg_dir);
    let tmp = cfg_dir.join(format!("pair.json.{}.tmp", std::process::id()));
    let mut f = OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open(&tmp)?;
    f.write_all(&serde_json::to_vec(w)?)?;
    f.sync_all()?;
    fs::rename(&tmp, &path)
}

fn close_window(cfg_dir: &Path) {
    let _ = fs::remove_file(window_path(cfg_dir));
}

/// Checks `code` against the open window. On success the window is closed, so a
/// code works once. A wrong code is counted; at `MAX_WRONG` the window closes.
/// The caller must serialize calls (one pairing at a time).
pub fn take_window(cfg_dir: &Path, code: &str, now: u64) -> Result<(), PairError> {
    let path = window_path(cfg_dir);
    let Ok(text) = fs::read(&path) else { return Err(PairError::NoWindow) };
    let mut w: Window = match serde_json::from_slice(&text) {
        Ok(w) => w,
        Err(_) => {
            close_window(cfg_dir);
            return Err(PairError::NoWindow);
        }
    };
    if now >= w.expires_at || w.wrong >= MAX_WRONG {
        close_window(cfg_dir);
        return Err(PairError::NoWindow);
    }
    if ct_eq(code.as_bytes(), w.code.as_bytes()) {
        close_window(cfg_dir);
        return Ok(());
    }
    w.wrong += 1;
    if w.wrong >= MAX_WRONG {
        close_window(cfg_dir);
        return Err(PairError::TooManyAttempts);
    }
    // Fail closed: when the counter cannot be saved, the window must not stay open.
    if write_window(cfg_dir, &w).is_err() {
        close_window(cfg_dir);
    }
    Err(PairError::BadCode)
}

/// Constant-time byte comparison (time depends only on the lengths).
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        diff |= usize::from(a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0));
    }
    std::hint::black_box(diff) == 0
}

/// A 6-digit code, else `BadRequest`.
pub fn check_code_format(code: &str) -> Result<(), PairError> {
    if code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit()) {
        Ok(())
    } else {
        Err(PairError::BadRequest("code must be 6 digits".into()))
    }
}

/// Validates an OpenSSH ed25519 public key and returns it as `ssh-ed25519 <blob>`
/// (the comment is dropped). Matches `^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\r\n]*)?$`,
/// and the blob must decode to a canonical ed25519 key blob.
pub fn parse_public_key(public_key: &str) -> Result<String, PairError> {
    let bad = |m: &str| PairError::BadRequest(m.into());
    let rest = public_key
        .strip_prefix(KEY_TYPE)
        .and_then(|r| r.strip_prefix(' '))
        .ok_or_else(|| bad("public_key must start with ssh-ed25519"))?;
    let (blob, comment) = match rest.find(' ') {
        Some(i) => (&rest[..i], Some(&rest[i + 1..])),
        None => (rest, None),
    };
    let body = blob.trim_end_matches('=');
    if body.is_empty()
        || blob.len() - body.len() > 2
        || !body.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
    {
        return Err(bad("public_key blob is not base64"));
    }
    if comment.is_some_and(|c| c.contains(['\r', '\n'])) {
        return Err(bad("public_key comment has a line break"));
    }
    let raw = STANDARD.decode(blob).map_err(|_| bad("public_key blob is not base64"))?;
    if !is_ed25519_blob(&raw) || STANDARD.encode(&raw) != blob {
        return Err(bad("public_key is not an ed25519 key"));
    }
    Ok(format!("{KEY_TYPE} {blob}"))
}

/// `[0,0,0,11] "ssh-ed25519" [0,0,0,32] <32 bytes>`.
fn is_ed25519_blob(raw: &[u8]) -> bool {
    raw.len() == 4 + 11 + 4 + 32 && raw[..4] == [0, 0, 0, 11] && &raw[4..15] == KEY_TYPE.as_bytes() && raw[15..19] == [0, 0, 0, 32]
}

/// Keeps `[A-Za-z0-9._-]`, turns spaces into `-`, cuts to `MAX_NAME`; empty gives `phone`.
pub fn sanitize_name(name: &str) -> String {
    let s: String = name
        .chars()
        .filter_map(|c| match c {
            ' ' => Some('-'),
            c if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') => Some(c),
            _ => None,
        })
        .take(MAX_NAME)
        .collect();
    if s.is_empty() {
        "phone".into()
    } else {
        s
    }
}

/// The `authorized_keys` line (no trailing newline) that limits the key to `<exe> rpc`.
pub fn key_line(exe: &Path, public_key: &str, device_name: &str) -> Result<String, PairError> {
    let key = parse_public_key(public_key)?;
    let exe = exe
        .to_str()
        // sshd runs the command through the user's shell, so allow only plain path characters.
        .filter(|s| s.starts_with('/') && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"/._+@-".contains(&b)))
        .ok_or_else(|| PairError::BadRequest("companion path cannot be quoted safely".into()))?;
    Ok(format!("command=\"{exe} rpc\",{KEY_OPTIONS} {key} zogssh:{}", sanitize_name(device_name)))
}

/// Splits off the first field of an `authorized_keys` line. Whitespace inside double
/// quotes (option values) does not end the field.
fn split_field(s: &str) -> (&str, &str) {
    let mut quoted = false;
    let mut escaped = false;
    for (i, c) in s.char_indices() {
        if escaped {
            escaped = false;
        } else if quoted && c == '\\' {
            escaped = true;
        } else if c == '"' {
            quoted = !quoted;
        } else if !quoted && (c == ' ' || c == '\t') {
            return (&s[..i], s[i..].trim_start_matches([' ', '\t']));
        }
    }
    (s, "")
}

fn is_key_type(field: &str) -> bool {
    field.starts_with("ssh-") || field.starts_with("ecdsa-") || field.starts_with("sk-")
}

/// The base64 key blob of an `authorized_keys` line, or `None` for blank and comment lines.
fn line_blob(line: &str) -> Option<&str> {
    let s = line.trim_matches([' ', '\t', '\r', '\n']);
    if s.is_empty() || s.starts_with('#') {
        return None;
    }
    let (first, rest) = split_field(s);
    let rest = if is_key_type(first) { rest } else { split_field(rest).1 };
    let blob = split_field(rest).0;
    (!blob.is_empty()).then_some(blob)
}

/// Locks the directory that holds `authorized_keys`, so append and remove from the
/// serve and rpc processes do not interleave. Creates the directory with mode 0700.
fn lock_dir(authorized_keys: &Path) -> std::io::Result<File> {
    let dir = authorized_keys.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    let lock = File::open(dir)?;
    fs4::fs_std::FileExt::lock_exclusive(&lock)?;
    Ok(lock)
}

/// Appends `line`. Returns false, and writes nothing, when a line with the same key
/// blob is already there. Creates the file with mode 0600; an existing file keeps its mode.
pub fn append_key(authorized_keys: &Path, line: &str) -> std::io::Result<bool> {
    let blob = line_blob(line).ok_or_else(|| std::io::Error::other("key line has no key"))?;
    let _lock = lock_dir(authorized_keys)?;
    let mut f = OpenOptions::new().read(true).append(true).create(true).mode(0o600).open(authorized_keys)?;
    let mut text = String::new();
    f.read_to_string(&mut text)?;
    if text.lines().any(|l| line_blob(l) == Some(blob)) {
        return Ok(false);
    }
    let mut out = String::new();
    if !text.is_empty() && !text.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(line);
    out.push('\n');
    f.write_all(out.as_bytes())?;
    f.sync_all()?;
    Ok(true)
}

/// Removes every line whose key blob equals the blob of `public_key` (`<type> <blob> [comment]`).
/// Other lines stay byte for byte; the file keeps its mode. Returns the count removed.
pub fn remove_key(authorized_keys: &Path, public_key: &str) -> std::io::Result<usize> {
    let Some(blob) = public_key.split(' ').nth(1).filter(|b| !b.is_empty()) else { return Ok(0) };
    if !authorized_keys.exists() {
        return Ok(0);
    }
    let _lock = lock_dir(authorized_keys)?;
    let target = match fs::canonicalize(authorized_keys) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e),
    };
    let text = fs::read_to_string(&target)?;
    let mut kept = String::with_capacity(text.len());
    let mut removed = 0;
    for l in text.split_inclusive('\n') {
        if line_blob(l) == Some(blob) {
            removed += 1;
        } else {
            kept.push_str(l);
        }
    }
    if removed == 0 {
        return Ok(0);
    }
    let perms = fs::metadata(&target)?.permissions();
    let tmp = target.with_file_name(format!(".authorized_keys.zogsshd.{}.tmp", std::process::id()));
    let mut f = OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open(&tmp)?;
    f.write_all(kept.as_bytes())?;
    f.set_permissions(perms)?;
    f.sync_all()?;
    fs::rename(&tmp, &target)?;
    Ok(removed)
}

/// `SHA256:<base64 no padding>` of the key in the first readable `.pub` file, as `ssh-keygen -lf` prints it.
pub fn host_fingerprint(paths: &[PathBuf]) -> Option<String> {
    paths.iter().find_map(|p| {
        let text = fs::read_to_string(p).ok()?;
        let blob = text.split_whitespace().nth(1)?;
        let raw = STANDARD.decode(blob).ok()?;
        Some(format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(&raw))))
    })
}

pub fn pair_url(addr: &str, port: u16, code: &str) -> String {
    format!("zogssh://pair?h={addr}&p={port}&c={code}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_blob_handles_options() {
        assert_eq!(line_blob("ssh-ed25519 AAAA c"), Some("AAAA"));
        assert_eq!(line_blob("command=\"a b\\\" c\",no-pty ssh-ed25519 BBBB c"), Some("BBBB"));
        assert_eq!(line_blob("  # ssh-ed25519 AAAA"), None);
        assert_eq!(line_blob("\n"), None);
    }

    #[test]
    fn ct_eq_works() {
        assert!(ct_eq(b"123456", b"123456"));
        assert!(!ct_eq(b"123456", b"123457"));
        assert!(!ct_eq(b"12345", b"123456"));
    }
}
