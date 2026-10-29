import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { paneKey } from "./snapshot";

type SeenStore = { seen: Record<string, number> };

/** Last `state_change_seq` the user has seen per pane, persisted. */
export const useSeen = create<SeenStore>()(
  persist(() => ({ seen: {} }) as SeenStore, {
    name: "zogssh.seen",
    storage: createJSONStorage(() => ({
      getItem: (k) => SecureStore.getItemAsync(k),
      setItem: (k, v) => SecureStore.setItemAsync(k, v),
      removeItem: (k) => SecureStore.deleteItemAsync(k),
    })),
  }),
);

/** Call when the user opens a session: hides that pane from "Needs you" until its state changes again. */
export function markSeen(hostId: string, paneId: string, seq: number): void {
  const key = paneKey(hostId, paneId);
  useSeen.setState((s) => ((s.seen[key] ?? 0) >= seq ? s : { seen: { ...s.seen, [key]: seq } }));
}

/** Drops last-seen entries of `hostId` for panes that no longer exist. */
export function pruneSeen(hostId: string, livePaneIds: string[]): void {
  const prefix = `${hostId}:`;
  const live = new Set(livePaneIds.map((id) => paneKey(hostId, id)));
  useSeen.setState((s) => {
    const stale = Object.keys(s.seen).filter((k) => k.startsWith(prefix) && !live.has(k));
    if (stale.length === 0) return s;
    const seen = { ...s.seen };
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
