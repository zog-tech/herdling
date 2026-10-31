import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";

import { NONE, parseChoices, sameChoices, type Choice } from "./parseChoices";

export { destructiveKey, parseChoices, sameChoices, type Choice } from "./parseChoices";

const REFRESH_MS = 1_000;

/** Choices on a pane's visible screen (`pane.read`), read every 1 s while `blocked` and the app is in the foreground. */
export function useChoices(hostId: string, paneId: string, blocked: boolean): Choice[] {
  const { rpc } = useHostConn(hostId);
  const [choices, setChoices] = useState<Choice[]>(NONE);
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setChoices(NONE);
    if (!rpc || !blocked || !active) return;
    let dead = false;
    let busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await rpc.call<{ read?: { text?: string } }>("herdr.call", {
          method: "pane.read",
          params: { pane_id: paneId, source: "visible", format: "text" },
        });
        if (dead) return;
        const next = parseChoices(r.read?.text ?? "");
        // Same menu as before: keep the old array so the composer does not re-render every second.
        setChoices((prev) => (sameChoices(prev, next) ? prev : next));
      } catch {
        // The screen is unknown now: show no buttons (the composer shows the blocked message); the next tick retries.
        if (!dead) setChoices(NONE);
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
  }, [rpc, hostId, paneId, blocked, active]);

  return choices;
}

type Rpc = { call<T>(method: string, params: unknown): Promise<T> };

/**
 * Answers a permission menu with the bare digit of `choice` (`pane.send_keys`, no Enter).
 * Re-reads the visible screen first and sends nothing ("stale") when the agent is no longer blocked
 * or the menu on screen is not the one the buttons show.
 */
export async function answerChoice(
  rpc: Rpc,
  paneId: string,
  shown: Choice[],
  choice: Choice,
  stillBlocked: () => boolean,
): Promise<"sent" | "stale"> {
  const r = await rpc.call<{ read?: { text?: string } }>("herdr.call", {
    method: "pane.read",
    params: { pane_id: paneId, source: "visible", format: "text" },
  });
  const now = parseChoices(r.read?.text ?? "");
  const sameMenu = now.length === shown.length && now.every((c, i) => c.key === shown[i].key && c.label === shown[i].label);
  if (!stillBlocked() || !sameMenu || !shown.some((c) => c.key === choice.key)) return "stale";
  await rpc.call("herdr.call", { method: "pane.send_keys", params: { pane_id: paneId, keys: [choice.key] } });
  return "sent";
}
