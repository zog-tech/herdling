import type { PaneWatchResult, PaneWatchVtEvent } from "@herdling/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useHostConn } from "@/hosts/connection";

import { VT_START, vtNewStream, vtReducer, type ToWeb, type VtState } from "./bridge";

/** History lines of the first paint (herdlingd clamps `lines` to 1000). */
const LINES = 1000;
/** The shortest time between two events of the stream on the computer. */
const INTERVAL_MS = 50;
/** Wait before a new watch after the stream ended or failed. */
const RETRY_MS = 2_000;

export type VtPhase = "connecting" | "live" | "unsupported" | "failed";

type Options = {
  /** The phone grid ("Phone width"): the pane takes this size while the stream lives. */
  size?: { cols: number; rows: number };
  /** Gets `drive` of the reply when `size` is set. */
  onDrive?: (drive: boolean) => void;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : undefined);

/**
 * The raw terminal stream of a pane (`pane.watch` with `format: "vt"`) while `enabled` and the app
 * is active. Each accepted event goes to `onMsg` as a page message (`vtReducer` drops stale
 * bytes). A gap, an end of the stream or a failure starts a new watch; the first event of a new
 * watch is a reset, so the page starts from a fresh screen. A host that refuses the format gives
 * the phase "unsupported": the caller shows the classic view.
 */
export function useVtStream(
  hostId: string,
  paneId: string,
  enabled: boolean,
  o: Options,
  onMsg: (m: ToWeb) => void,
): { phase: VtPhase; error?: string; restart: () => void } {
  const { rpc } = useHostConn(hostId);
  const [phase, setPhase] = useState<VtPhase>("connecting");
  const [error, setError] = useState<string>();
  // A new value starts a new watch.
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const vt = useRef<VtState>(VT_START);
  const onMsgRef = useRef(onMsg);
  onMsgRef.current = onMsg;
  const onDrive = useRef(o.onDrive);
  onDrive.current = o.onDrive;
  const cols = o.size?.cols;
  const rows = o.size?.rows;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!rpc || !enabled || !active) return;
    let dead = false;
    let off: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const again = (ms: number) => {
      if (dead || retry) return;
      off?.();
      off = undefined;
      retry = setTimeout(() => {
        if (!dead) setAttempt((n) => n + 1);
      }, ms);
    };
    vt.current = vtNewStream(vt.current);
    setPhase("connecting");
    const start = async () => {
      try {
        const stop = await rpc.stream<PaneWatchVtEvent>(
          "pane.watch",
          { pane_id: paneId, lines: LINES, format: "vt", interval_ms: INTERVAL_MS, ...(cols && rows ? { cols, rows } : {}) },
          (d) => {
            if (dead) return;
            const s = vtReducer(vt.current, d);
            vt.current = s.state;
            s.out.forEach((m) => onMsgRef.current(m));
            if (s.out.some((m) => m.type === "reset")) {
              setPhase("live");
              setError(undefined);
            }
            if (s.restart) return again(0);
            if (s.end) {
              if (s.end.error) {
                setError(s.end.message || s.end.error);
                setPhase("failed");
              }
              again(RETRY_MS);
            }
          },
          (r) => {
            if (!dead && cols && rows) onDrive.current?.((r as PaneWatchResult | null)?.drive === true);
          },
        );
        if (dead) stop();
        else off = stop;
      } catch (e) {
        if (dead) return;
        const c = code(e);
        if (c === "unsupported" || c === "bad_request") {
          setPhase("unsupported");
          return;
        }
        setError(message(e));
        setPhase("failed");
        again(RETRY_MS);
      }
    };
    void start();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      off?.();
    };
  }, [rpc, paneId, enabled, active, cols, rows, attempt]);

  return { phase, error, restart };
}
