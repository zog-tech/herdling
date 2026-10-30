import type { SubagentPage, ThreadItem, ThreadPage } from "@zogssh/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import { useHostConn } from "@/hosts/connection";
import { mergeItems } from "./merge";
import type { FollowStatus } from "./useThread";

type FollowData = { items: ThreadItem[]; offset: number } | { error: string };

const PAGE_SIZE = 40;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const codeOf = (e: unknown) => String((e as { code?: unknown })?.code ?? "");

/**
 * Thread of one subagent: `thread.subagent` (last page) → `thread.follow` from the page end on the
 * subagent file. Older pages come from `thread.subagent {before}`. Restarts on reconnect and on a
 * follow error, keeping loaded items.
 */
export function useSubagentThread(
  hostId: string,
  parentLog: string,
  agentId: string,
): { items: ThreadItem[]; status: FollowStatus; loadOlder: () => void; loadingOlder: boolean; hasOlder: boolean; error?: string } {
  const { rpc } = useHostConn(hostId);
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [status, setStatus] = useState<FollowStatus>(rpc ? "loading" : "offline");
  const [error, setError] = useState<string>();
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const failures = useRef(0);
  const cursor = useRef<number | null>(null);
  const loadingRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  // A different subagent: forget the old thread.
  useEffect(() => {
    setItems([]);
    setHasOlder(false);
    cursor.current = null;
    failures.current = 0;
  }, [hostId, parentLog, agentId]);

  useEffect(() => {
    if (!rpc) {
      setStatus("offline");
      return;
    }
    let dead = false;
    let unsub: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const fail = (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      const delay = BACKOFF_MS[Math.min(failures.current, BACKOFF_MS.length - 1)];
      failures.current++;
      if (codeOf(e) !== "disconnected") retry = setTimeout(() => !dead && setEpoch((n) => n + 1), delay);
    };
    (async () => {
      if (statusRef.current !== "live") setStatus("loading");
      try {
        const page = await rpc.call<SubagentPage>("thread.subagent", {
          log_path: parentLog,
          agent_id: agentId,
          limit: PAGE_SIZE,
        });
        if (dead) return;
        cursor.current = page.cursor;
        loadingRef.current = false;
        setItems((cur) => mergeItems(cur, page.items));
        setHasOlder(page.cursor != null);
        const u = await rpc.stream<FollowData>("thread.follow", { log_path: page.log_path, from: page.end }, (d) => {
          if (dead) return;
          if ("error" in d) {
            unsub = undefined;
            fail(new Error(`thread follow ended: ${d.error}`));
            return;
          }
          if (d.items.length > 0) setItems((prev) => mergeItems(prev, d.items));
        });
        if (dead) {
          u();
          return;
        }
        unsub = u;
        failures.current = 0;
        setError(undefined);
        setStatus("live");
      } catch (e) {
        if (!dead) fail(e);
      }
    })();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      unsub?.();
    };
  }, [rpc, parentLog, agentId, epoch]);

  const loadOlder = useCallback(() => {
    const before = cursor.current;
    if (!rpc || before == null || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    rpc
      .call<ThreadPage>("thread.subagent", { log_path: parentLog, agent_id: agentId, before, limit: PAGE_SIZE })
      .then((page) => {
        cursor.current = page.cursor;
        setHasOlder(page.cursor != null);
        setItems((prev) => mergeItems(page.items, prev));
      })
      .catch(() => {})
      .finally(() => {
        loadingRef.current = false;
        setLoadingOlder(false);
      });
  }, [rpc, parentLog, agentId]);

  return { items, status, error, loadOlder, loadingOlder, hasOlder };
}
