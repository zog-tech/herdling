//! `files.put`: saves a file from the app (for example a photo) so that an agent can read it.

use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;

use crate::types::RpcError;

/// Largest decoded file.
pub const MAX_BYTES: usize = 10 << 20;
/// Longest saved name, without the time prefix.
pub const MAX_NAME: usize = 64;
/// Uploads older than this are deleted on the next call.
pub const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

/// `home/.cache/zogsshd/uploads`.
pub fn dir(home: &Path) -> PathBuf {
    home.join(".cache/zogsshd/uploads")
}

/// Keeps `[A-Za-z0-9._-]`, replaces other chars with `_`, and keeps the extension when the
/// name is cut to `MAX_NAME` chars. A name with only dots and `_` gives `None`.
pub fn sanitize(name: &str) -> Option<String> {
    // Only the last path part: a name like `../../x` keeps `x`.
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String =
        base.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' }).collect();
    let clean = clean.trim_start_matches('.').to_string();
    if !clean.chars().any(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    if clean.len() <= MAX_NAME {
        return Some(clean);
    }
    // The text is ASCII here, so byte offsets are char offsets.
    match clean.rfind('.').filter(|&i| clean.len() - i <= 16) {
        Some(i) => Some(format!("{}{}", &clean[..MAX_NAME - (clean.len() - i)], &clean[i..])),
        None => Some(clean[..MAX_NAME].to_string()),
    }
}

/// Decodes `data_b64` and writes it to `dir(home)/<unix-ms>-<name>` (folder 0700, file 0600).
/// Deletes uploads older than `MAX_AGE` first (best effort). Returns the path.
pub fn put(home: &Path, name: &str, data_b64: &str, now: SystemTime) -> Result<PathBuf, RpcError> {
    let name = sanitize(name).ok_or_else(|| err("bad_request", "files.put: name has no usable chars"))?;
    // Base64 is 4 chars per 3 bytes: refuse a much too long string before decoding it.
    if data_b64.len() / 4 * 3 > MAX_BYTES + 3 {
        return Err(err("too_large", format!("files.put: the file is larger than {MAX_BYTES} bytes")));
    }
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_b64.trim())
        .map_err(|e| err("bad_request", format!("files.put: data_b64 is not base64: {e}")))?;
    if data.len() > MAX_BYTES {
        return Err(err("too_large", format!("files.put: the file is larger than {MAX_BYTES} bytes")));
    }
    let dir = dir(home);
    let io = |e: std::io::Error| err("io_error", format!("files.put: {e}"));
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&dir).map_err(io)?;
    // A folder made by an older version or by hand can have wider rights.
    let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    cleanup(&dir, now);
    let ms = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    // Two uploads with the same name in the same millisecond get different paths.
    for n in 0..100 {
        let file = if n == 0 { format!("{ms}-{name}") } else { format!("{ms}-{n}-{name}") };
        let path = dir.join(file);
        match std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path) {
            Ok(mut f) => {
                f.write_all(&data).map_err(io)?;
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(io(e)),
        }
    }
    Err(err("io_error", "files.put: no free file name"))
}

/// Deletes files in `dir` last changed more than `MAX_AGE` before `now`. Errors are ignored.
pub fn cleanup(dir: &Path, now: SystemTime) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let Ok(meta) = e.metadata() else { continue };
        let old = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .is_some_and(|age| age > MAX_AGE);
        if meta.is_file() && old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}
