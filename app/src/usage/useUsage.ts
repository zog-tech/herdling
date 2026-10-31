import type { Usage } from "@herdling/protocol";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";
import { hasMethod } from "@/hosts/methods";

/** The Claude usage endpoint has a strict rate limit, so the screen polls slowly; pull-to-refresh reads at once. */
export const USAGE_POLL_MS = 5 * 60_000;

/** Plan usage of one host (`usage.get`), refreshed every 5 min while the screen is focused and the app is active. `refresh` reads now. */
export function useUsage(hostId: string): { usage: Usage | undefined; refresh: () => Promise<void>; failed: boolean } {
  const { rpc, hello } = useHostConn(hostId);
  const supported = hasMethod(hello, "usage.get");
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [usage, setUsage] = useState<Usage>();
  /** The last read failed (a timeout or an error). The screen offers Retry. */
  const [failed, setFailed] = useState(false);
  const readRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setUsage(undefined);
  }, [hostId]);

  useEffect(() => {
    if (!rpc || !supported || !focused || !active) {
      readRef.current = async () => {};
      return;
    }
    let dead = false;
    let busy: Promise<void> | undefined;
    const read = () => {
      busy ??= (async () => {
        try {
          const u = await rpc.call<Usage>("usage.get", {});
          if (!dead) {
            setUsage(u);
            setFailed(false);
          }
        } catch {
          // Keep the last reading; the next tick retries.
          if (!dead) setFailed(true);
        } finally {
          busy = undefined;
        }
      })();
      return busy;
    };
    readRef.current = read;
    void read();
    const t = setInterval(() => void read(), USAGE_POLL_MS);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [rpc, supported, focused, active]);

  const refresh = useCallback(() => readRef.current(), []);
  return { usage, refresh, failed };
}
