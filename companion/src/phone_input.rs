//! Time of the last phone input per pane. Each SSH connection runs its own `rpc`
//! process, so the marks are small files: `rpc` writes them, `serve` reads them.

use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// herdr methods that type into a pane, with the param that names the pane.
const INPUT_METHODS: &[(&str, &str)] = &[
    ("pane.send_text", "pane_id"),
    ("pane.send_keys", "pane_id"),
    ("pane.send_input", "pane_id"),
    ("agent.prompt", "target"),
    ("agent.send_keys", "target"),
];

/// `home/.cache/herdling/phone-input`.
pub fn dir(home: &Path) -> PathBuf {
    home.join(".cache/herdling/phone-input")
}

/// One file per pane. The name is the pane id in hex, so any id gives a safe name.
fn path(home: &Path, pane: &str) -> PathBuf {
    dir(home).join(pane.bytes().map(|b| format!("{b:02x}")).collect::<String>())
}

/// The pane that a `herdr.call` of `method` with `params` types into, if it is input.
pub fn input_pane<'a>(method: &str, params: &'a serde_json::Value) -> Option<&'a str> {
    let (_, key) = INPUT_METHODS.iter().find(|(m, _)| *m == method)?;
    params.get(*key).and_then(serde_json::Value::as_str).filter(|p| !p.is_empty())
}

/// Records phone input to `pane` at `now` (folder 0700, file 0600). Writes a temp file and
/// renames it, so a reader never sees half a mark.
pub fn mark(home: &Path, pane: &str, now: SystemTime) -> std::io::Result<()> {
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir(home))?;
    let target = path(home, pane);
    let tmp = target.with_extension(format!("tmp{}", std::process::id()));
    let ms = now.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
    let mut f = std::fs::OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open(&tmp)?;
    f.write_all(ms.to_string().as_bytes())?;
    std::fs::rename(&tmp, &target)
}

/// Time of the last phone input to `pane`. `None` when there is no readable mark.
pub fn last(home: &Path, pane: &str) -> Option<SystemTime> {
    let s = std::fs::read_to_string(path(home, pane)).ok()?;
    let ms: u64 = s.trim().parse().ok()?;
    Some(UNIX_EPOCH + Duration::from_millis(ms))
}

/// Removes the mark of `pane` (for example, the pane closed).
pub fn forget(home: &Path, pane: &str) {
    let _ = std::fs::remove_file(path(home, pane));
}
