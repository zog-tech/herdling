/**
 * Smoothed round-trip time (SRTT) of a connection, for the latency badge and the typing
 * prediction. Only small calls count: their time is mostly the network, not the work on the host.
 */

/** Weight of a new sample (TCP uses the same EWMA weight, RFC 6298). */
export const SRTT_ALPHA = 1 / 8;

/** herdr methods sent through `herdr.call` that do almost no work on the host. */
const SMALL_HERDR = new Set(["pane.send_input", "pane.send_keys", "pane.send_text"]);

/** The next SRTT after a sample. The first sample sets it. */
export function nextSrtt(prev: number | undefined, sampleMs: number): number {
  if (prev === undefined) return sampleMs;
  return prev + SRTT_ALPHA * (sampleMs - prev);
}

/** True when the time of this call is a fair network sample. */
export function isSmallCall(method: string, params?: object): boolean {
  if (method === "ping") return true;
  if (method !== "herdr.call") return false;
  const m = (params as { method?: unknown } | undefined)?.method;
  return typeof m === "string" && SMALL_HERDR.has(m);
}
