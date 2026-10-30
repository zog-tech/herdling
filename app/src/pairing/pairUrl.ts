/** Default pairing port of `zogsshd serve`. */
export const DEFAULT_PAIR_PORT = 7790;

export type PairTarget = { address: string; port: number; code: string };

/**
 * Reads a pairing QR / deep link: `zogssh://pair?h=<host>&p=<port>&c=<code>`.
 * `p` is optional (default 7790). Returns null for any other URL or a bad value.
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
  if (!address || /[\s/?#@]/.test(address)) return null;
  if (!/^\d{6}$/.test(code)) return null;
  let port = DEFAULT_PAIR_PORT;
  if (portText !== undefined) {
    if (!/^\d{1,5}$/.test(portText)) return null;
    port = Number(portText);
    if (port < 1 || port > 65535) return null;
  }
  return { address, port, code };
}
