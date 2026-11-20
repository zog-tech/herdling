//! `files.get`: a read-only look at one path for the file viewer of the app. The agent writes a
//! path in its reply; the user taps it and sees the folder, the image or the text on the phone.
//!
//! The rules (path resolution, the kind of a file, the text check, the order of a listing) are
//! pure functions. [`get`] does the I/O: one stat, one folder read or one capped file read. It
//! reads only regular files, so a FIFO or a device never blocks the call.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::{json, Value};

use crate::types::RpcError;

/// Most entries in one folder listing. `truncated` is true when the folder has more.
pub const MAX_ENTRIES: usize = 1000;
/// Most bytes of text in one result. `truncated` is true when the file is longer.
pub const TEXT_MAX: usize = 256 << 10;
/// Largest image that herdlingd sends. A larger image gives `too_large: true` and no bytes.
pub const IMAGE_MAX: u64 = 20 << 20;
/// Most image bytes in one result (384 KiB, 512 KiB as base64). The app asks for the next part
/// with `offset`. A small part keeps each line short, so other calls on the channel do not wait
/// long behind an image. It is a multiple of 3: the base64 parts have no padding, so the app
/// joins them as text.
pub const CHUNK: usize = 384 << 10;
/// Bytes read to tell a text file from a binary file.
pub const SNIFF: usize = 8 << 10;

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

/// What a path is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Dir,
    Image,
    Text,
    Other,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Dir => "dir",
            Kind::Image => "image",
            Kind::Text => "text",
            Kind::Other => "other",
        }
    }
}

/// The absolute path for `path`. `~` and `~/…` start at `home`. A relative path starts at `cwd`.
/// A relative path with no `cwd`, an empty path or a `~user` path gives an error message.
pub fn resolve(home: &Path, path: &str, cwd: Option<&Path>) -> Result<PathBuf, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("path is empty".into());
    }
    if path == "~" {
        return Ok(home.to_path_buf());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return Ok(home.join(rest));
    }
    if path.starts_with('~') {
        return Err("a path of another user (~name) is not supported".into());
    }
    let p = Path::new(path);
    if p.is_absolute() {
        return Ok(p.to_path_buf());
    }
    match cwd {
        Some(c) if c.is_absolute() => Ok(c.join(p)),
        Some(_) => Err("cwd must be an absolute path".into()),
        None => Err("a relative path needs cwd or pane_id".into()),
    }
}

/// True when `path` starts at the session folder (not `/`, not `~`).
pub fn is_relative(path: &str) -> bool {
    let p = path.trim();
    !p.starts_with('/') && !p.starts_with('~')
}

/// The lower-case extension of a file name, without the dot.
fn extension(name: &str) -> Option<String> {
    let (stem, ext) = name.rsplit_once('.')?;
    if stem.is_empty() || ext.is_empty() {
        return None;
    }
    Some(ext.to_ascii_lowercase())
}

/// The MIME type of an image that the phone can show, from the name.
pub fn image_mime(name: &str) -> Option<&'static str> {
    Some(match extension(name)?.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "bmp" => "image/bmp",
        _ => return None,
    })
}

/// A MIME type for a file that is not shown, from the name. The app shows it as the type.
pub fn other_mime(name: &str) -> Option<&'static str> {
    Some(match extension(name)?.as_str() {
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" | "tgz" => "application/gzip",
        "tar" => "application/x-tar",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "svg" => "image/svg+xml",
        "wasm" => "application/wasm",
        "sqlite" | "db" => "application/vnd.sqlite3",
        _ => return None,
    })
}

/// The kind of a listing entry, from its name only: herdlingd does not read the file.
pub fn entry_kind(name: &str, is_dir: bool) -> &'static str {
    if is_dir {
        "dir"
    } else if image_mime(name).is_some() {
        "image"
    } else {
        "file"
    }
}

/// True when the first bytes of a file look like text: no NUL byte, and valid UTF-8. A
/// character cut at the end of `head` does not count against it.
pub fn looks_text(head: &[u8]) -> bool {
    if head.contains(&0) {
        return false;
    }
    match std::str::from_utf8(head) {
        Ok(_) => true,
        // `error_len` is None when the input ends inside a character.
        Err(e) => e.error_len().is_none(),
    }
}

/// The text of `bytes`, cut at `max` bytes on a character boundary. The bool is true when it
/// was cut. Bytes that are not UTF-8 show as U+FFFD.
pub fn cut_text(bytes: &[u8], max: usize) -> (String, bool) {
    if bytes.len() <= max {
        return (String::from_utf8_lossy(bytes).into_owned(), false);
    }
    let mut end = max;
    // A UTF-8 continuation byte is 0b10xxxxxx: step back to the start of the character.
    while end > 0 && (bytes[end] & 0xC0) == 0x80 {
        end -= 1;
    }
    (String::from_utf8_lossy(&bytes[..end]).into_owned(), true)
}

/// One entry of a folder listing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
}

/// Folders first, then files, each by name without case. Hidden names go when `hidden` is false.
pub fn order(mut entries: Vec<Entry>, hidden: bool) -> Vec<Entry> {
    entries.retain(|e| hidden || !e.name.starts_with('.'));
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())).then_with(|| a.name.cmp(&b.name)));
    entries
}

/// The params of `files.get`, after the path is resolved.
#[derive(Debug, Clone)]
pub struct GetReq {
    pub path: PathBuf,
    /// List hidden entries of a folder too.
    pub hidden: bool,
    /// The first image byte to send.
    pub offset: u64,
}

/// Reads the path. See the module doc and `docs/protocol.md` ("File viewer: files.get").
pub fn get(req: &GetReq) -> Result<Value, RpcError> {
    let shown = req.path.to_string_lossy().into_owned();
    let path = req.path.canonicalize().map_err(|e| io_err(&shown, e))?;
    let meta = std::fs::metadata(&path).map_err(|e| io_err(&shown, e))?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "/".into());
    let path_str = path.to_string_lossy().into_owned();
    if meta.is_dir() {
        return list(&path, &path_str, &name, req.hidden);
    }
    let size = meta.len();
    let base = |kind: Kind| json!({"path": path_str, "name": name, "kind": kind.as_str(), "size": size});
    if !meta.is_file() {
        // A FIFO, a socket or a device: a read can block or never end.
        return Ok(base(Kind::Other));
    }
    if let Some(mime) = image_mime(&name) {
        let mut v = base(Kind::Image);
        v["mime"] = json!(mime);
        if size > IMAGE_MAX {
            v["too_large"] = json!(true);
            return Ok(v);
        }
        let (data, eof) = read_chunk(&path, req.offset, size).map_err(|e| io_err(&shown, e))?;
        v["offset"] = json!(req.offset);
        v["data_b64"] = json!(base64::engine::general_purpose::STANDARD.encode(&data));
        v["eof"] = json!(eof);
        return Ok(v);
    }
    let mut f = std::fs::File::open(&path).map_err(|e| io_err(&shown, e))?;
    let mut bytes = Vec::new();
    // One byte more than the cap tells a cut text from a text of exactly `TEXT_MAX` bytes.
    (&mut f).take(TEXT_MAX as u64 + 1).read_to_end(&mut bytes).map_err(|e| io_err(&shown, e))?;
    if !looks_text(&bytes[..bytes.len().min(SNIFF)]) {
        let mut v = base(Kind::Other);
        if let Some(m) = other_mime(&name) {
            v["mime"] = json!(m);
        }
        return Ok(v);
    }
    let (text, truncated) = cut_text(&bytes, TEXT_MAX);
    let mut v = base(Kind::Text);
    v["text"] = json!(text);
    v["truncated"] = json!(truncated);
    Ok(v)
}

fn io_err(path: &str, e: std::io::Error) -> RpcError {
    match e.kind() {
        std::io::ErrorKind::NotFound => err("not_found", format!("files.get: no such file or folder: {path}")),
        _ => err("io_error", format!("files.get: {path}: {e}")),
    }
}

/// At most `CHUNK` bytes from `offset`, and whether they reach the end of the file.
fn read_chunk(path: &Path, offset: u64, size: u64) -> std::io::Result<(Vec<u8>, bool)> {
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::Start(offset))?;
    let mut data = Vec::new();
    f.take(CHUNK as u64).read_to_end(&mut data)?;
    let eof = offset + data.len() as u64 >= size;
    Ok((data, eof))
}

fn list(path: &Path, path_str: &str, name: &str, hidden: bool) -> Result<Value, RpcError> {
    let read = std::fs::read_dir(path).map_err(|e| io_err(path_str, e))?;
    let mut entries = Vec::new();
    for e in read.filter_map(|e| e.ok()) {
        // A name that is not UTF-8 cannot come back as a path in a later call.
        let Ok(n) = e.file_name().into_string() else { continue };
        // `file_type` needs no stat on most file systems. A link needs one to know its target.
        let is_dir = match e.file_type() {
            Ok(t) if t.is_symlink() => e.path().is_dir(),
            Ok(t) => t.is_dir(),
            Err(_) => false,
        };
        entries.push(Entry { name: n, is_dir });
    }
    let mut entries = order(entries, hidden);
    let truncated = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);
    let out: Vec<Value> = entries
        .iter()
        .map(|e| {
            let mut v = json!({"name": e.name, "kind": entry_kind(&e.name, e.is_dir)});
            if !e.is_dir {
                // A broken link has no size.
                if let Ok(m) = std::fs::metadata(path.join(&e.name)) {
                    v["size"] = json!(m.len());
                }
            }
            v
        })
        .collect();
    Ok(json!({
        "path": path_str,
        "name": name,
        "kind": Kind::Dir.as_str(),
        "entries": out,
        "truncated": truncated,
        "hidden": hidden,
    }))
}
