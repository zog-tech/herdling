/**
 * Live text for the pane thumbnails of a space screen: the I/O shell of `thumbPoll.ts`. It reads
 * the visible screen of each shown pane (`pane.read`), at most `MAX_THUMBS` panes, every few seconds,
 * and only while `active`.
 */
import { useEffect, useRef, useState } from "react";

import { getHostConn } from "@/hosts/connection";

import { MAX_THUMBS } from "./spaces";
import { initialThumbs, thumbReducer, type ThumbEffect, type ThumbEvent, type ThumbState } from "./thumbPoll";

export function useThumbnails(hostId: string, paneIds: string[], active: boolean): Record<string, string> {
  const state = useRef<ThumbState>(initialThumbs);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const key = paneIds.slice(0, MAX_THUMBS).join("\n");

  useEffect(() => {
    let dead = false;
    const send = (e: ThumbEvent) => {
      if (dead && e.type !== "hide") return;
      const r = thumbReducer(state.current, e);
      const changed = r.state.texts !== state.current.texts;
      state.current = r.state;
      if (changed) setTexts(r.state.texts);
      r.effects.forEach(run);
    };
    const run = (fx: ThumbEffect) => {
      switch (fx.type) {
        case "cancel":
          clearTimeout(timer.current);
          return;
        case "schedule":
          clearTimeout(timer.current);
          timer.current = setTimeout(() => send({ type: "tick", gen: fx.gen }), fx.ms);
          return;
        case "read": {
          const { rpc } = getHostConn(hostId);
          if (!rpc) return;
          for (const paneId of fx.panes) {
            rpc
              .call<{ read?: { text?: string } }>("herdr.call", { method: "pane.read", params: { pane_id: paneId, source: "visible", format: "text" } })
              .then((r) => send({ type: "result", gen: fx.gen, paneId, text: r.read?.text ?? "" }))
              // A failed read keeps the last text; the next tick tries again.
              .catch(() => {});
          }
        }
      }
    };
    send(active && key ? { type: "show", panes: key.split("\n") } : { type: "hide" });
    return () => {
      dead = true;
      send({ type: "hide" });
    };
  }, [hostId, key, active]);

  return texts;
}
