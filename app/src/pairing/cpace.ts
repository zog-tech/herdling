/**
 * CPace on ristretto255 with SHA-512 (CPACE-RISTR255-SHA512), as in draft-irtf-cfrg-cpace-21,
 * in the initiator-responder setting. Pairing v2 uses it so that the 6-digit code never goes
 * over the network. The same rules are in `companion/src/cpace.rs`; both sides check the vectors
 * in `protocol/fixtures/cpace-ristretto255.json`.
 *
 * Pure JS (`@noble/curves`, `@noble/hashes`): no native module, so it ships over the air.
 * Hermes has BigInt, which noble needs; noble's own random source is not used.
 */
import { ristretto255 } from "@noble/curves/ed25519";
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha2";

type Point = InstanceType<typeof ristretto255.Point>;

/** UTF-8 bytes of `s`. Written by hand: no dependency on `TextEncoder`. */
export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    // A lone surrogate becomes U+FFFD, as TextEncoder does it (and Rust strings cannot hold one).
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** Lower-case hex of `b`. */
export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** The bytes of hex `s` when it has exactly `len` bytes, else null. */
export function fromHex(s: string, len: number): Uint8Array | null {
  if (s.length !== 2 * len || !/^[0-9a-fA-F]*$/.test(s)) return null;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Equal bytes. The time depends only on the lengths. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** `G.DSI` of the ristretto255 group. */
const DSI = utf8("CPaceRistretto255");
/** Input block size of SHA-512 (`H.s_in_bytes`). */
const S_IN_BYTES = 128;

/** `prepend_len`: the LEB128 length of `data`, then `data`. */
export function prependLen(data: Uint8Array): Uint8Array {
  const len: number[] = [];
  let n = data.length;
  do {
    len.push(n < 128 ? n : (n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  } while (n > 0);
  return concat(Uint8Array.from(len), data);
}

/** `lv_cat`: each part with its length in front. */
export function lvCat(...parts: Uint8Array[]): Uint8Array {
  return concat(...parts.map(prependLen));
}

/** `generator_string(DSI, PRS, CI, sid, 128)`: the zero padding fills the first hash block. */
export function generatorString(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Uint8Array {
  const zpad = Math.max(0, S_IN_BYTES - 1 - prependLen(prs).length - prependLen(DSI).length);
  return lvCat(DSI, prs, new Uint8Array(zpad), ci, sid);
}

/** `G.calculate_generator`: SHA-512 of the generator string, then the RFC 9496 element derivation. */
export function calculateGenerator(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Point {
  return ristretto255.Point.hashToCurve(sha512(generatorString(prs, ci, sid)));
}

/** A scalar from 32 random bytes: the bits above bit 252 are cleared, the rest is read little-endian. Null for zero. */
export function scalarFromRandom(bytes: Uint8Array): bigint | null {
  if (bytes.length !== 32) throw new Error("scalar needs 32 bytes");
  // BigInt() calls, not `0n` literals, as noble does: some JS tool chains do not parse the literals.
  const zero = BigInt(0);
  const eight = BigInt(8);
  let n = zero;
  for (let i = 31; i >= 0; i--) n = (n << eight) | BigInt(i === 31 ? bytes[i] & 0x0f : bytes[i]);
  return n === zero ? null : n;
}

/** `G.scalar_mult`: the encoding of `y * g`. */
export function scalarMult(y: bigint, g: Point): Uint8Array {
  return g.multiply(y).toBytes();
}

/** The element that `x` encodes, or null for a bad encoding or the identity. */
function decodeShare(x: Uint8Array): Point | null {
  if (x.length !== 32) return null;
  try {
    const p = ristretto255.Point.fromBytes(x);
    return p.is0() ? null : p;
  } catch {
    return null;
  }
}

/** True when `x` encodes a ristretto255 element other than the identity. */
export function isValidShare(x: Uint8Array): boolean {
  return decodeShare(x) !== null;
}

/** `G.scalar_mult_vfy` with the abort check: null when `x` is not valid or the result is the identity. */
export function scalarMultVfy(y: bigint, x: Uint8Array): Uint8Array | null {
  const p = decodeShare(x);
  if (!p) return null;
  const k = p.multiply(y);
  return k.is0() ? null : k.toBytes();
}

/** `transcript_ir(Ya, ADa, Yb, ADb)`. */
export function transcriptIr(ya: Uint8Array, ada: Uint8Array, yb: Uint8Array, adb: Uint8Array): Uint8Array {
  return concat(lvCat(ya, ada), lvCat(yb, adb));
}

/** `ISK = H.hash(lv_cat(DSI || "_ISK", sid, K) || transcript_ir(Ya, ADa, Yb, ADb))`. */
export function iskIr(sid: Uint8Array, k: Uint8Array, ya: Uint8Array, ada: Uint8Array, yb: Uint8Array, adb: Uint8Array): Uint8Array {
  return sha512(concat(lvCat(concat(DSI, utf8("_ISK")), sid, k), transcriptIr(ya, ada, yb, adb)));
}

/** The key-confirmation key of section 10.4: `H.hash(b"CPaceMac" || sid || ISK)`. */
export function macKey(sid: Uint8Array, isk: Uint8Array): Uint8Array {
  return sha512(concat(utf8("CPaceMac"), sid, isk));
}

/** HMAC-SHA-512 of `msg` under `key`. */
export function hmacSha512(key: Uint8Array, msg: Uint8Array): Uint8Array {
  return hmac(sha512, key, msg);
}
