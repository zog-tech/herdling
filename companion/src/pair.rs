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
/// Longest accepted `device_id` or `host_id`.
pub const MAX_ID: usize = 128;

const KEY_TYPE: &str = "ssh-ed25519";
/// OpenSSH `restrict` (OpenSSH 7.2 and later) turns off port, agent and X11 forwarding, the
/// PTY and `~/.ssh/rc`, and every restriction that a later OpenSSH adds. Older herdlingd versions
/// wrote `no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty`; such lines keep working,
/// because the dedupe and remove code compares only the key blob and the `herdling:` comment.
const KEY_OPTIONS: &str = "restrict";

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
    /// Pairing v2: the session is not known, was used, or is older than its time limit.
    #[error("unknown or expired pairing session")]
    NoSession,
    /// The companion's own path cannot go into a key line: a server fault, not a bad request.
    #[error("companion path cannot be quoted safely")]
    UnsafeExe,
}

impl PairError {
    /// Wire code for the `{error}` body.
    pub fn code(&self) -> &'static str {
        match self {
            PairError::BadRequest(_) => "bad_request",
            PairError::NoWindow => "no_window",
            PairError::BadCode => "bad_code",
            PairError::TooManyAttempts => "too_many_attempts",
            PairError::NoSession => "no_session",
            PairError::UnsafeExe => "internal",
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
    /// Pairing v2 exchanges that started and did not finish. Each one holds one try of the
    /// `MAX_WRONG` budget, because each one lets a peer test one code.
    #[serde(default)]
    started: u32,
}

impl Window {
    /// True when no try of the budget is free: wrong codes plus started v2 exchanges.
    fn budget_used(&self) -> bool {
        self.wrong.saturating_add(self.started) >= MAX_WRONG
    }
}

pub fn window_path(cfg_dir: &Path) -> PathBuf {
    cfg_dir.join("pair.json")
}

/// Takes the exclusive lock `pair.json.lock`. `herdlingd pair` and `serve` both change
/// `pair.json`, so every change holds this lock. The lock goes when the file is dropped.
fn lock_window(cfg_dir: &Path) -> std::io::Result<File> {
    fs::DirBuilder::new().recursive(true).mode(0o700).create(cfg_dir)?;
    let lock =
        OpenOptions::new().create(true).write(true).truncate(false).mode(0o600).open(cfg_dir.join("pair.json.lock"))?;
    fs4::fs_std::FileExt::lock_exclusive(&lock)?;
    Ok(lock)
}

/// Opens a new pairing window that ends `WINDOW` after `now` and returns its 6-digit code.
/// Replaces any open window.
pub fn open_window(cfg_dir: &Path, now: u64) -> anyhow::Result<String> {
    let code = format!("{:06}", rand::rng().random_range(0..1_000_000u32));
    let _lock = lock_window(cfg_dir)?;
    let _ = fs::remove_file(checked_path(cfg_dir));
    write_window(cfg_dir, &Window { code: code.clone(), expires_at: now + WINDOW.as_secs(), wrong: 0, started: 0 })?;
    Ok(code)
}

/// Writes `pair.json` with an atomic rename. The caller holds the window lock.
fn write_window(cfg_dir: &Path, w: &Window) -> std::io::Result<()> {
    fs::DirBuilder::new().recursive(true).mode(0o700).create(cfg_dir)?;
    let path = window_path(cfg_dir);
    let tmp = cfg_dir.join(format!("pair.json.{}.tmp", std::process::id()));
    let res = (|| {
        let mut f = OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open(&tmp)?;
        f.write_all(&serde_json::to_vec(w)?)?;
        f.sync_all()?;
        fs::rename(&tmp, &path)
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    res
}

/// Deletes `pair.json`. True when the file is gone afterwards.
pub fn close_window(cfg_dir: &Path) -> bool {
    // Fail closed: when the lock cannot be taken, delete the file all the same.
    let _lock = lock_window(cfg_dir).ok();
    remove_window(cfg_dir)
}

/// Deletes `pair.json`. The caller holds the window lock.
fn remove_window(cfg_dir: &Path) -> bool {
    match fs::remove_file(window_path(cfg_dir)) {
        Ok(()) => true,
        Err(e) => e.kind() == std::io::ErrorKind::NotFound,
    }
}

/// Checks `code` against the open window. On success the window is closed, so a
/// code works once. A wrong code is counted; at `MAX_WRONG` the window closes.
/// Started v2 exchanges hold tries too: when no try is free, the answer is `TooManyAttempts`.
pub fn take_window(cfg_dir: &Path, code: &str, now: u64) -> Result<(), PairError> {
    take_window_with(cfg_dir, code, now, || Ok::<(), std::convert::Infallible>(()))?.map_err(|e| match e {})
}

/// Like [`take_window`], but runs `save` when the code is right, before the window closes.
/// When `save` fails, the window stays open and the attempt does not count, so the phone can
/// try again with the same code. The call holds the window lock from the read to the last
/// write, so a close or a new window from `herdlingd pair` is never overwritten.
pub fn take_window_with<T, E>(
    cfg_dir: &Path,
    code: &str,
    now: u64,
    save: impl FnOnce() -> Result<T, E>,
) -> Result<Result<T, E>, PairError> {
    let Ok(_lock) = lock_window(cfg_dir) else { return Err(PairError::NoWindow) };
    let Ok(text) = fs::read(window_path(cfg_dir)) else { return Err(PairError::NoWindow) };
    let mut w: Window = match serde_json::from_slice(&text) {
        Ok(w) => w,
        Err(_) => {
            remove_window(cfg_dir);
            return Err(PairError::NoWindow);
        }
    };
    if now >= w.expires_at || w.wrong >= MAX_WRONG {
        remove_window(cfg_dir);
        return Err(PairError::NoWindow);
    }
    if w.budget_used() {
        return Err(PairError::TooManyAttempts);
    }
    if ct_eq(code.as_bytes(), w.code.as_bytes()) {
        let saved = save();
        // Single use: after a save the code must not work again. When the file cannot be
        // deleted, mark the window as out of attempts.
        if saved.is_ok() && !remove_window(cfg_dir) {
            w.wrong = MAX_WRONG;
            let _ = write_window(cfg_dir, &w);
        }
        return Ok(saved);
    }
    Err(count_wrong(cfg_dir, w))
}

/// Adds one wrong code to `w` and saves it. The caller holds the window lock.
fn count_wrong(cfg_dir: &Path, mut w: Window) -> PairError {
    w.wrong += 1;
    if w.wrong >= MAX_WRONG {
        remove_window(cfg_dir);
        return PairError::TooManyAttempts;
    }
    // Fail closed: when the counter cannot be saved, the window must not stay open.
    if write_window(cfg_dir, &w).is_err() {
        remove_window(cfg_dir);
    }
    if w.budget_used() {
        PairError::TooManyAttempts
    } else {
        PairError::BadCode
    }
}

/// Reads the window for a v2 step. The caller holds the window lock. A window that is past
/// its end or out of wrong codes is removed.
fn read_open_window(cfg_dir: &Path, now: u64) -> Result<Window, PairError> {
    let Ok(text) = fs::read(window_path(cfg_dir)) else { return Err(PairError::NoWindow) };
    let Ok(w) = serde_json::from_slice::<Window>(&text) else {
        remove_window(cfg_dir);
        return Err(PairError::NoWindow);
    };
    if now >= w.expires_at || w.wrong >= MAX_WRONG {
        remove_window(cfg_dir);
        return Err(PairError::NoWindow);
    }
    Ok(w)
}

/// Pairing v2, first step: takes one try of the window's budget for a new exchange and returns
/// the code, the CPace password. The try comes back only when the exchange ends with the
/// right code (the window then closes). An exchange that never finishes keeps its try.
pub fn reserve_try(cfg_dir: &Path, now: u64) -> Result<String, PairError> {
    let Ok(_lock) = lock_window(cfg_dir) else { return Err(PairError::NoWindow) };
    let mut w = read_open_window(cfg_dir, now)?;
    if w.budget_used() {
        return Err(PairError::TooManyAttempts);
    }
    w.started += 1;
    // Fail closed: a try that cannot be counted is not given.
    if write_window(cfg_dir, &w).is_err() {
        remove_window(cfg_dir);
        return Err(PairError::NoWindow);
    }
    Ok(w.code)
}

/// Pairing v2, last step: ends an exchange that [`reserve_try`] started with `code`.
/// `proof_ok` tells if the phone proved the code (its key-confirmation tag is right).
/// - Right: runs `save`, then closes the window. When `save` fails, the window stays open and
///   the try comes back, as with [`take_window_with`].
/// - Wrong: the try becomes a wrong code. At `MAX_WRONG` wrong codes the window closes.
///
/// A window with another code (a new `herdlingd pair`) gives `NoWindow` and is not changed.
pub fn settle_try<T, E>(
    cfg_dir: &Path,
    code: &str,
    now: u64,
    proof_ok: bool,
    save: impl FnOnce() -> Result<T, E>,
) -> Result<Result<T, E>, PairError> {
    let Ok(_lock) = lock_window(cfg_dir) else { return Err(PairError::NoWindow) };
    let mut w = read_open_window(cfg_dir, now)?;
    if !ct_eq(code.as_bytes(), w.code.as_bytes()) {
        return Err(PairError::NoWindow);
    }
    w.started = w.started.saturating_sub(1);
    if !proof_ok {
        return Err(count_wrong(cfg_dir, w));
    }
    let saved = save();
    if saved.is_ok() {
        if !remove_window(cfg_dir) {
            w.wrong = MAX_WRONG;
            let _ = write_window(cfg_dir, &w);
        }
    } else if write_window(cfg_dir, &w).is_err() {
        remove_window(cfg_dir);
    }
    Ok(saved)
}

/// The note that `serve` leaves for `herdlingd pair` after a v2 pairing.
fn checked_path(cfg_dir: &Path) -> PathBuf {
    cfg_dir.join("pair-checked.json")
}

#[derive(Serialize, Deserialize)]
struct Checked {
    device_id: String,
    public_key: String,
}

/// Notes that the device `device_id` paired with `public_key` through pairing v2: the phone
/// proved the code over that key. `herdlingd pair` then does not ask the user to compare keys.
pub fn record_checked(cfg_dir: &Path, device_id: &str, public_key: &str) -> std::io::Result<()> {
    let body = serde_json::to_vec(&Checked { device_id: device_id.into(), public_key: public_key.into() })?;
    let tmp = cfg_dir.join(format!("pair-checked.json.{}.tmp", std::process::id()));
    let res = (|| {
        let mut f = OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open(&tmp)?;
        f.write_all(&body)?;
        f.sync_all()?;
        fs::rename(&tmp, checked_path(cfg_dir))
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    res
}

/// Reads and deletes the note of [`record_checked`]: the device id and the key, if any.
pub fn take_checked(cfg_dir: &Path) -> Option<(String, String)> {
    let text = fs::read(checked_path(cfg_dir)).ok();
    let _ = fs::remove_file(checked_path(cfg_dir));
    let c: Checked = serde_json::from_slice(&text?).ok()?;
    Some((c.device_id, c.public_key))
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
    Ok(format!("{KEY_OPTIONS},command=\"{exe} rpc\" {key} herdling:{}", sanitize_name(device_name)))
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
    remove_lines(authorized_keys, public_key, false)
}

/// Like [`remove_key`], but removes only lines that end with a `herdling:<device>` comment,
/// so a line the user added for the same key stays.
pub fn remove_herdling_key(authorized_keys: &Path, public_key: &str) -> std::io::Result<usize> {
    remove_lines(authorized_keys, public_key, true)
}

fn is_herdling_line(line: &str) -> bool {
    line.trim_end_matches(['\r', '\n', ' ', '\t'])
        .rsplit([' ', '\t'])
        .next()
        .is_some_and(|c| c.starts_with("herdling:"))
}

fn remove_lines(authorized_keys: &Path, public_key: &str, only_herdling: bool) -> std::io::Result<usize> {
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
        if line_blob(l) == Some(blob) && (!only_herdling || is_herdling_line(l)) {
            removed += 1;
        } else {
            kept.push_str(l);
        }
    }
    if removed == 0 {
        return Ok(0);
    }
    let perms = fs::metadata(&target)?.permissions();
    let tmp = target.with_file_name(format!(".authorized_keys.herdlingd.{}.tmp", std::process::id()));
    let res = (|| {
        let mut f = OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open(&tmp)?;
        f.write_all(kept.as_bytes())?;
        f.set_permissions(perms)?;
        f.sync_all()?;
        fs::rename(&tmp, &target)
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    res.map(|()| removed)
}

/// A non-empty id of at most `MAX_ID` characters with no control characters, else `BadRequest`.
pub fn check_id(v: &str, field: &str) -> Result<(), PairError> {
    if v.is_empty() || v.len() > MAX_ID || v.chars().any(char::is_control) {
        return Err(PairError::BadRequest(format!("invalid {field}")));
    }
    Ok(())
}

/// A validated phone to add: what `POST /pair` and `herdlingd enroll` save.
#[derive(Debug)]
pub struct NewDevice {
    pub id: String,
    /// Sanitized with [`sanitize_name`].
    pub name: String,
    pub host_id: String,
    /// `ssh-ed25519 <blob>`, no comment.
    pub public_key: String,
    /// The exact `authorized_keys` line, from [`key_line`].
    line: String,
}

impl NewDevice {
    /// Checks the ids and the key and builds the key line. Bad input gives `BadRequest`;
    /// a companion path that cannot be quoted gives `UnsafeExe`.
    pub fn validate(exe: &Path, device_id: &str, device_name: &str, host_id: &str, public_key: &str) -> Result<NewDevice, PairError> {
        check_id(device_id, "device_id")?;
        check_id(host_id, "host_id")?;
        let public_key = parse_public_key(public_key)?;
        // The key is valid here, so a key_line error means the companion path is unsafe.
        let line = key_line(exe, &public_key, device_name).map_err(|_| PairError::UnsafeExe)?;
        Ok(NewDevice { id: device_id.into(), name: sanitize_name(device_name), host_id: host_id.into(), public_key, line })
    }
}

/// Adds the device's restricted key line to `authorized_keys` and upserts the device in the
/// config. A device that comes back with a new key loses its old herdling line first; a key
/// that is already there is not added twice. A `None` token keeps the saved token and prefs.
/// Returns the config's `ssh_port`.
pub fn save_device(authorized_keys: &Path, config_path: &Path, d: NewDevice, expo_token: Option<String>) -> anyhow::Result<u16> {
    // Re-pairing a device with a new key: its old key line must go, or the old key keeps
    // access that a later `pair.revoke` (which sends the current key) cannot remove.
    let existing = crate::config::load(config_path)?.devices.into_iter().find(|x| x.id == d.id);
    let old_key = existing.as_ref().and_then(|x| x.public_key.clone()).filter(|k| *k != d.public_key);
    if let Some(old) = old_key {
        remove_herdling_key(authorized_keys, &old)?;
    }
    append_key(authorized_keys, &d.line)?;
    let device = crate::config::Device {
        id: d.id,
        name: d.name,
        host_id: d.host_id,
        public_key: Some(d.public_key),
        // The app sends the push token only over the pinned SSH session (`push.register`),
        // so a re-pair with no token keeps the one already saved, and the prefs.
        expo_token: expo_token.or_else(|| existing.as_ref().and_then(|x| x.expo_token.clone())),
        capabilities: existing.as_ref().map(|x| x.capabilities.clone()).unwrap_or_default(),
        prefs: existing.map(|x| x.prefs).unwrap_or_default(),
    };
    crate::config::update(config_path, |c| {
        crate::config::upsert_device(c, device);
        c.ssh_port
    })
}

/// Where `serve` and `pair` look for the host key.
pub fn default_host_key_paths() -> Vec<PathBuf> {
    vec![PathBuf::from("/etc/ssh/ssh_host_ed25519_key.pub")]
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

/// `SHA256:<base64 no padding>` of the key blob of `public_key` (`<type> <blob> [comment]`),
/// as `ssh-keygen -lf` prints it. Safe to log: it is not the key.
pub fn key_fingerprint(public_key: &str) -> Option<String> {
    let raw = STANDARD.decode(public_key.split_whitespace().nth(1)?).ok()?;
    Some(format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(&raw))))
}

/// State of the pairing window file at `now`.
#[derive(Debug, PartialEq, Eq)]
pub enum WindowState {
    /// Open, with the seconds left.
    Open(u64),
    /// Still on disk, but past its end or out of attempts.
    Expired,
    /// No window file: a pairing used it, or it was closed.
    Closed,
}

pub fn window_state(cfg_dir: &Path, now: u64) -> WindowState {
    let Ok(text) = fs::read(window_path(cfg_dir)) else { return WindowState::Closed };
    match serde_json::from_slice::<Window>(&text) {
        Ok(w) if now < w.expires_at && w.wrong < MAX_WRONG => WindowState::Open(w.expires_at - now),
        _ => WindowState::Expired,
    }
}

/// A device that a pairing window added, or that came back with a new key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Added {
    pub id: String,
    pub name: String,
    /// `ssh-ed25519 <blob>`.
    pub public_key: String,
    /// See [`key_fingerprint`].
    pub fingerprint: String,
}

/// Devices in `after` that are new or have a new key compared to `before`.
pub fn added_devices(before: &[crate::config::Device], after: &[crate::config::Device]) -> Vec<Added> {
    after
        .iter()
        .filter(|d| !before.iter().any(|b| b.id == d.id && b.public_key == d.public_key))
        .filter_map(|d| {
            let public_key = d.public_key.clone()?;
            let fingerprint = key_fingerprint(&public_key)?;
            Some(Added { id: d.id.clone(), name: d.name.clone(), public_key, fingerprint })
        })
        .collect()
}

/// Like [`added_devices`], as `(name, key fingerprint)`. Used to print what a pairing window added.
pub fn new_devices(before: &[crate::config::Device], after: &[crate::config::Device]) -> Vec<(String, String)> {
    added_devices(before, after).into_iter().map(|a| (a.name, a.fingerprint)).collect()
}

/// True when the answer to "Keep this phone?" is `y` or `yes` (any case). Anything else,
/// the end of input or a timeout (`None`) is no.
pub fn keep_answer(line: Option<&str>) -> bool {
    line.map(str::trim).is_some_and(|a| a.eq_ignore_ascii_case("y") || a.eq_ignore_ascii_case("yes"))
}

/// The result of [`unpair`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unpair {
    /// No device has this id.
    NotFound,
    /// The device has another key than the expected key (or no key). Nothing changed.
    WrongKey,
    Removed { removed_keys: usize, removed_device: bool },
}

/// Removes device `id`: its `herdling:` key line from `authorized_keys` and its config entry.
/// With `expect_key`, the saved key of the device must be that key, else nothing changes.
/// Without it (`herdlingd unpair`), the saved key is removed, if the device has one.
/// Lines that the user added for the same key stay (see [`remove_herdling_key`]).
pub fn unpair(authorized_keys: &Path, config_path: &Path, id: &str, expect_key: Option<&str>) -> anyhow::Result<Unpair> {
    let cfg = crate::config::load(config_path)?;
    let Some(device) = cfg.devices.iter().find(|d| d.id == id) else { return Ok(Unpair::NotFound) };
    if expect_key.is_some() && device.public_key.as_deref() != expect_key {
        return Ok(Unpair::WrongKey);
    }
    let removed_keys = match &device.public_key {
        Some(key) => remove_herdling_key(authorized_keys, key)?,
        None => 0,
    };
    let removed_device = crate::config::update(config_path, |c| {
        let before = c.devices.len();
        c.devices.retain(|d| d.id != id);
        c.devices.len() != before
    })?;
    Ok(Unpair::Removed { removed_keys, removed_device })
}

/// The text of `herdlingd devices`: one line per device with its id, name and key fingerprint.
/// It never shows the key itself or the push token.
pub fn format_devices(devices: &[crate::config::Device]) -> String {
    if devices.is_empty() {
        return "No paired devices.\n".into();
    }
    let rows: Vec<[String; 3]> = devices
        .iter()
        .map(|d| {
            let fp = d.public_key.as_deref().and_then(key_fingerprint).unwrap_or_else(|| "(no key)".into());
            [d.id.clone(), d.name.clone(), fp]
        })
        .collect();
    let header = ["ID".to_string(), "NAME".to_string(), "KEY".to_string()];
    let width = |i: usize| rows.iter().chain(std::iter::once(&header)).map(|r| r[i].chars().count()).max().unwrap_or(0);
    let (w0, w1) = (width(0), width(1));
    std::iter::once(&header)
        .chain(rows.iter())
        .map(|r| format!("{:w0$}  {:w1$}  {}\n", r[0], r[1], r[2]))
        .collect()
}

/// Percent-encodes everything except RFC 3986 unreserved characters.
fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => char::from(b).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The QR / deep link. `fingerprint` is the host key fingerprint the app must see in the pairing
/// answer. `v=2` tells the app to use only pairing v2; older apps ignore it.
pub fn pair_url(addr: &str, port: u16, code: &str, fingerprint: Option<&str>) -> String {
    let mut url = format!("herdling://pair?h={}&p={port}&c={}", url_encode(addr), url_encode(code));
    if let Some(fp) = fingerprint {
        url.push_str("&f=");
        url.push_str(&url_encode(fp));
    }
    url.push_str("&v=2");
    url
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
