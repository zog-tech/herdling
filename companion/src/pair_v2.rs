//! Pairing v2: the 6-digit code is the password of a CPace exchange (see [`crate::cpace`]).
//! The code never goes over the network, so a relay or an on-path party cannot learn it
//! offline. Each side proves the code with a key-confirmation tag over the values that it
//! cares about: the phone over its public key and device fields, `herdlingd` over the host fields.
//! A relay that puts in its own key fails the tag check, and a fake host fails the phone's check.
//!
//! The phone is CPace party A (the initiator), `herdlingd` is party B. The exact messages are in
//! `docs/protocol.md`, "Pairing v2". This module holds the pure rules and the session table;
//! `serve/http.rs` does the HTTP and the window file.

use std::collections::HashMap;
use std::time::Duration;

use crate::cpace;

/// CPace channel identifier (CI). It separates this use of the code from every other use.
pub const LABEL: &[u8] = b"herdling-pair-v2";
/// Bytes in the phone nonce (the CPace sid) and in the session id.
pub const NONCE_LEN: usize = 16;
/// Bytes in a tag (HMAC-SHA-512).
pub const TAG_LEN: usize = 64;
/// A started exchange must finish in this time.
pub const SESSION_TTL: Duration = Duration::from_secs(60);
/// Most started exchanges kept at one time.
pub const MAX_SESSIONS: usize = 16;

/// The CPace ADa: the phone's device id.
pub fn ada(device_id: &str) -> Vec<u8> {
    device_id.as_bytes().to_vec()
}

/// The message under `tag_a`: the phone's CPace message and every field that the host saves.
pub fn tag_a_msg(ya: &[u8], ada: &[u8], device_name: &str, host_id: &str, public_key: &str) -> Vec<u8> {
    cpace::lv_cat(&[b"herdling-pair-v2/a", ya, ada, device_name.as_bytes(), host_id.as_bytes(), public_key.as_bytes()])
}

/// The message under `tag_b`: the host's CPace message, `tag_a` (so the answer belongs to the
/// phone's proof) and every field that the phone saves.
pub fn tag_b_msg(
    yb: &[u8],
    adb: &[u8],
    tag_a: &[u8],
    host_name: &str,
    user: &str,
    ssh_port: u16,
    host_key_fingerprint: Option<&str>,
) -> Vec<u8> {
    let port = ssh_port.to_string();
    cpace::lv_cat(&[
        b"herdling-pair-v2/b",
        yb,
        adb,
        tag_a,
        host_name.as_bytes(),
        user.as_bytes(),
        port.as_bytes(),
        host_key_fingerprint.unwrap_or("").as_bytes(),
    ])
}

/// The result of the host's CPace step.
pub struct Responded {
    /// The host's CPace message Yb.
    pub yb: [u8; 32],
    /// The key of both tags.
    pub mac_key: [u8; 64],
}

/// The host's CPace step (party B). `y_random` gives the secret scalar. None when the phone's
/// message is not valid or the scalar is zero: the caller must stop.
pub fn respond(code: &str, sid: &[u8], ya: &[u8], ada: &[u8], adb: &[u8], y_random: [u8; 32]) -> Option<Responded> {
    let y = cpace::scalar_from_random(y_random)?;
    let g = cpace::calculate_generator(code.as_bytes(), LABEL, sid);
    let yb = cpace::scalar_mult(&y, &g);
    let k = cpace::scalar_mult_vfy(&y, ya)?;
    let isk = cpace::isk_ir(sid, &k, ya, ada, &yb, adb);
    Some(Responded { yb, mac_key: cpace::mac_key(sid, &isk) })
}

/// The phone's first CPace step (party A): the scalar and Ya. For tests and the shared vector;
/// the app has its own code in `app/src/pairing/cpace.ts`.
pub fn initiate(code: &str, sid: &[u8], y_random: [u8; 32]) -> Option<(curve25519_dalek::scalar::Scalar, [u8; 32])> {
    let y = cpace::scalar_from_random(y_random)?;
    let g = cpace::calculate_generator(code.as_bytes(), LABEL, sid);
    Some((y, cpace::scalar_mult(&y, &g)))
}

/// The phone's last CPace step: the tag key, or None when the host's message is not valid.
pub fn initiator_mac_key(
    y: &curve25519_dalek::scalar::Scalar,
    sid: &[u8],
    ya: &[u8],
    ada: &[u8],
    yb: &[u8],
    adb: &[u8],
) -> Option<[u8; 64]> {
    let k = cpace::scalar_mult_vfy(y, yb)?;
    let isk = cpace::isk_ir(sid, &k, ya, ada, yb, adb);
    Some(cpace::mac_key(sid, &isk))
}

/// A started exchange, kept in memory by `serve` until the phone finishes it.
pub struct Session {
    pub device_id: String,
    /// The window code at the start. The finish step checks that the window still has it.
    pub code: String,
    pub ya: [u8; 32],
    pub ada: Vec<u8>,
    pub yb: [u8; 32],
    /// The session id. It is also the CPace ADb, so the host's own random value is in the key.
    pub adb: [u8; NONCE_LEN],
    pub mac_key: [u8; 64],
    /// Seconds since the epoch after which the session is gone.
    pub expires_at: u64,
}

/// The table of started exchanges, by session id.
#[derive(Default)]
pub struct Sessions {
    map: HashMap<[u8; NONCE_LEN], Session>,
}

impl Sessions {
    /// Removes the sessions that are past their end.
    pub fn purge(&mut self, now: u64) {
        self.map.retain(|_, s| now < s.expires_at);
    }

    /// True when a new session has room after a purge.
    pub fn has_room(&mut self, now: u64) -> bool {
        self.purge(now);
        self.map.len() < MAX_SESSIONS
    }

    pub fn insert(&mut self, s: Session) {
        self.map.insert(s.adb, s);
    }

    /// The device id of a live session, without using it.
    pub fn device_id(&self, id: &[u8; NONCE_LEN], now: u64) -> Option<&str> {
        self.map.get(id).filter(|s| now < s.expires_at).map(|s| s.device_id.as_str())
    }

    /// Removes and returns a live session: a session works once.
    pub fn take(&mut self, id: &[u8; NONCE_LEN], now: u64) -> Option<Session> {
        self.map.remove(id).filter(|s| now < s.expires_at)
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}

/// Lower-case hex of `b`.
pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Exactly `N` bytes from lower- or upper-case hex, else None.
pub fn unhex<const N: usize>(s: &str) -> Option<[u8; N]> {
    if s.len() != 2 * N {
        return None;
    }
    let mut out = [0u8; N];
    for (i, pair) in s.as_bytes().chunks(2).enumerate() {
        let d = |c: u8| (c as char).to_digit(16);
        out[i] = u8::try_from(d(pair[0])? * 16 + d(pair[1])?).ok()?;
    }
    Some(out)
}
