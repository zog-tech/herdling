import type { ThreadItem } from "@zogssh/protocol";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { mergeItems } from "./merge";
import type { FollowStatus } from "./useThread";

/** `agent_running`: on a subagent transcript, false when the subagent stopped (newer hosts only). */
export type FollowData = { items: ThreadItem[]; offset: number; agent_running?: boolean } | { error: string };

export const PAGE_SIZE = 40;
/** Retry delays after failures; the last value repeats. */
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export const codeOf = (e: unknown) => String((e as { code?: unknown })?.code ?? "");
export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Failure handler: shows the error, then schedules a restart with backoff. A dropped connection
 * gives a new rpc client, which restarts the caller's effect anyway, so no retry then.
 */
export function makeFail(opts: {
  failures: MutableRefObject<number>;
  setError: (m: string | undefined) => void;
  setStatus: (s: FollowStatus) => void;
  restartIn: (ms: number) => void;
}) {
  return (e: unknown) => {
    opts.setError(messageOf(e));
    opts.setStatus("error");
    const delay = BACKOFF_MS[Math.min(opts.failures.current, BACKOFF_MS.length - 1)];
    opts.failures.current++;
    if (codeOf(e) !== "disconnected") opts.restartIn(delay);
  };
}

/** `thread.follow` data handler: merges new items; a log error ends the follow and fails. */
export function followHandler(opts: {
  isDead: () => boolean;
  setItems: Dispatch<SetStateAction<ThreadItem[]>>;
  onEnded: (e: Error) => void;
  onAgentRunning?: (running: boolean) => void;
}) {
  return (d: FollowData) => {
    if (opts.isDead()) return;
    if ("error" in d) {
      opts.onEnded(new Error(`thread follow ended: ${d.error}`));
      return;
    }
    if (d.items.length > 0) opts.setItems((prev) => mergeItems(prev, d.items));
    if (typeof d.agent_running === "boolean") opts.onAgentRunning?.(d.agent_running);
  };
}

/**
 * Fetch one older page, guarded so a second call while one is in flight does nothing. `isCurrent`
 * tells whether the source is still the one that started the fetch.
 */
export function fetchOlder<P>(opts: {
  guard: MutableRefObject<boolean>;
  setLoadingOlder: (b: boolean) => void;
  fetch: () => Promise<P>;
  isCurrent: () => boolean;
  apply: (page: P) => void;
}) {
  opts.guard.current = true;
  opts.setLoadingOlder(true);
  opts
    .fetch()
    .then((page) => {
      if (opts.isCurrent()) opts.apply(page);
    })
    .catch(() => {})
    .finally(() => {
      if (opts.isCurrent()) opts.guard.current = false;
      opts.setLoadingOlder(false);
    });
}
