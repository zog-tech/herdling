import type { Usage } from "@herdling/protocol";
import { create } from "zustand";

/**
 * The last plan usage that the Usage screen read, per computer. The More index shows it as the
 * value of its Usage row. It costs no extra call: `usage.get` has a strict rate limit, so only the
 * Usage screen reads it. Kept in memory only; after a restart the row shows no value until the
 * Usage screen reads again.
 */
type Store = { byHost: Record<string, Usage> };

export const useUsageSummary = create<Store>(() => ({ byHost: {} }));

/** Keeps the last reading of a computer. `undefined` drops it (the computer is gone). */
export function noteUsage(hostId: string, usage: Usage | undefined): void {
  useUsageSummary.setState((s) => {
    const byHost = { ...s.byHost };
    if (usage) byHost[hostId] = usage;
    else delete byHost[hostId];
    return { byHost };
  });
}

/**
 * The value of the Usage row: the highest use of all usage windows of all computers, for
 * example "42% used". `undefined` when no provider has a window (no value, not "0%").
 */
export function usageValue(byHost: Readonly<Record<string, Usage>>, hostIds?: readonly string[]): string | undefined {
  const ids = hostIds ?? Object.keys(byHost);
  let max: number | undefined;
  for (const id of ids) {
    for (const p of byHost[id]?.providers ?? []) {
      if (p.status !== "ok") continue;
      for (const w of p.windows) {
        if (!Number.isFinite(w.used_pct)) continue;
        max = Math.max(max ?? 0, w.used_pct);
      }
    }
  }
  if (max === undefined) return undefined;
  return `${Math.round(Math.min(100, Math.max(0, max)))}% used`;
}
