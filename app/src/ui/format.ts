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

/** `7800` s away -> `"resets in 2h 10m"`. Under a minute (or past) -> `"resets now"`. `null` -> `""`. */
export function formatResetIn(resetsAt: number | null, nowS: number): string {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return "";
  const s = resetsAt - nowS;
  if (s < 60) return "resets now";
  const m = Math.floor(s / 60);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return `resets in ${d}d${h ? ` ${h}h` : ""}`;
  if (h > 0) return `resets in ${h}h${min ? ` ${min}m` : ""}`;
  return `resets in ${min}m`;
}
