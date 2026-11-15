//! The herdr-core version that this herdlingd release installs, and its checksums.
//!
//! The pin is `companion/core-pin.json`. It is part of the binary, so the release key signs it
//! with herdlingd. The release workflow copies it into `latest.json` (`core` and
//! `requires_core`), so an older herdlingd can install the core that a new release needs.
//! The download URL is made from the version and the target. It never comes from a file.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Where upstream herdr-core publishes its builds.
pub const RELEASES: &str = "https://releases.herdr.dev/core";

/// The text of `companion/core-pin.json`.
pub const PIN_JSON: &str = include_str!("../../core-pin.json");

/// One pinned herdr-core release.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CorePin {
    /// The herdr-core version, for example `0.1.20`.
    pub version: String,
    /// True when this herdlingd needs the core to work. The installer and the update then install
    /// the core first. Plan E sets it for herdlingd 0.2.0.
    #[serde(default)]
    pub required: bool,
    /// The SHA-256 of `herdr-core-<target>.tar.gz`, by target (`macos-aarch64` and so on).
    pub sha256: BTreeMap<String, String>,
}

/// The pin of this build. A test checks that `core-pin.json` parses and is valid.
pub fn embedded() -> CorePin {
    serde_json::from_str(PIN_JSON).expect("core-pin.json is valid JSON")
}

/// The upstream target name for an OS and a CPU (`std::env::consts` values).
pub fn target(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("macos-aarch64"),
        ("macos", "x86_64") => Some("macos-x86_64"),
        ("linux", "aarch64") => Some("linux-aarch64"),
        ("linux", "x86_64") => Some("linux-x86_64"),
        _ => None,
    }
}

fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

impl CorePin {
    /// True when the version is a plain `X.Y.Z` (it goes into a URL) and each checksum is
    /// 64 lower-case hex digits of a known target.
    pub fn valid(&self) -> bool {
        let plain = crate::update::parse_version(&self.version).is_some_and(|v| v.pre.is_none())
            && self.version.bytes().all(|b| b.is_ascii_digit() || b == b'.');
        plain
            && !self.sha256.is_empty()
            && self.sha256.iter().all(|(t, s)| {
                ["macos-aarch64", "macos-x86_64", "linux-aarch64", "linux-x86_64"].contains(&t.as_str()) && is_sha256(s)
            })
    }

    /// The pinned checksum for `target`.
    pub fn sha_for(&self, target: &str) -> Option<String> {
        self.sha256.get(target).cloned()
    }

    /// The download URL of the tarball for `target`.
    pub fn url(&self, target: &str) -> String {
        format!("{RELEASES}/{}/herdr-core-{target}.tar.gz", self.version)
    }
}
