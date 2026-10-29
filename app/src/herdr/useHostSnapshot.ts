import { useEffect, useRef, useState } from "react";

import { useHostConn } from "@/hosts/connection";
import { applyEvent, parseSnapshot, type HerdrEvent, type Snapshot } from "./snapshot";

const REFETCH_DEBOUNCE_MS = 250;
const RESUBSCRIBE_MS = 2_000;
/** Safety net: herdr's default event set has no status events (they need a pane id). */
const POLL_MS = 15_000;

/**
 * Live herdr snapshot of one host: fetch, then apply events. Resubscribes and refetches when
 * the event stream closes. The last snapshot stays while the host is offline.
 */
export function useHostSnapshot(hostId: string): { snapshot?: Snapshot; loading: boolean; error?: string } {
  const { rpc } = useHostConn(hostId);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const current = useRef<Snapshot | undefined>(undefined);

  useEffect(() => {
    current.current = undefined;
    setSnapshot(undefined);
  }, [hostId]);

  useEffect(() => {
    if (!rpc) {
      setLoading(false);
      return;
    }
    let dead = false;
    let unsub: (() => void) | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let resub: ReturnType<typeof setTimeout> | undefined;

    const set = (s: Snapshot) => {
      current.current = s;
      setSnapshot(s);
    };
    const refetch = async () => {
      try {
        const r = await rpc.call("herdr.call", { method: "session.snapshot", params: {} });
        if (dead) return;
        set(parseSnapshot(r));
        setError(undefined);
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!dead) setLoading(false);
      }
    };
    const scheduleRefetch = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void refetch(), REFETCH_DEBOUNCE_MS);
    };
    const onEvent = (e: HerdrEvent) => {
      if (dead) return;
      if (e.closed) {
        unsub?.();
        unsub = undefined;
        resub = setTimeout(() => void subscribe().then(refetch), RESUBSCRIBE_MS);
        return;
      }
      if (!current.current) return;
      const next = applyEvent(current.current, e);
      set(next);
      if (next.stale) scheduleRefetch();
    };
    const subscribe = async () => {
      try {
        const u = await rpc.stream<HerdrEvent>("herdr.subscribe", {}, onEvent);
        if (dead) u();
        else unsub = u;
      } catch {
        if (!dead) resub = setTimeout(() => void subscribe(), RESUBSCRIBE_MS * 2);
      }
    };

    setLoading(true);
    void subscribe();
    void refetch();
    const poll = setInterval(() => void refetch(), POLL_MS);
    return () => {
      dead = true;
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      if (resub) clearTimeout(resub);
      unsub?.();
    };
  }, [rpc]);

  return { snapshot, loading, error };
}
