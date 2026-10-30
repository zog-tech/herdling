import type { PushPrefs } from "@zogssh/protocol";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

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
      storage: secureJSONStorage(),
      partialize: (s) => ({ finished: s.finished, needs_you: s.needs_you }),
    },
  ),
);

/** The current prefs as sent on the wire. */
export function currentPrefs(): PushPrefs {
  const { finished, needs_you } = useNotifPrefs.getState();
  return { finished, needs_you };
}
