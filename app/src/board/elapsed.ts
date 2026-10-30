import type { Bucket } from "./buckets";

/** `30` → "30s", `240` → "4m", `7200` → "2h", `200000` → "2d". Negative counts as 0. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Text of a card's status pill: "working 4m", "ready 2m ago", "needs you 30s", "idle 1h".
 * Without a start time only the label shows.
 */
export function pillText(bucket: Bucket, since: number | undefined, now: number): string {
  const label = bucket === "needs_you" ? "needs you" : bucket;
  if (since === undefined) return label;
  const e = formatElapsed((now - since) / 1000);
  return bucket === "ready" ? `${label} ${e} ago` : `${label} ${e}`;
}
