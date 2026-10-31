import type { PaneWatchEvent } from "@herdling/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";
import { listsMethod } from "@/hosts/methods";

const REFRESH_MS = 1_000;
/** Read interval of `pane.watch` on the computer when the caller does not set `refreshMs`. */
const WATCH_MS = 80;
const LINES = 200;

type Options = {
  /** "text" (default): plain text. "ansi": text with SGR escapes, for `parseAnsi`. */
  format?: "text" | "ansi";
  /** Poll interval (default 1 s). With `pane.watch`, the read interval on the computer (default 80 ms). */
  refreshMs?: number;
  /** Lines to read (default 200). */
  lines?: number;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Recent screen of a herdr pane (last 200 lines) while `enabled` and the app is active.
 * With a herdlingd that has `pane.watch`, the computer pushes each new screen. Otherwise
 * (herdlingd 0.1.0) the hook reads `pane.read` every `refreshMs` (default 1 s). The hook also
 * polls when the watch stream fails or ends. `refresh()` reads now when it polls.
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
  const watchMs = o?.refreshMs ?? WATCH_MS;
  const lines = o?.lines ?? LINES;
  const { rpc, hello } = useHostConn(hostId);
  const canWatch = listsMethod(hello, "pane.watch");
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
    let timer: ReturnType<typeof setInterval> | undefined;
    let unwatch: (() => void) | undefined;
    const read = async () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const r = await rpc.call<{ read?: { text?: string } }>("herdr.call", {
          method: "pane.read",
          params: { pane_id: paneId, source: "recent", lines, format, strip_ansi: format !== "ansi" },
        });
        if (dead) return;
        setText(r.read?.text ?? "");
        setError(undefined);
      } catch (e) {
        if (!dead) setError(message(e));
      } finally {
        busy = false;
        if (again && !dead) {
          again = false;
          void read();
        }
      }
    };
    const poll = () => {
      if (dead || timer) return;
      readNow.current = () => void read();
      void read();
      timer = setInterval(() => void read(), refreshMs);
    };
    const watch = async () => {
      let ended = false;
      try {
        const off = await rpc.stream<PaneWatchEvent>(
          "pane.watch",
          { pane_id: paneId, lines, format, interval_ms: watchMs },
          (d) => {
            if (dead) return;
            if ("text" in d) {
              setText(d.text);
              setError(undefined);
              return;
            }
            // The stream ended (the pane closed, or herdr stopped): poll, which shows the error.
            ended = true;
            unwatch?.();
            unwatch = undefined;
            if ("error" in d) setError(d.message || d.error);
            poll();
          },
        );
        if (dead || ended) off();
        else unwatch = off;
      } catch (e) {
        if (dead) return;
        setError(message(e));
        poll();
      }
    };
    if (canWatch) void watch();
    else poll();
    return () => {
      dead = true;
      readNow.current = undefined;
      if (timer) clearInterval(timer);
      unwatch?.();
    };
  }, [rpc, paneId, enabled, active, format, refreshMs, watchMs, lines, canWatch]);

  const refresh = useCallback(() => readNow.current?.(), []);
  return { text, error, refresh };
}
