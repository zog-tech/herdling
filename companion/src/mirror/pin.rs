//! The scrcpy server that the Android mirror runs on the emulator, pinned by version and SHA-256.
//!
//! The pin is `companion/scrcpy-pin.json`, part of the binary. The download URL is made from the
//! version: only the official GitHub release of scrcpy. The file goes to
//! `~/.local/share/herdling/scrcpy-server-v<version>` and its checksum is checked before each use,
//! so a changed file is downloaded again. scrcpy is Apache-2.0 (see `THIRD_PARTY_NOTICES.md`).

use std::path::{Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};

/// The text of `companion/scrcpy-pin.json`.
pub const PIN_JSON: &str = include_str!("../../scrcpy-pin.json");
/// Where scrcpy publishes its releases.
pub const RELEASES: &str = "https://github.com/Genymobile/scrcpy/releases";
/// The scrcpy server is about 0.7 MiB. A larger download is refused.
pub const MAX_SIZE: usize = 8 << 20;

/// One pinned scrcpy server.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ScrcpyPin {
    /// For example `5.0.1`. The server refuses a client with another version.
    pub version: String,
    /// The SHA-256 of `scrcpy-server-v<version>`, 64 lower-case hex digits.
    pub sha256: String,
}

/// The pin of this build. A test checks that `scrcpy-pin.json` parses and is valid.
pub fn embedded() -> ScrcpyPin {
    serde_json::from_str(PIN_JSON).expect("scrcpy-pin.json is valid JSON")
}

impl ScrcpyPin {
    /// True when the version is `X.Y.Z` with digits only (it goes into a URL and a command) and the
    /// checksum is 64 lower-case hex digits.
    pub fn valid(&self) -> bool {
        let parts: Vec<&str> = self.version.split('.').collect();
        parts.len() == 3
            && parts.iter().all(|p| !p.is_empty() && p.len() <= 4 && p.bytes().all(|b| b.is_ascii_digit()))
            && self.sha256.len() == 64
            && self.sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }

    /// `scrcpy-server-v5.0.1`.
    pub fn file_name(&self) -> String {
        format!("scrcpy-server-v{}", self.version)
    }

    /// The download URL of the server.
    pub fn url(&self) -> String {
        format!("{RELEASES}/download/v{}/{}", self.version, self.file_name())
    }

    /// The local copy: `~/.local/share/herdling/scrcpy-server-v<version>`.
    pub fn path(&self, home: &Path) -> PathBuf {
        home.join(".local/share/herdling").join(self.file_name())
    }

    /// True when `bytes` has the pinned checksum.
    pub fn matches(&self, bytes: &[u8]) -> bool {
        sha256_hex(bytes) == self.sha256
    }
}

/// The SHA-256 of `bytes` as lower-case hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// What to do with the local copy.
#[derive(Debug, PartialEq, Eq)]
pub enum Have {
    /// The file is there and has the pinned checksum.
    Ready,
    /// The file is missing or has another checksum: download it.
    Download,
}

/// Decides from the bytes of the local file (None: no file). Pure.
pub fn check_local(pin: &ScrcpyPin, local: Option<&[u8]>) -> Have {
    match local {
        Some(b) if pin.matches(b) => Have::Ready,
        _ => Have::Download,
    }
}

/// Makes sure that the pinned server is in the data folder and returns its path. Downloads it when
/// it is missing or changed. The download must match the pin, else the error `checksum_mismatch`.
pub async fn ensure(home: &Path) -> Result<PathBuf, crate::types::RpcError> {
    let err = |code: &str, m: String| crate::types::RpcError { code: code.into(), message: m };
    let pin = embedded();
    if !pin.valid() {
        return Err(err("bad_pin", "scrcpy-pin.json is not valid".into()));
    }
    let path = pin.path(home);
    let local = tokio::fs::read(&path).await.ok();
    if check_local(&pin, local.as_deref()) == Have::Ready {
        return Ok(path);
    }
    let body = crate::update::download(&pin.url(), MAX_SIZE).await.map_err(|e| err("download_failed", e.message))?;
    if !pin.matches(&body) {
        return Err(err("checksum_mismatch", format!("the scrcpy server download does not match the pinned SHA-256 of {}", pin.file_name())));
    }
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let p = path.clone();
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        use std::io::Write;
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&dir)?;
        let tmp = p.with_extension(format!("tmp{}", std::process::id()));
        let mut f = std::fs::OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open(&tmp)?;
        f.write_all(&body)?;
        f.sync_all()?;
        std::fs::rename(&tmp, &p)
    })
    .await
    .map_err(|e| err("internal", e.to_string()))?
    .map_err(|e| err("io_error", format!("save the scrcpy server: {e}")))?;
    Ok(path)
}
