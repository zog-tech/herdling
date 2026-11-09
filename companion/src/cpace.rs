//! CPace on ristretto255 with SHA-512 (CPACE-RISTR255-SHA512), as in draft-irtf-cfrg-cpace-21,
//! in the initiator-responder setting. Pairing v2 uses it so that the 6-digit code never goes
//! over the network: a party that sees or relays the traffic cannot test codes offline.
//!
//! This module is pure: the caller gives the random scalar bytes. The shared test vectors are in
//! `protocol/fixtures/cpace-ristretto255.json`; the app (`app/src/pairing/cpace.ts`) checks the same file.

use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::Identity;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha512};

/// `G.DSI` of the ristretto255 group.
pub const DSI: &[u8] = b"CPaceRistretto255";
/// Input block size of SHA-512 (`H.s_in_bytes`).
const S_IN_BYTES: usize = 128;

/// `prepend_len`: the LEB128 length of `data`, then `data`.
pub fn prepend_len(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 2);
    let mut len = data.len();
    loop {
        if len < 128 {
            out.push(len as u8);
        } else {
            out.push((len & 0x7f) as u8 | 0x80);
        }
        len >>= 7;
        if len == 0 {
            break;
        }
    }
    out.extend_from_slice(data);
    out
}

/// `lv_cat`: each part with its length in front.
pub fn lv_cat(parts: &[&[u8]]) -> Vec<u8> {
    parts.iter().flat_map(|p| prepend_len(p)).collect()
}

/// `generator_string(DSI, PRS, CI, sid, 128)`: the zero padding fills the first hash block.
pub fn generator_string(prs: &[u8], ci: &[u8], sid: &[u8]) -> Vec<u8> {
    let zpad = S_IN_BYTES.saturating_sub(1 + prepend_len(prs).len() + prepend_len(DSI).len());
    lv_cat(&[DSI, prs, &vec![0u8; zpad], ci, sid])
}

/// `G.calculate_generator`: SHA-512 of the generator string, then the ristretto255 element
/// derivation from 64 uniform bytes (RFC 9496).
pub fn calculate_generator(prs: &[u8], ci: &[u8], sid: &[u8]) -> RistrettoPoint {
    let hash: [u8; 64] = Sha512::digest(generator_string(prs, ci, sid)).into();
    RistrettoPoint::from_uniform_bytes(&hash)
}

/// A scalar from 32 random bytes, as `G.sample_scalar` recommends: the bits above bit 252 are
/// cleared and the rest is read little-endian. None for zero.
pub fn scalar_from_random(mut bytes: [u8; 32]) -> Option<Scalar> {
    bytes[31] &= 0x0f;
    let s = Scalar::from_bytes_mod_order(bytes);
    (s != Scalar::ZERO).then_some(s)
}

/// `G.scalar_mult`: the encoding of `y * g`.
pub fn scalar_mult(y: &Scalar, g: &RistrettoPoint) -> [u8; 32] {
    (g * y).compress().to_bytes()
}

/// `G.scalar_mult_vfy` with the abort check: the encoding of `y * X`, or None when `x` is not
/// a valid encoding or the result is the identity. The caller must abort on None.
pub fn scalar_mult_vfy(y: &Scalar, x: &[u8]) -> Option<[u8; 32]> {
    let p = CompressedRistretto::from_slice(x).ok()?.decompress()?;
    let k = (p * y).compress();
    (k != CompressedRistretto::identity()).then(|| k.to_bytes())
}

/// True when `x` is the encoding of a ristretto255 element other than the identity.
pub fn is_valid_share(x: &[u8]) -> bool {
    match CompressedRistretto::from_slice(x).ok().and_then(|c| c.decompress()) {
        Some(p) => p.compress() != CompressedRistretto::identity(),
        None => false,
    }
}

/// `transcript_ir(Ya, ADa, Yb, ADb)`.
pub fn transcript_ir(ya: &[u8], ada: &[u8], yb: &[u8], adb: &[u8]) -> Vec<u8> {
    let mut t = lv_cat(&[ya, ada]);
    t.extend(lv_cat(&[yb, adb]));
    t
}

/// `ISK = H.hash(lv_cat(DSI || "_ISK", sid, K) || transcript_ir(Ya, ADa, Yb, ADb))`.
pub fn isk_ir(sid: &[u8], k: &[u8], ya: &[u8], ada: &[u8], yb: &[u8], adb: &[u8]) -> [u8; 64] {
    let dsi_isk = [DSI, b"_ISK"].concat();
    let mut h = Sha512::new();
    h.update(lv_cat(&[&dsi_isk, sid, k]));
    h.update(transcript_ir(ya, ada, yb, adb));
    h.finalize().into()
}

/// The key-confirmation key of section 10.4: `H.hash(b"CPaceMac" || sid || ISK)`.
pub fn mac_key(sid: &[u8], isk: &[u8]) -> [u8; 64] {
    let mut h = Sha512::new();
    h.update(b"CPaceMac");
    h.update(sid);
    h.update(isk);
    h.finalize().into()
}

/// HMAC-SHA-512 of `msg` under `key`.
pub fn hmac_sha512(key: &[u8], msg: &[u8]) -> [u8; 64] {
    let mut m = Hmac::<Sha512>::new_from_slice(key).expect("HMAC takes a key of any length");
    m.update(msg);
    m.finalize().into_bytes().into()
}

/// Checks an HMAC-SHA-512 tag in constant time.
pub fn hmac_verify(key: &[u8], msg: &[u8], tag: &[u8]) -> bool {
    let mut m = Hmac::<Sha512>::new_from_slice(key).expect("HMAC takes a key of any length");
    m.update(msg);
    m.verify_slice(tag).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leb128_lengths() {
        assert_eq!(prepend_len(b""), vec![0]);
        assert_eq!(prepend_len(&[7u8; 128])[..2], [0x80, 0x01]);
    }

    #[test]
    fn identity_and_bad_encodings_abort() {
        let y = scalar_from_random([1; 32]).unwrap();
        assert!(scalar_mult_vfy(&y, &[0; 32]).is_none());
        assert!(scalar_mult_vfy(&y, &[0xff; 32]).is_none());
        assert!(scalar_mult_vfy(&y, &[1; 31]).is_none());
        assert!(!is_valid_share(&[0; 32]));
    }

    #[test]
    fn zero_scalar_is_refused() {
        assert!(scalar_from_random([0; 32]).is_none());
        // Only the bits above bit 252 are set: they are cleared, so the scalar is zero.
        let mut b = [0u8; 32];
        b[31] = 0xf0;
        assert!(scalar_from_random(b).is_none());
    }
}
