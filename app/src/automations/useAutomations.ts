import type { Automation, AutomationRun } from "@zogssh/protocol";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";
import { hasMethod } from "@/hosts/methods";
import { RpcError } from "@/rpc/RpcClient";

export const AUTOMATIONS_POLL_MS = 30_000;

export type AutomationsState =
  | { kind: "loading" }
  | { kind: "not_installed" }
  | { kind: "outdated" }
  | { kind: "error"; message: string }
  | { kind: "ready"; automations: Automation[]; runs: AutomationRun[] };

/** Pending approvals first, then by name. */
export function sortAutomations(list: Automation[]): Automation[] {
  return [...list].sort((a, b) => Number(b.pending_approval) - Number(a.pending_approval) || a.name.localeCompare(b.name));
}

/** Automations and recent runs of one host, refreshed every 30 s while focused and active. `approve` then reloads. */
export function useAutomations(hostId: string): {
  state: AutomationsState;
  refresh: () => Promise<void>;
  approve: (a: Automation) => Promise<void>;
} {
  const { rpc, hello } = useHostConn(hostId);
  const supported = hasMethod(hello, "automations.list") && hasMethod(hello, "automations.runs");
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [state, setState] = useState<AutomationsState>({ kind: "loading" });
  const readRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setState({ kind: "loading" });
  }, [hostId]);

  useEffect(() => {
    if (rpc && !supported) setState({ kind: "outdated" });
    if (!rpc || !supported || !focused || !active) {
      readRef.current = async () => {};
      return;
    }
    let dead = false;
    let busy: Promise<void> | undefined;
    const read = () => {
      busy ??= (async () => {
        try {
          const [l, r] = await Promise.all([
            rpc.call<{ automations: Automation[] }>("automations.list", {}, 20_000),
            rpc.call<{ runs: AutomationRun[] }>("automations.runs", { limit: 20 }, 20_000),
          ]);
          if (!dead) setState({ kind: "ready", automations: sortAutomations(l.automations), runs: r.runs });
        } catch (e) {
          if (dead) return;
          if (e instanceof RpcError && e.code === "unknown_method") setState({ kind: "outdated" });
          else if (e instanceof RpcError && e.code === "not_installed") setState({ kind: "not_installed" });
          else if (e instanceof RpcError && e.code !== "timeout" && e.code !== "disconnected") {
            setState({ kind: "error", message: e.message });
          }
          // Transport errors keep the last state; the next tick retries.
        } finally {
          busy = undefined;
        }
      })();
      return busy;
    };
    readRef.current = read;
    void read();
    const t = setInterval(() => void read(), AUTOMATIONS_POLL_MS);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [rpc, supported, focused, active]);

  const refresh = useCallback(() => readRef.current(), []);
  const approve = useCallback(
    async (a: Automation) => {
      if (!rpc || !a.content_hash) throw new RpcError("bad_request", "nothing to approve");
      await rpc.call("automations.approve", { id: a.id, content_hash: a.content_hash }, 20_000);
      await readRef.current();
    },
    [rpc],
  );
  return { state, refresh, approve };
}
