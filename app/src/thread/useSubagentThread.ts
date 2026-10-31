import type { SubagentPage, ThreadItem, ThreadPage } from "@zogssh/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import { useHostConn } from "@/hosts/connection";
import { PAGE_SIZE, fetchOlder, followHandler, makeFail, type FollowData } from "./followShared";
import { mergeItems, prependOlder } from "./merge";
import type { FollowStatus } from "./useThread";

/**
 * Thread of one subagent: `thread.subagent` (last page) → `thread.follow` from the page end on the
 * subagent file. Older pages come from `thread.subagent {before}`. Restarts on reconnect and on a
 * follow error, keeping loaded items. `running`: true while the subagent runs, false when it
 * stopped, undefined when the host does not tell (an older host).
 */
export function useSubagentThread(
  hostId: string,
  parentLog: string,
  agentId: string,
): {
  items: ThreadItem[];
  status: FollowStatus;
  loadOlder: () => void;
  loadingOlder: boolean;
  hasOlder: boolean;
  error?: string;
  running?: boolean;
} {
  const { rpc } = useHostConn(hostId);
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [status, setStatus] = useState<FollowStatus>(rpc ? "loading" : "offline");
  const [error, setError] = useState<string>();
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [running, setRunning] = useState<boolean>();
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
    setRunning(undefined);
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
    const fail = makeFail({
      failures,
      setError,
      setStatus,
      restartIn: (ms) => {
        retry = setTimeout(() => !dead && setEpoch((n) => n + 1), ms);
      },
    });
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
        setRunning(page.running);
        const u = await rpc.stream<FollowData>(
          "thread.follow",
          { log_path: page.log_path, from: page.end },
          followHandler({
            isDead: () => dead,
            setItems,
            onAgentRunning: setRunning,
            onEnded: (e) => {
              unsub = undefined;
              fail(e);
            },
          }),
        );
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
    fetchOlder({
      guard: loadingRef,
      setLoadingOlder,
      fetch: () => rpc.call<ThreadPage>("thread.subagent", { log_path: parentLog, agent_id: agentId, before, limit: PAGE_SIZE }),
      isCurrent: () => true,
      apply: (page) => {
        cursor.current = page.cursor;
        setHasOlder(page.cursor != null);
        setItems((prev) => prependOlder(page.items, prev));
      },
    });
  }, [rpc, parentLog, agentId]);

  return { items, status, error, loadOlder, loadingOlder, hasOlder, running };
}
