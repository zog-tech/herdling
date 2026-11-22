//! `files.put`: saves a file from the app (a photo, or a document such as a log, a PDF, a CSV or
//! a zip) so that an agent can read it. Any file type is accepted: the file is only data. It is
//! saved without the execute bit, under a cleaned name, and deleted after `MAX_AGE`.
//!
//! `files.put_begin`, `files.put_chunk`, `files.put_end` and `files.put_abort` save a large file
//! (a video) in parts. A request line cannot hold a large file, and one large line blocks the
//! channel. The parts go in order to a partial file in `PARTIAL_DIR`. `files.put_end` moves the
//! complete file next to the other uploads. The state is on disk only, so the rules are the same
//! for each rpc process.

use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;

use crate::types::RpcError;

/// Largest decoded file. Its base64 form (about 33.4 MiB) fits in one request line (`rpc::MAX_LINE`).
/// Before documents were accepted, the limit was 10 MiB.
pub const MAX_BYTES: usize = 25 << 20;
/// Longest saved name, without the time prefix.
pub const MAX_NAME: usize = 64;
/// Uploads older than this are deleted on the next call.
pub const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

/// `home/.cache/herdling/uploads`.
pub fn dir(home: &Path) -> PathBuf {
    home.join(".cache/herdling/uploads")
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

/// Makes the upload folder (0700), and sets 0700 on a folder made by an older version or by hand.
fn upload_dir(home: &Path, method: &str) -> Result<PathBuf, RpcError> {
    let dir = dir(home);
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&dir)
        .map_err(|e| err("io_error", format!("{method}: {e}")))?;
    let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    Ok(dir)
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

// ---- Upload in parts -------------------------------------------------------------------------

/// Largest file of an upload in parts (`files.put_begin`).
pub const MAX_CHUNKED_BYTES: u64 = 500 << 20;
/// Largest decoded part of `files.put_chunk`. The app sends 4 MiB parts.
pub const MAX_CHUNK_BYTES: usize = 8 << 20;
/// The part size that herdlingd tells the app to use.
pub const CHUNK_BYTES: usize = 4 << 20;
/// Most uploads in parts that can be open at the same time. Each one can hold `MAX_CHUNKED_BYTES`.
pub const MAX_OPEN: usize = 4;
/// A partial upload with no new part for this long is deleted on the next `files.put_begin`.
pub const PARTIAL_MAX_AGE: Duration = Duration::from_secs(3600);
/// The folder of the partial uploads, in the upload folder.
pub const PARTIAL_DIR: &str = ".partial";

/// `dir(home)/.partial`.
pub fn partial_dir(home: &Path) -> PathBuf {
    dir(home).join(PARTIAL_DIR)
}

/// What `files.put_begin` writes next to the partial file.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PartialMeta {
    /// The cleaned name.
    pub name: String,
    /// The full size in bytes that the app declared.
    pub size: u64,
}

/// The result of `files.put_begin`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Begin {
    pub upload_id: String,
    /// The part size that the app uses.
    pub chunk_bytes: usize,
    /// The largest file of an upload in parts.
    pub max_bytes: u64,
}

/// True for an upload id that herdlingd makes: 32 lowercase hex chars. Other text never becomes a path.
pub fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The rule for one part: it starts where the file ends now, it is not empty, and it does not go past
/// the declared size. `received` is the size of the partial file.
pub fn check_chunk(received: u64, size: u64, offset: u64, len: usize) -> Result<(), RpcError> {
    if offset != received {
        return Err(err(
            "bad_offset",
            format!("files.put_chunk: offset {offset} is out of order, the next offset is {received}"),
        ));
    }
    if len == 0 && size > 0 {
        return Err(err("bad_request", "files.put_chunk: the part is empty"));
    }
    if len > MAX_CHUNK_BYTES {
        return Err(err("too_large", format!("files.put_chunk: a part is larger than {MAX_CHUNK_BYTES} bytes")));
    }
    if offset + len as u64 > size {
        return Err(err("bad_request", format!("files.put_chunk: the part goes past the declared size {size}")));
    }
    Ok(())
}

fn part_path(home: &Path, id: &str) -> PathBuf {
    partial_dir(home).join(format!("{id}.part"))
}

fn meta_path(home: &Path, id: &str) -> PathBuf {
    partial_dir(home).join(format!("{id}.json"))
}

/// Gives `not_found` for an id that is not valid or has no partial upload.
fn read_meta(home: &Path, id: &str, method: &str) -> Result<PartialMeta, RpcError> {
    let missing = || err("not_found", format!("{method}: no upload with this upload_id"));
    if !valid_id(id) {
        return Err(missing());
    }
    let raw = std::fs::read(meta_path(home, id)).map_err(|_| missing())?;
    serde_json::from_slice(&raw).map_err(|_| missing())
}

/// Deletes the partial uploads that got no part for `PARTIAL_MAX_AGE`, and stray files in the folder.
/// The age is the age of the partial file: each part changes it. Errors are ignored.
pub fn cleanup_partials(home: &Path, now: SystemTime) {
    let dir = partial_dir(home);
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    let old = |p: &Path| {
        std::fs::metadata(p)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .is_none_or(|age| age > PARTIAL_MAX_AGE)
    };
    for e in entries.flatten() {
        let path = e.path();
        let name = e.file_name();
        let Some(id) = name.to_str().and_then(|n| n.strip_suffix(".part").or_else(|| n.strip_suffix(".json"))) else {
            let _ = std::fs::remove_file(&path);
            continue;
        };
        if !valid_id(id) || old(&part_path(home, id)) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// Ids of the partial uploads on disk.
fn open_ids(home: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(partial_dir(home)) else { return Vec::new() };
    entries
        .flatten()
        .filter_map(|e| e.file_name().to_str().and_then(|n| n.strip_suffix(".json")).map(str::to_string))
        .filter(|id| valid_id(id))
        .collect()
}

/// `files.put_begin`: checks the name and the size, and makes an empty partial file (0600) with its
/// meta file. Deletes old uploads and old partial uploads first (best effort).
pub fn begin(home: &Path, name: &str, size: u64, now: SystemTime) -> Result<Begin, RpcError> {
    const M: &str = "files.put_begin";
    let name = sanitize(name).ok_or_else(|| err("bad_request", format!("{M}: name has no usable chars")))?;
    if size > MAX_CHUNKED_BYTES {
        return Err(err("too_large", format!("{M}: the file is larger than {MAX_CHUNKED_BYTES} bytes")));
    }
    let dir = upload_dir(home, M)?;
    cleanup(&dir, now);
    let io = |e: std::io::Error| err("io_error", format!("{M}: {e}"));
    let partial = partial_dir(home);
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&partial).map_err(io)?;
    let _ = std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o700));
    cleanup_partials(home, now);
    if open_ids(home).len() >= MAX_OPEN {
        return Err(err("busy", format!("{M}: {MAX_OPEN} uploads are open. Finish or abort one first")));
    }
    let id: String = (0..16).map(|_| format!("{:02x}", rand::random::<u8>())).collect();
    std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(part_path(home, &id)).map_err(io)?;
    let meta = serde_json::to_vec(&PartialMeta { name, size }).map_err(|e| err("internal", e.to_string()))?;
    let mut f =
        std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(meta_path(home, &id)).map_err(io)?;
    f.write_all(&meta).map_err(io)?;
    Ok(Begin { upload_id: id, chunk_bytes: CHUNK_BYTES, max_bytes: MAX_CHUNKED_BYTES })
}

/// `files.put_chunk`: appends one part at `offset`. Returns the bytes received so far.
/// A second call for the same upload at the same time gets `busy`.
pub fn chunk(home: &Path, id: &str, offset: u64, data_b64: &str) -> Result<u64, RpcError> {
    const M: &str = "files.put_chunk";
    let meta = read_meta(home, id, M)?;
    // Refuse a much too long string before decoding it.
    if data_b64.len() / 4 * 3 > MAX_CHUNK_BYTES + 3 {
        return Err(err("too_large", format!("{M}: a part is larger than {MAX_CHUNK_BYTES} bytes")));
    }
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_b64.trim())
        .map_err(|e| err("bad_request", format!("{M}: data_b64 is not base64: {e}")))?;
    let io = |e: std::io::Error| err("io_error", format!("{M}: {e}"));
    let missing = |_| err("not_found", format!("{M}: no upload with this upload_id"));
    let mut f = std::fs::OpenOptions::new().append(true).open(part_path(home, id)).map_err(missing)?;
    match fs4::fs_std::FileExt::try_lock_exclusive(&f) {
        Ok(true) => {}
        Ok(false) => return Err(err("busy", format!("{M}: another part of this upload is being written"))),
        Err(e) => return Err(io(e)),
    }
    let received = f.metadata().map_err(io)?.len();
    check_chunk(received, meta.size, offset, data.len())?;
    if let Err(e) = f.write_all(&data) {
        // A short write leaves the file in an unknown state: cut it back so the app can send the part again.
        let _ = f.set_len(received);
        return Err(io(e));
    }
    Ok(received + data.len() as u64)
}

/// `files.put_end`: checks that all bytes are there and moves the file to
/// `dir(home)/<unix-ms>-<name>` without replacing a file. Returns the path.
pub fn end(home: &Path, id: &str, now: SystemTime) -> Result<PathBuf, RpcError> {
    const M: &str = "files.put_end";
    let meta = read_meta(home, id, M)?;
    let part = part_path(home, id);
    let io = |e: std::io::Error| err("io_error", format!("{M}: {e}"));
    let received = std::fs::metadata(&part).map_err(|_| err("not_found", format!("{M}: no upload with this upload_id")))?.len();
    if received != meta.size {
        return Err(err("bad_request", format!("{M}: {received} of {} bytes received", meta.size)));
    }
    let dir = upload_dir(home, M)?;
    let ms = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    for n in 0..100 {
        let file = if n == 0 { format!("{ms}-{}", meta.name) } else { format!("{ms}-{n}-{}", meta.name) };
        let path = dir.join(file);
        // A hard link fails when the name is taken, so no file is replaced. The folders are on the same disk.
        match std::fs::hard_link(&part, &path) {
            Ok(()) => {
                let _ = std::fs::remove_file(&part);
                let _ = std::fs::remove_file(meta_path(home, id));
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(io(e)),
        }
    }
    Err(err("io_error", format!("{M}: no free file name")))
}

/// `files.put_abort`: deletes the partial upload. An unknown id is not an error: the result is the same.
pub fn abort(home: &Path, id: &str) -> Result<(), RpcError> {
    if valid_id(id) {
        let _ = std::fs::remove_file(part_path(home, id));
        let _ = std::fs::remove_file(meta_path(home, id));
    }
    Ok(())
}
