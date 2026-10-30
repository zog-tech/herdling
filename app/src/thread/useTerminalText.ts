import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";

const REFRESH_MS = 1_000;
const LINES = 200;

type Options = {
  /** "text" (default): plain text. "ansi": text with SGR escapes, for `parseAnsi`. */
  format?: "text" | "ansi";
  refreshMs?: number;
};

/**
 * Recent screen of a herdr pane (`pane.read`, last 200 lines), read every `refreshMs` (default 1 s)
 * while `enabled` and the app is active. `refresh()` reads now (after a key press, for example).
 * An unchanged screen keeps the same string, so it does not re-render.
 */
export function useTerminalText(
  hostId: string,
  paneId: string,
  enabled: boolean,
  o?: Options,
): { text?: string; error?: string; refresh: () => void } {
  const format = o?.format ?? "text";
  const refreshMs = o?.refreshMs ?? REFRESH_MS;
  const { rpc } = useHostConn(hostId);
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const readNow = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setText(undefined);
    setError(undefined);
  }, [hostId, paneId, format]);

  useEffect(() => {
    if (!rpc || !enabled || !active) return;
    let dead = false;
    let busy = false;
    /** A read was asked for while one was in flight: read again when it ends, so the result is fresh. */
    let again = false;
    const read = async () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const r = await rpc.call<{ read?: { text?: string } }>("herdr.call", {
          method: "pane.read",
          params: { pane_id: paneId, source: "recent", lines: LINES, format, strip_ansi: format !== "ansi" },
        });
        if (dead) return;
        setText(r.read?.text ?? "");
        setError(undefined);
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy = false;
        if (again && !dead) {
          again = false;
          void read();
        }
      }
    };
    readNow.current = () => void read();
    void read();
    const timer = setInterval(() => void read(), refreshMs);
    return () => {
      dead = true;
      readNow.current = undefined;
      clearInterval(timer);
    };
  }, [rpc, paneId, enabled, active, format, refreshMs]);

  const refresh = useCallback(() => readNow.current?.(), []);
  return { text, error, refresh };
}
