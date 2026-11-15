import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

import { CORE_ID_PREFIX, hostIsCoreOnly } from "./backend";
import { paneKey } from "./snapshot";

type SeenStore = { seen: Record<string, number> };

/** Last `state_change_seq` the user has seen per pane, persisted. */
export const useSeen = create<SeenStore>()(
  persist(() => ({ seen: {} }) as SeenStore, {
    name: "herdling.seen",
    storage: secureJSONStorage(),
  }),
);

/** Call when the user opens a session: hides that pane from "Needs you" until its state changes again. */
export function markSeen(hostId: string, paneId: string, seq: number): void {
  const key = paneKey(hostId, paneId);
  useSeen.setState((s) => ((s.seen[key] ?? 0) >= seq ? s : { seen: { ...s.seen, [key]: seq } }));
}

/**
 * Moves the entries of `hostId` with an old `hc:` pane id to the plain id (herdlingd 0.2.0 has
 * plain ids). The higher seq wins. The same object when nothing moves. Pure.
 */
export function migrateSeen(seen: Record<string, number>, hostId: string): Record<string, number> {
  const old = `${hostId}:${CORE_ID_PREFIX}`;
  const moving = Object.keys(seen).filter((k) => k.startsWith(old));
  if (moving.length === 0) return seen;
  const next = { ...seen };
  for (const k of moving) {
    const plain = paneKey(hostId, k.slice(old.length));
    next[plain] = Math.max(next[plain] ?? 0, seen[k]);
    delete next[k];
  }
  return next;
}

/**
 * Drops last-seen entries of `hostId` for panes that no longer exist. On a Herdr 2 only host,
 * entries with an old `hc:` id move to the plain id first.
 */
export function pruneSeen(hostId: string, livePaneIds: string[]): void {
  const prefix = `${hostId}:`;
  const live = new Set(livePaneIds.map((id) => paneKey(hostId, id)));
  const coreOnly = hostIsCoreOnly(hostId);
  useSeen.setState((s) => {
    const base = coreOnly ? migrateSeen(s.seen, hostId) : s.seen;
    const stale = Object.keys(base).filter((k) => k.startsWith(prefix) && !live.has(k));
    if (stale.length === 0) return base === s.seen ? s : { seen: base };
    const seen = { ...base };
    stale.forEach((k) => delete seen[k]);
    return { seen };
  });
}

/** True once the persisted last-seen map is loaded. Before that, "Needs you" would flash every idle agent. */
export function useSeenHydrated(): boolean {
  const [ready, setReady] = useState(() => useSeen.persist.hasHydrated());
  useEffect(() => {
    if (useSeen.persist.hasHydrated()) setReady(true);
    return useSeen.persist.onFinishHydration(() => setReady(true));
  }, []);
  return ready;
}
