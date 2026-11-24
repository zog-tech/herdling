import type { NotifPrefs } from "@/push/prefs";

/**
 * The values at the right of the More index rows: one short text that sums a page up. Pure, so the
 * index stays a thin list.
 */

/** The Notifications row: which of the two push kinds are on. */
export function notifValue(p: Pick<NotifPrefs, "finished" | "needs_you">): string {
  if (p.finished && p.needs_you) return "On";
  if (p.needs_you) return "Needs you only";
  if (p.finished) return "Finished only";
  return "Off";
}

/** A count as the value of a row, for example "3". */
export function countValue(n: number): string {
  return String(Math.max(0, Math.floor(n)));
}
