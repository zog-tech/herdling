/**
 * The fingerprint of the phone's own SSH key, as OpenSSH prints it: `SHA256:` and the unpadded
 * base64 of the SHA-256 of the key blob. After pairing, the user compares it with the key that
 * `herdlingd pair` shows, so a relay on the network cannot enroll its own key unseen.
 * Pure JS: Hermes has no Web Crypto, and a native hash would need a new native build.
 */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The bytes of standard base64 (padding allowed only at the end), or null. */
function fromBase64(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return null;
  const body = s.replace(/=+$/, "");
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of body) {
    acc = (acc << 6) | B64.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Standard base64 without `=` padding, as OpenSSH writes fingerprints. */
function toBase64NoPad(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((b.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += B64[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 (FIPS 180-4) of `data`. Only for short inputs such as a key blob. */
export function sha256(data: Uint8Array): Uint8Array {
  const len = data.length;
  // The message, one 0x80 byte, zeros, and the bit length in the last 8 bytes of a 64-byte block.
  const total = Math.ceil((len + 9) / 64) * 64;
  const msg = new Uint8Array(total);
  msg.set(data);
  msg[len] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(total - 8, Math.floor((len * 8) / 0x100000000));
  view.setUint32(total - 4, (len * 8) >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

/**
 * `SHA256:<base64>` of an OpenSSH public key line (`ssh-ed25519 <blob> [comment]`), the same
 * value as `ssh-keygen -lf`. Null when the line has no valid base64 blob.
 */
export function publicKeyFingerprint(line: string): string | null {
  const blob = line.trim().split(/\s+/)[1];
  if (!blob) return null;
  const bytes = fromBase64(blob);
  if (!bytes || bytes.length === 0) return null;
  return `SHA256:${toBase64NoPad(sha256(bytes))}`;
}
