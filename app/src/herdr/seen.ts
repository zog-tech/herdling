import * as SecureStore from "expo-secure-store";
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
