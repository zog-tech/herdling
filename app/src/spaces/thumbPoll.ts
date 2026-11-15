/**
 * The thumbnail poll of a space screen: a pure state machine. Only the panes of the selected tab
 * poll, only while the screen shows, at a slow interval. A tab change or a blur starts a new
 * generation, so a late answer of the old tab does not show.
 */

/** How often the thumbnails read their panes. */
export const THUMB_POLL_MS = 6_000;

export type ThumbState =
  | { kind: "idle"; gen: number; texts: Record<string, string> }
  | { kind: "polling"; gen: number; panes: string[]; texts: Record<string, string> };

export type ThumbEvent =
  | { type: "show"; panes: string[] }
  | { type: "hide" }
  | { type: "tick"; gen: number }
  | { type: "result"; gen: number; paneId: string; text: string };

export type ThumbEffect = { type: "read"; gen: number; panes: string[] } | { type: "schedule"; gen: number; ms: number } | { type: "cancel" };

export const initialThumbs: ThumbState = { kind: "idle", gen: 0, texts: {} };

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Keeps only the texts of the given panes. */
function keep(texts: Record<string, string>, panes: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of panes) if (p in texts) out[p] = texts[p];
  return out;
}

export function thumbReducer(state: ThumbState, event: ThumbEvent): { state: ThumbState; effects: ThumbEffect[] } {
  switch (event.type) {
    case "show": {
      if (event.panes.length === 0) return thumbReducer(state, { type: "hide" });
      if (state.kind === "polling" && same(state.panes, event.panes)) return { state, effects: [] };
      const gen = state.gen + 1;
      return {
        state: { kind: "polling", gen, panes: event.panes, texts: keep(state.texts, event.panes) },
        effects: [{ type: "cancel" }, { type: "read", gen, panes: event.panes }, { type: "schedule", gen, ms: THUMB_POLL_MS }],
      };
    }
    case "hide":
      if (state.kind === "idle") return { state, effects: [] };
      return { state: { kind: "idle", gen: state.gen + 1, texts: state.texts }, effects: [{ type: "cancel" }] };
    case "tick":
      if (state.kind !== "polling" || event.gen !== state.gen) return { state, effects: [] };
      return { state, effects: [{ type: "read", gen: state.gen, panes: state.panes }, { type: "schedule", gen: state.gen, ms: THUMB_POLL_MS }] };
    case "result":
      if (state.kind !== "polling" || event.gen !== state.gen || !state.panes.includes(event.paneId)) return { state, effects: [] };
      if (state.texts[event.paneId] === event.text) return { state, effects: [] };
      return { state: { ...state, texts: { ...state.texts, [event.paneId]: event.text } }, effects: [] };
  }
}

/** The last `rows` lines of a screen, with the empty lines at the end removed. */
export function thumbText(screen: string, rows: number): string {
  const lines = screen.replace(/\s+$/, "").split("\n");
  return lines.slice(Math.max(0, lines.length - rows)).join("\n");
}
