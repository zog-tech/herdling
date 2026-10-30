import type { Stats } from "@zogssh/protocol";
import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";

export const STATS_POLL_MS = 10_000;

/** Host CPU and memory (`stats.get`), polled every 10 s while the screen is focused and the app is active. */
export function useHostStats(hostId: string): Stats | undefined {
  const { rpc } = useHostConn(hostId);
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [stats, setStats] = useState<Stats>();

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setStats(undefined);
  }, [hostId]);

  useEffect(() => {
    if (!rpc || !focused || !active) return;
    let dead = false;
    let busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const s = await rpc.call<Stats>("stats.get", {});
        if (!dead) setStats(s);
      } catch {
        // Keep the last reading; the next tick retries.
      } finally {
        busy = false;
      }
    };
    void read();
    const t = setInterval(() => void read(), STATS_POLL_MS);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [rpc, focused, active]);

  return stats;
}
