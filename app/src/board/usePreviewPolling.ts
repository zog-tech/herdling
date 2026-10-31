import type { AgentPreview } from "@herdling/protocol";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { useSnapshots } from "@/herdr/snapshotStore";
import { useHostConn } from "@/hosts/connection";
import { hasMethod } from "@/hosts/methods";

import { setHostPreviews } from "./boardStore";

export const PREVIEW_POLL_MS = 3_000;

/**
 * Polls `agents.preview` on one host every 3 s while `enabled` (the Board is focused), the
 * app is active and the host is connected. Stops otherwise. A companion without the method
 * is asked again only after a reconnect.
 */
export function usePreviewPolling(hostId: string, enabled: boolean): void {
  const { rpc, hello } = useHostConn(hostId);
  const supported = hasMethod(hello, "agents.preview");
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!rpc || !supported || !enabled || !active) return;
    let dead = false;
    let busy = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await rpc.call<{ previews?: AgentPreview[] }>("agents.preview", {});
        if (dead) return;
        const agents = useSnapshots.getState().byHost[hostId]?.agents ?? [];
        setHostPreviews(hostId, r.previews ?? [], (id) => agents.find((a) => a.pane_id === id)?.agent_status);
      } catch (e) {
        if ((e as { code?: unknown })?.code === "unknown_method" && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      } finally {
        busy = false;
      }
    };
    timer = setInterval(() => void poll(), PREVIEW_POLL_MS);
    void poll();
    return () => {
      dead = true;
      if (timer) clearInterval(timer);
    };
  }, [rpc, supported, hostId, enabled, active]);
}
