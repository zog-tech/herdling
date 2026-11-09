/**
 * Secure random bytes for pairing v2. Hermes has no Web Crypto in every build, and a new native
 * module would need a new native build, so this uses what every Herdling binary has:
 * - `crypto.getRandomValues` when the runtime has it (and in tests);
 * - else the native UUID v4 of `expo-modules-core` (`UUID()` on iOS, `UUID.randomUUID()`
 *   with `SecureRandom` on Android). Each UUID has 122 random bits; SHA-512 over 5 of them
 *   (610 bits) gives 64 uniform bytes.
 * It never falls back to `Math.random`: with no secure source it throws.
 */
import { sha512 } from "@noble/hashes/sha2";

import { utf8 } from "./cpace";

type RandomGlobals = {
  crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
  expo?: { uuidv4?: () => string };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `n` secure random bytes. Throws when the runtime has no secure random source. */
export function randomBytes(n: number): Uint8Array {
  const g = globalThis as RandomGlobals;
  if (typeof g.crypto?.getRandomValues === "function") {
    return g.crypto.getRandomValues(new Uint8Array(n));
  }
  const uuid = g.expo?.uuidv4;
  if (typeof uuid !== "function") throw new Error("This device has no secure random source for pairing.");
  const out = new Uint8Array(n);
  for (let at = 0; at < n; at += 64) {
    const ids = Array.from({ length: 5 }, () => uuid());
    // A broken source (for example a constant) must not give a weak scalar.
    if (!ids.every((id) => UUID_RE.test(id)) || new Set(ids).size !== ids.length) {
      throw new Error("The random source of this device does not work.");
    }
    out.set(sha512(utf8(ids.join(""))).subarray(0, Math.min(64, n - at)), at);
  }
  return out;
}
