import type { AgentStatus, ThreadItem, ThreadPage, ThreadRef } from "@herdling/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import { THREAD_KINDS } from "@/herdr/agentKinds";
import { useHostConn } from "@/hosts/connection";
import type { RpcClient } from "@/rpc/RpcClient";
import { PAGE_SIZE, type FollowData, codeOf, fetchOlder, followHandler, makeFail, messageOf } from "./followShared";
import { mergeItems, prependOlder } from "./merge";
import { reconcilePending, usePendingList } from "./pending";

/**
 * - `offline`: no host connection.
 * - `loading`: resolve / first page in flight.
 * - `live`: following the log.
 * - `waiting`: the session has no log file yet (a new agent before its first prompt).
 * - `no_session`: the pane has no thread log (an agent without chat support, or not found); show terminal text.
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

/**
 * A new agent writes its session file a moment after it starts, so the first resolves find no log.
 * Retry this often, this many times, before the terminal fallback. The skeleton shows meanwhile.
 */
const NO_LOG_RETRY_MS = 1_000;
const NO_LOG_RETRIES = 8;

/**
 * After a send, the pane can move to a new log with no status change (`/clear` keeps the agent idle).
 * While a sent prompt has no copy in the log, check the pane's log this often, for this long.
 */
const SWITCH_CHECK_MS = 2_000;
const SWITCH_CHECK_FOR_MS = 20_000;

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
  /** Resolves of this pane that found no log for an agent with a chat view. */
  const noLogTries = useRef(0);
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

  // A different pane: forget the old thread. The status and the error of the old pane go too, so the
  // new pane shows the skeleton, not an empty "live" thread or an old error.
  useEffect(() => {
    setItems([]);
    setRef(undefined);
    setHasOlder(false);
    // The effect below runs after this one and sets "offline" when there is no rpc.
    setStatus("loading");
    setError(undefined);
    source.current = undefined;
    failures.current = 0;
    noLogTries.current = 0;
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
        if (!logPath && THREAD_KINDS.includes(r.kind) && noLogTries.current < NO_LOG_RETRIES) {
          // Probably a new agent: keep the skeleton and look again soon.
          noLogTries.current += 1;
          restartIn(NO_LOG_RETRY_MS);
          return;
        }
        // A found log ends this wait: the next session in the pane (`/clear`, a restart) gets all
        // the retries again. After the fallback the count stays, so a status change shows the terminal at once.
        if (logPath) noLogTries.current = 0;
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

  // Pending prompts go away when the log shows them. Only compare against a loaded thread.
  const pending = usePendingList(hostId, paneId);

  // A queued prompt that the log does not show: the agent may write a new log (`/clear`). Look for it.
  const lastQueued = pending.reduce((t, p) => (p.state === "queued" ? Math.max(t, p.sentAt) : t), 0);
  useEffect(() => {
    if (!rpc || status !== "live" || lastQueued === 0) return;
    let dead = false;
    const timer = setInterval(() => {
      if (Date.now() - lastQueued > SWITCH_CHECK_FOR_MS) {
        clearInterval(timer);
        return;
      }
      rpc
        .call<ThreadRef>("thread.resolve", { pane_id: paneId })
        .then((r) => {
          if (!dead && r.log_path && r.log_path !== refRef.current?.log_path) setEpoch((n) => n + 1);
        })
        .catch(() => {});
    }, SWITCH_CHECK_MS);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [rpc, paneId, status, lastQueued]);
  useEffect(() => {
    if (pending.length > 0 && (status === "live" || status === "waiting")) reconcilePending(hostId, paneId, items);
  }, [hostId, paneId, items, pending, status]);

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
        setItems((prev) => prependOlder(page.items, prev));
      },
    });
  }, []);

  return { ref, items, status, error, loadOlder, loadingOlder, hasOlder };
}
