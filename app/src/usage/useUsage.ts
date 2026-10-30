import type { Usage } from "@zogssh/protocol";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";

export const USAGE_POLL_MS = 60_000;

/** Plan usage of one host (`usage.get`), refreshed every 60 s while the screen is focused and the app is active. `refresh` reads now. */
export function useUsage(hostId: string): { usage: Usage | undefined; refresh: () => Promise<void> } {
  const { rpc } = useHostConn(hostId);
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [usage, setUsage] = useState<Usage>();
  const readRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setUsage(undefined);
  }, [hostId]);

  useEffect(() => {
    if (!rpc || !focused || !active) {
      readRef.current = async () => {};
      return;
    }
    let dead = false;
    let busy: Promise<void> | undefined;
    const read = () => {
      busy ??= (async () => {
        try {
          const u = await rpc.call<Usage>("usage.get", {});
          if (!dead) setUsage(u);
        } catch {
          // Keep the last reading; the next tick retries.
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
  }, [rpc, focused, active]);

  const refresh = useCallback(() => readRef.current(), []);
  return { usage, refresh };
}
