import { useEffect, useRef } from "react";
import { AccessibilityInfo } from "react-native";

import * as haptics from "@/ui/haptics";

import { BUCKET_LABEL, type Bucket, type BoardItem } from "./buckets";

export type BucketChange = { key: string; title: string; from: Bucket; to: Bucket };

/**
 * Cards whose bucket changed since `prev` (key → bucket). New and gone cards are not changes.
 * Ready → idle is the user's own "seen", not news, so it is left out.
 */
export function bucketChanges(prev: Record<string, Bucket>, items: BoardItem[]): BucketChange[] {
  const out: BucketChange[] = [];
  for (const i of items) {
    const from = prev[i.key];
    if (from === undefined || from === i.bucket) continue;
    if (from === "ready" && i.bucket === "idle") continue;
    out.push({ key: i.key, title: i.title, from, to: i.bucket });
  }
  return out;
}

/** "api moved to Needs you"; several changes at once: "api moved to Needs you, and 2 more". */
export function announcement(changes: BucketChange[]): string | undefined {
  if (changes.length === 0) return undefined;
  const first = `${changes[0].title} moved to ${BUCKET_LABEL[changes[0].to]}`;
  return changes.length === 1 ? first : `${first}, and ${changes.length - 1} more`;
}

/** VoiceOver gets at most one announcement in this time. */
export const ANNOUNCE_MS = 2_000;

/**
 * Throttle that keeps the newest text: the first goes out at once, later ones wait for the end of
 * the 2 s window and only the last of them goes out.
 */
export function makeThrottle(say: (text: string) => void, ms = ANNOUNCE_MS) {
  let last = -Infinity;
  let pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    push(text: string, now = Date.now()) {
      if (now - last >= ms && !timer) {
        last = now;
        say(text);
        return;
      }
      pending = text;
      timer ??= setTimeout(() => {
        timer = undefined;
        last = Date.now();
        if (pending) say(pending);
        pending = undefined;
      }, Math.max(0, ms - (now - last)));
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}

/**
 * While the Board is focused: a bucket change of a card is announced to VoiceOver (focus does not
 * move) and gives one status haptic. Both are throttled.
 */
export function useBucketAnnouncements(items: BoardItem[], focused: boolean): void {
  const prev = useRef<Record<string, Bucket> | undefined>(undefined);
  const throttle = useRef(makeThrottle((t) => AccessibilityInfo.announceForAccessibility(t)));
  useEffect(() => () => throttle.current.cancel(), []);
  useEffect(() => {
    const before = prev.current;
    prev.current = Object.fromEntries(items.map((i) => [i.key, i.bucket]));
    if (!before || !focused) return;
    const changes = bucketChanges(before, items);
    const text = announcement(changes);
    if (!text) return;
    throttle.current.push(text);
    haptics.status({ from: changes[0].from, to: changes[0].to });
  }, [items, focused]);
}
