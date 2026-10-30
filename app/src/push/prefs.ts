import type { PushPrefs } from "@zogssh/protocol";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type PrefsStore = PushPrefs & { setPref: (key: keyof PushPrefs, value: boolean) => void };

/** Which pushes this phone wants. Persisted; both default to on. */
export const useNotifPrefs = create<PrefsStore>()(
  persist(
    (set) => ({
      finished: true,
      needs_you: true,
      setPref: (key, value) => set({ [key]: value } as Pick<PushPrefs, typeof key>),
    }),
    {
      name: "zogssh.notif_prefs",
      storage: createJSONStorage(() => ({
        getItem: (k) => SecureStore.getItemAsync(k),
        setItem: (k, v) => SecureStore.setItemAsync(k, v),
        removeItem: (k) => SecureStore.deleteItemAsync(k),
      })),
      partialize: (s) => ({ finished: s.finished, needs_you: s.needs_you }),
    },
  ),
);

/** The current prefs as sent on the wire. */
export function currentPrefs(): PushPrefs {
  const { finished, needs_you } = useNotifPrefs.getState();
  return { finished, needs_you };
}
