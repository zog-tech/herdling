import * as Haptics from "expo-haptics";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

/**
 * The app's haptic vocabulary. This is the only module that imports expo-haptics.
 * Rules: one haptic per user action, always with a visual change; never on scroll, typing or a
 * plain render. Haptics fire with Reduce Motion too, because they are not motion.
 */

type FeelStore = { haptics: boolean; set: (patch: { haptics?: boolean }) => void };

/** "Haptics" setting. On by default. Persisted. */
export const useFeelSettings = create<FeelStore>()(
  persist(
    (set) => ({ haptics: true, set: (patch) => set(patch) }),
    { name: "zogssh.feel_settings", storage: secureJSONStorage(), partialize: (s) => ({ haptics: s.haptics }) },
  ),
);

const on = () => useFeelSettings.getState().haptics;
const fire = (p: Promise<unknown>) => void p.catch(() => {});

/** A value or a selection changes: chips, filters, the segmented control, menu rows, toggles. */
export function tap(): void {
  if (on()) fire(Haptics.selectionAsync());
}

/** A primary button: send, open the "+" menu, open a session. Recording stops. */
export function press(): void {
  if (on()) fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A long-press peek fires, a swipe passes its action point, recording starts. */
export function peek(): void {
  if (on()) fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Something succeeded: approve, prompt accepted, rename saved, upload done. */
export function commit(): void {
  if (on()) fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** A deny, or a destructive confirm (close, restart) comes up. */
export function warn(): void {
  if (on()) fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** Something failed: send, upload, rename. */
export function fail(): void {
  if (on()) fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

/** Status haptics come at most once in this time. */
export const STATUS_THROTTLE_MS = 1_500;
let lastStatus = -Infinity;

export type StatusChange = { from?: string; to: string };

/**
 * The open session or a Board card changed its bucket. Work done → Success, now needs you → Warning,
 * else a selection tick. Throttled to one per 1.5 s.
 * The names are agent statuses or Board buckets: "working", "done"/"idle"/"ready", "blocked"/"needs_you".
 */
export function status({ from, to }: StatusChange, now = Date.now()): void {
  if (!on() || from === to || now - lastStatus < STATUS_THROTTLE_MS) return;
  lastStatus = now;
  const finished = to === "done" || to === "idle" || to === "ready";
  if (to === "blocked" || to === "needs_you") fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  else if (from === "working" && finished) fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  else fire(Haptics.selectionAsync());
}

/** Tests only: forget the last status haptic. */
export function resetStatusThrottle(): void {
  lastStatus = -Infinity;
}
