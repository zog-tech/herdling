/**
 * Sends the local "seen" marks of one computer to `agent.mark_seen`, so the computer keeps them.
 * Fire and forget: a failed mark is sent again at the next snapshot or the next mark, never
 * queued. Only a host that lists the method gets marks. The rules are in `readState.ts`.
 */
import { useEffect } from "react";

import { useHostConn } from "@/hosts/connection";
import { listsMethod } from "@/hosts/methods";

import { MARK_SEEN_METHOD, pendingMarks } from "./readState";
import { useSeen } from "./seen";
import { paneKey, type Snapshot } from "./snapshot";

/** Wait this long after the last change, so a quick run of marks sends once. */
const DEBOUNCE_MS = 1500;

/** The turn sent per pane key in this app run. A failed send removes its entry. */
const sent = new Map<string, number>();

/** Keeps the computer's `herdling.seen` labels of `hostId` up to the local marks. */
export function useSeenSync(hostId: string, snapshot: Snapshot | undefined): void {
  const seen = useSeen((s) => s.seen);
  const { rpc, hello } = useHostConn(hostId);
  useEffect(() => {
    if (!snapshot || snapshot.stale || !rpc || !listsMethod(hello, MARK_SEEN_METHOD)) return;
    if (pendingMarks(hostId, snapshot.agents, seen, sent).length === 0) return;
    const timer = setTimeout(() => {
      for (const m of pendingMarks(hostId, snapshot.agents, seen, sent)) {
        const key = paneKey(hostId, m.paneId);
        sent.set(key, m.turn);
        rpc.call(MARK_SEEN_METHOD, { pane_id: m.paneId, turn: m.turn }).catch(() => {
          if (sent.get(key) === m.turn) sent.delete(key);
        });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hostId, snapshot, seen, rpc, hello]);
}
