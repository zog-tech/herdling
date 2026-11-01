import type { PushPrefs } from "@herdling/protocol";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

/** All prefs this app sends. The protocol makes the newer ones optional for older apps. */
export type NotifPrefs = Required<PushPrefs>;
export type NotifPref = keyof NotifPrefs;

const PREF_KEYS: readonly NotifPref[] = ["finished", "needs_you", "quiet_at_desk", "replace", "group", "quiet_finished"];

type PrefsStore = NotifPrefs & { setPref: (key: NotifPref, value: boolean) => void };

const pick = (s: NotifPrefs): NotifPrefs => ({
  finished: s.finished,
  needs_you: s.needs_you,
  quiet_at_desk: s.quiet_at_desk,
  replace: s.replace,
  group: s.group,
  quiet_finished: s.quiet_finished,
});

/**
 * Which pushes this phone wants, and how they show. Persisted; all default to on.
 * A store saved by an older app has no `replace`, `group` or `quiet_finished`: the merge keeps the defaults.
 */
export const useNotifPrefs = create<PrefsStore>()(
  persist(
    (set) => ({
      finished: true,
      needs_you: true,
      quiet_at_desk: true,
      replace: true,
      group: true,
      quiet_finished: true,
      setPref: (key, value) => set({ [key]: value } as Pick<NotifPrefs, typeof key>),
    }),
    {
      name: "herdling.notif_prefs",
      storage: secureJSONStorage(),
      partialize: (s) => pick(s),
    },
  ),
);

/** The current prefs as sent on the wire. */
export function currentPrefs(): NotifPrefs {
  return pick(useNotifPrefs.getState());
}

/** True when `a` and `b` have the same value for each pref. */
export function samePrefs(a: NotifPrefs, b: NotifPrefs): boolean {
  return PREF_KEYS.every((k) => a[k] === b[k]);
}
