/**
 * The messages between the app and the terminal page (`page.ts`), and the pure rules of the raw
 * stream: which `pane.watch` events reach the page (`vtReducer`) and what waits until the page is
 * ready (`outboxReducer`). The page script only runs the messages; the order, generation and size
 * rules are here, so Jest can test them.
 */
import type { PaneWatchVtEvent } from "@herdling/protocol";

/** xterm.js theme colors (`ITheme`): names to `#rrggbb`. */
export type XtermTheme = Record<string, string>;

/** Colors of the search matches (the search addon's `decorations`). */
export type SearchDecorations = {
  matchBackground: string;
  matchOverviewRuler: string;
  activeMatchBackground: string;
  activeMatchColorOverviewRuler: string;
};

/**
 * App → page. `e` (epoch) grows by one on each accepted reset, across streams. The page drops
 * `data` and `resize` of another epoch, so bytes of an old attach never reach a new screen.
 */
export type ToWeb =
  | { type: "reset"; e: number; cols: number; rows: number }
  | { type: "data"; e: number; b64: string }
  | { type: "resize"; e: number; cols: number; rows: number }
  | { type: "theme"; theme: XtermTheme }
  | { type: "font"; size: number }
  | { type: "search"; term: string; dir: "next" | "prev" | "clear"; decorations?: SearchDecorations }
  | { type: "scrollToBottom" }
  | { type: "scrollPages"; n: number };

/** Page → app. */
export type FromWeb =
  | { type: "ready" }
  | { type: "metrics"; cellWidth: number; cellHeight: number; fontSize: number; width: number; height: number }
  | { type: "buffer"; alternate: boolean; atBottom: boolean }
  | { type: "search"; index: number; count: number }
  | { type: "tap" }
  | { type: "text"; text: string }
  | { type: "error"; message: string };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A page message, or null when it is not one of the known shapes. */
export function parseFromWeb(raw: string): FromWeb | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  switch (o.type) {
    case "ready":
    case "tap":
      return { type: o.type };
    case "metrics":
      if (![o.cellWidth, o.cellHeight, o.fontSize, o.width, o.height].every(num)) return null;
      if ((o.cellWidth as number) <= 0 || (o.cellHeight as number) <= 0) return null;
      return {
        type: "metrics",
        cellWidth: o.cellWidth as number,
        cellHeight: o.cellHeight as number,
        fontSize: o.fontSize as number,
        width: o.width as number,
        height: o.height as number,
      };
    case "buffer":
      if (typeof o.alternate !== "boolean" || typeof o.atBottom !== "boolean") return null;
      return { type: "buffer", alternate: o.alternate, atBottom: o.atBottom };
    case "search":
      if (!num(o.index) || !num(o.count)) return null;
      return { type: "search", index: o.index, count: o.count };
    case "text":
      return typeof o.text === "string" ? { type: "text", text: o.text } : null;
    case "error":
      return typeof o.message === "string" ? { type: "error", message: o.message } : null;
    default:
      return null;
  }
}

export const encodeToWeb = (m: ToWeb): string => JSON.stringify(m);

/** The largest base64 text in one message to the page. */
export const MAX_POST_B64 = 256 * 1024;

/** `b64` cut into parts of at most `max` characters, each a whole number of base64 groups. */
export function chunkB64(b64: string, max = MAX_POST_B64): string[] {
  const size = Math.max(4, max - (max % 4));
  if (b64.length <= size) return [b64];
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out;
}

// The raw stream.

/** `gen` and `seq` of the current attach (null before its reset), and the page epoch. */
export type VtState = { gen: number | null; seq: number; epoch: number };

export const VT_START: VtState = { gen: null, seq: 0, epoch: 0 };

/** A new `pane.watch` stream: its generations start again at 1; the epoch keeps growing. */
export const vtNewStream = (s: VtState): VtState => ({ gen: null, seq: 0, epoch: s.epoch });

export type VtStep = {
  state: VtState;
  out: ToWeb[];
  /** A gap in `seq`: the app must start the watch again. */
  restart: boolean;
  /** The stream ended (`error` or `closed`). */
  end?: { error?: string; message?: string };
};

/** One `pane.watch` `vt` event. */
export function vtReducer(s: VtState, ev: PaneWatchVtEvent): VtStep {
  const keep: VtStep = { state: s, out: [], restart: false };
  if ("error" in ev) return { ...keep, end: { error: ev.error, message: ev.message } };
  if ("closed" in ev) return { ...keep, end: {} };
  if (ev.vt === "reset") {
    if (s.gen !== null && ev.gen <= s.gen) return keep;
    const epoch = s.epoch + 1;
    return {
      state: { gen: ev.gen, seq: ev.seq, epoch },
      out: [{ type: "reset", e: epoch, cols: ev.cols, rows: ev.rows }],
      restart: false,
    };
  }
  // Bytes of another attempt, or before the first reset: no emulator for them.
  if (s.gen === null || ev.gen !== s.gen) return keep;
  if (ev.seq !== s.seq + 1) return { ...keep, restart: true };
  const state = { ...s, seq: ev.seq };
  if (ev.vt === "resize") return { state, out: [{ type: "resize", e: s.epoch, cols: ev.cols, rows: ev.rows }], restart: false };
  return { state, out: chunkB64(ev.data).map((b64) => ({ type: "data", e: s.epoch, b64 })), restart: false };
}

// The outbox: messages wait until the page is ready.

/** The most base64 text that waits for the page. More: the outbox drops it and asks for a new stream. */
export const MAX_OUTBOX_B64 = 4 * 1024 * 1024;

export type Outbox = { ready: boolean; queue: ToWeb[]; b64: number; overflow: boolean };

export const OUTBOX_START: Outbox = { ready: false, queue: [], b64: 0, overflow: false };

export type OutboxEvent = { type: "send"; msg: ToWeb } | { type: "ready" } | { type: "unload" };

export type OutboxStep = {
  box: Outbox;
  /** Strings for `postMessage`, in order. */
  post: string[];
  /** The page lost bytes: the app must start the watch again. */
  restart: boolean;
};

const isStream = (m: ToWeb) => m.type === "reset" || m.type === "data" || m.type === "resize";

/**
 * Before `ready`, a reset drops the stream messages before it, a theme or font replaces the one
 * that waits, and scroll and search messages are dropped (the page has no screen yet). `unload`
 * (the page reloaded) empties the outbox and asks for a new stream.
 */
export function outboxReducer(box: Outbox, ev: OutboxEvent): OutboxStep {
  switch (ev.type) {
    case "unload":
      return { box: OUTBOX_START, post: [], restart: true };
    case "ready":
      return {
        box: { ready: true, queue: [], b64: 0, overflow: false },
        post: box.overflow ? [] : box.queue.map(encodeToWeb),
        restart: box.overflow,
      };
    case "send": {
      const m = ev.msg;
      if (box.ready) return { box, post: [encodeToWeb(m)], restart: false };
      if (m.type === "reset") {
        const queue = [...box.queue.filter((q) => !isStream(q)), m];
        return { box: { ready: false, queue, b64: 0, overflow: false }, post: [], restart: false };
      }
      if (m.type === "data" || m.type === "resize") {
        if (box.overflow) return { box, post: [], restart: false };
        const b64 = box.b64 + (m.type === "data" ? m.b64.length : 0);
        if (b64 > MAX_OUTBOX_B64) {
          const queue = box.queue.filter((q) => !isStream(q));
          return { box: { ready: false, queue, b64: 0, overflow: true }, post: [], restart: false };
        }
        return { box: { ...box, queue: [...box.queue, m], b64 }, post: [], restart: false };
      }
      if (m.type === "theme" || m.type === "font") {
        const queue = [...box.queue.filter((q) => q.type !== m.type), m];
        return { box: { ...box, queue }, post: [], restart: false };
      }
      return { box, post: [], restart: false };
    }
  }
}
