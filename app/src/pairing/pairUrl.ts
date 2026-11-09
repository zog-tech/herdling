/** Default pairing port of `herdlingd serve`. */
export const DEFAULT_PAIR_PORT = 7790;

/**
 * Where to pair. `fingerprint` is the host key fingerprint from the QR code: the pairing
 * answer must report the same key, or pairing stops. `requireV2`: the QR code says `v=2`, so
 * the app uses only pairing v2 and never the older v1.
 */
export type PairTarget = { address: string; port: number; code: string; fingerprint?: string; requireV2?: true };

/** `SHA256:` and the unpadded base64 of a 32-byte digest, as `ssh-keygen -lf` prints it. */
export const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}$/;

/**
 * Reads a pairing QR / deep link: `herdling://pair?h=<host>&p=<port>&c=<code>&f=<fingerprint>&v=2`.
 * `p` is optional (default 7790). `f` is optional, but when present it must be a valid
 * fingerprint. `v=2` sets `requireV2`; other `v` values and unknown parameters are ignored.
 * Returns null for any other URL or a bad value.
 * Parsed by hand: React Native's `URL` has no working `searchParams`.
 */
export function parsePairUrl(url: string): PairTarget | null {
  const m = /^herdling:\/\/pair\/?\?(.*)$/i.exec(url.trim());
  if (!m) return null;
  const params = new Map<string, string>();
  for (const part of m[1].split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    try {
      params.set(part.slice(0, eq), decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " ")));
    } catch {
      return null;
    }
  }
  const address = params.get("h")?.trim() ?? "";
  const code = params.get("c") ?? "";
  const portText = params.get("p");
  if (!address || /[\s/?#@:,]/.test(address)) return null;
  if (!/^\d{6}$/.test(code)) return null;
  let port = DEFAULT_PAIR_PORT;
  if (portText !== undefined) {
    if (!/^\d{1,5}$/.test(portText)) return null;
    port = Number(portText);
    if (port < 1 || port > 65535) return null;
  }
  const target: PairTarget = { address, port, code };
  const fingerprint = params.get("f");
  if (fingerprint !== undefined) {
    if (!FINGERPRINT_RE.test(fingerprint)) return null;
    target.fingerprint = fingerprint;
  }
  if (params.get("v") === "2") target.requireV2 = true;
  return target;
}
