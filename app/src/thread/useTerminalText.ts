import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";

const REFRESH_MS = 2_000;
const LINES = 200;

/** Recent plain-text screen of a herdr pane (`agent.read`), refreshed every 2 s while `enabled` and the app is in the foreground. */
export function useTerminalText(hostId: string, paneId: string, enabled: boolean): { text?: string; error?: string } {
  const { rpc } = useHostConn(hostId);
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setText(undefined);
  }, [hostId, paneId]);

  useEffect(() => {
    if (!rpc || !enabled || !active) return;
    let dead = false;
    let busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await rpc.call<{ read?: { text?: string } }>("herdr.call", {
          method: "agent.read",
          params: { target: paneId, source: "recent", lines: LINES, format: "text" },
        });
        if (dead) return;
        setText(r.read?.text ?? "");
        setError(undefined);
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [rpc, paneId, enabled, active]);

  return { text, error };
}
