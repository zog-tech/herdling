const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** `17179869184` -> `"16 GB"`, `1610612736` -> `"1.5 GB"`. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} ${UNITS[i]}`;
}

/** Percent of `total` used, clamped to 0..100. 0 when `total` is 0. */
export function pct(used: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(used)) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}
