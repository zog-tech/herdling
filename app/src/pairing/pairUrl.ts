/** Default pairing port of `zogsshd serve`. */
export const DEFAULT_PAIR_PORT = 7790;

/**
 * Where to pair. `fingerprint` is the host key fingerprint from the QR code: the `/pair`
 * answer must report the same key, or pairing stops.
 */
export type PairTarget = { address: string; port: number; code: string; fingerprint?: string };

/** `SHA256:` and the unpadded base64 of a 32-byte digest, as `ssh-keygen -lf` prints it. */
export const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}$/;

/**
 * Reads a pairing QR / deep link: `zogssh://pair?h=<host>&p=<port>&c=<code>&f=<fingerprint>`.
 * `p` is optional (default 7790). `f` is optional, but when present it must be a valid
 * fingerprint. Returns null for any other URL or a bad value.
 * Parsed by hand: React Native's `URL` has no working `searchParams`.
 */
export function parsePairUrl(url: string): PairTarget | null {
  const m = /^zogssh:\/\/pair\/?\?(.*)$/i.exec(url.trim());
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
  const fingerprint = params.get("f");
  if (fingerprint === undefined) return { address, port, code };
  if (!FINGERPRINT_RE.test(fingerprint)) return null;
  return { address, port, code, fingerprint };
}
