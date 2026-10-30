import type { AgentStatus, ThreadItem, ThreadPage, ThreadRef } from "@zogssh/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import { useHostConn } from "@/hosts/connection";
import type { RpcClient } from "@/rpc/RpcClient";
import { PAGE_SIZE, type FollowData, codeOf, fetchOlder, followHandler, makeFail, messageOf } from "./followShared";
import { mergeItems } from "./merge";

/**
 * - `offline`: no host connection.
 * - `loading`: resolve / first page in flight.
 * - `live`: following the log.
 * - `waiting`: the session has no log file yet (a new agent before its first prompt).
 * - `no_session`: the pane has no thread log (not Claude, or not found); show terminal text.
 * - `error`: the last attempt failed; a retry is scheduled.
 */
export type FollowStatus = "offline" | "loading" | "live" | "waiting" | "no_session" | "error";

export type Thread = {
  ref?: ThreadRef;
  items: ThreadItem[];
  status: FollowStatus;
  error?: string;
  loadOlder: () => void;
  loadingOlder: boolean;
  hasOlder: boolean;
};

/** Retry delay while the log file does not exist yet. */
const WAITING_RETRY_MS = 2_000;

/** The cursor that reaches further back; null means the start of the file is loaded. */
function olderCursor(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : Math.min(a, b);
}

/**
 * Thread of one herdr pane: `thread.resolve` → `thread.get` (last page) → `thread.follow` from the
 * page end. Restarts on reconnect, on a follow error, and when the agent status changes and the
 * pane may now have a different (or a first) session log.
 */
export function useThread(hostId: string, paneId: string, agentStatus?: AgentStatus): Thread {
  const { rpc } = useHostConn(hostId);
  const [ref, setRef] = useState<ThreadRef>();
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [status, setStatus] = useState<FollowStatus>(rpc ? "loading" : "offline");
  const [error, setError] = useState<string>();
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Bumped to run resolve → get → follow again. */
  const [epoch, setEpoch] = useState(0);
  const failures = useRef(0);
  /** The source `loadOlder` reads from; replaced on every successful start. */
  const source = useRef<{ rpc: RpcClient; logPath: string; cursor: number | null; token: object }>(undefined);
  const statusRef = useRef(status);
  statusRef.current = status;
  const refRef = useRef(ref);
  refRef.current = ref;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** Guards `loadOlder` synchronously, so a second call with the same cursor never fetches. */
  const loadingOlderRef = useRef(false);

  // A different pane: forget the old thread.
  useEffect(() => {
    setItems([]);
    setRef(undefined);
    setHasOlder(false);
    source.current = undefined;
    failures.current = 0;
  }, [hostId, paneId]);

  useEffect(() => {
    if (!rpc) {
      setStatus("offline");
      return;
    }
    let dead = false;
    let unsub: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const restartIn = (ms: number) => {
      retry = setTimeout(() => !dead && setEpoch((n) => n + 1), ms);
    };
    const fail = makeFail({ failures, setError, setStatus, restartIn });

    const start = async () => {
      if (statusRef.current !== "live") setStatus("loading");
      try {
        const r = await rpc.call<ThreadRef>("thread.resolve", { pane_id: paneId });
        if (dead) return;
        setRef(r);
        const logPath = r.log_path;
        if (!logPath) {
          source.current = undefined;
          setItems([]);
          setHasOlder(false);
          setStatus("no_session");
          setError(undefined);
          failures.current = 0;
          return;
        }
        let page: ThreadPage;
        try {
          page = await rpc.call<ThreadPage>("thread.get", { log_path: logPath, limit: PAGE_SIZE });
        } catch (e) {
          if (dead) return;
          if (codeOf(e) !== "not_found") throw e;
          // Claude writes the log on the first prompt.
          source.current = undefined;
          setItems([]);
          setHasOlder(false);
          setStatus("waiting");
          setError(undefined);
          restartIn(WAITING_RETRY_MS);
          return;
        }
        if (dead) return;
        const token = {};
        const prev = source.current;
        // Same log as before (a reconnect or a retry): keep the loaded items and merge, so older
        // pages stay. Only when the new page overlaps them; otherwise items in between are missing.
        const overlaps =
          prev?.logPath === logPath &&
          page.items.length > 0 &&
          itemsRef.current.some((i) => i.id === page.items[0].id);
        const cursor = overlaps ? olderCursor(prev!.cursor, page.cursor) : page.cursor;
        source.current = { rpc, logPath, cursor, token };
        loadingOlderRef.current = false;
        setItems((cur) => (overlaps ? mergeItems(cur, page.items) : page.items));
        setHasOlder(cursor != null);
        const u = await rpc.stream<FollowData>(
          "thread.follow",
          { log_path: logPath, from: page.end },
          followHandler({
            isDead: () => dead,
            setItems,
            onEnded: (e) => {
              // The log went away (for example a new session in the same pane): resolve again.
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
    };

    void start();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      unsub?.();
    };
  }, [rpc, paneId, epoch]);

  // Status changes can mean a new session in this pane (a first prompt, `/clear`, a restart).
  const lastStatus = useRef(agentStatus);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = agentStatus;
    if (!rpc || prev === undefined || agentStatus === prev) return;
    const st = statusRef.current;
    if (st === "no_session" || st === "waiting" || st === "error") {
      setEpoch((n) => n + 1);
      return;
    }
    if (st !== "live" || (agentStatus !== "idle" && agentStatus !== "done")) return;
    // Live: check that the pane still points at the same log; switch if not.
    let dead = false;
    rpc
      .call<ThreadRef>("thread.resolve", { pane_id: paneId })
      .then((r) => {
        if (!dead && r.log_path !== refRef.current?.log_path) setEpoch((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [agentStatus, rpc, paneId]);

  const loadOlder = useCallback(() => {
    const src = source.current;
    if (!src || src.cursor == null || loadingOlderRef.current) return;
    const before = src.cursor;
    fetchOlder({
      guard: loadingOlderRef,
      setLoadingOlder,
      fetch: () => src.rpc.call<ThreadPage>("thread.get", { log_path: src.logPath, before, limit: PAGE_SIZE }),
      isCurrent: () => source.current?.token === src.token,
      apply: (page) => {
        src.cursor = page.cursor;
        setHasOlder(page.cursor != null);
        // Newer copies of the same ids (already loaded) win.
        setItems((prev) => mergeItems(page.items, prev));
      },
    });
  }, []);

  return { ref, items, status, error, loadOlder, loadingOlder, hasOlder };
}
