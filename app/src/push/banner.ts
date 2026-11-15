/**
 * The in-app banner: a short note at the top of the screen when another agent needs you or
 * finishes while the app is open. Two sources feed it: status changes in the live snapshots of the
 * computers, and pushes that arrive while the app is in front (these also bring the "command
 * finished" of a shell). The rules are pure: which change makes a banner, and a queue with one
 * banner at a time, a timer per banner (with a generation number) and no repeat of the same
 * banner within `DEDUPE_MS`.
 */
import type { Snapshot } from "@/herdr/snapshot";
import { agentKind, agentTitle } from "@/herdr/names";

export type BannerKind = "blocked" | "done" | "shell";

export type BannerItem = {
  /** `hostId:paneId:kind`: the same banner from the snapshot and from a push is shown once. */
  key: string;
  hostId: string;
  paneId: string;
  kind: BannerKind;
  title: string;
  detail: string;
};

/** How long one banner stays. */
export const BANNER_MS = 5_000;
/** The same key within this time shows once. */
export const DEDUPE_MS = 30_000;
/** The most banners that wait. Older ones go away. */
export const QUEUE_CAP = 3;

export const bannerKey = (hostId: string, paneId: string, kind: BannerKind) => `${hostId}:${paneId}:${kind}`;

const word = (k: BannerKind) => (k === "blocked" ? "needs you" : "finished");

/**
 * The banners for a new snapshot of one computer. An agent that goes to `blocked` needs you; an
 * agent that goes from `working` to `idle` or `done` finished. The first snapshot of a computer
 * (`prev` missing) gives none: that is the state at the start, not a change.
 */
export function bannerItems(hostId: string, hostName: string, prev: Snapshot | undefined, next: Snapshot): BannerItem[] {
  if (!prev) return [];
  const before = new Map(prev.agents.map((a) => [a.pane_id, a.agent_status]));
  const out: BannerItem[] = [];
  for (const a of next.agents) {
    const was = before.get(a.pane_id);
    if (was === undefined || was === a.agent_status) continue;
    const kind: BannerKind | null =
      a.agent_status === "blocked" ? "blocked" : was === "working" && (a.agent_status === "idle" || a.agent_status === "done") ? "done" : null;
    if (!kind) continue;
    out.push({
      key: bannerKey(hostId, a.pane_id, kind),
      hostId,
      paneId: a.pane_id,
      kind,
      title: `${agentTitle(next, a)} ${word(kind)}`,
      detail: `${hostName} · ${agentKind(a)}`,
    });
  }
  return out;
}

/** The banner of a push that arrived while the app is in front. Null for data of another shape. */
export function bannerFromPush(data: unknown, title: string | null | undefined, body: string | null | undefined): BannerItem | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { hostId?: unknown; paneId?: unknown; kind?: unknown };
  if (typeof d.hostId !== "string" || typeof d.paneId !== "string" || !d.hostId || !d.paneId) return null;
  const t = title ?? "";
  const kind: BannerKind = d.kind === "shell" ? "shell" : /needs you$/i.test(t) ? "blocked" : "done";
  return { key: bannerKey(d.hostId, d.paneId, kind), hostId: d.hostId, paneId: d.paneId, kind, title: t || "An agent finished", detail: body ?? "" };
}

export type BannerState = {
  current?: BannerItem & { gen: number };
  queue: BannerItem[];
  /** Key → the time it was last shown or queued. */
  recent: Record<string, number>;
  gen: number;
};

export const BANNER_START: BannerState = { queue: [], recent: {}, gen: 0 };

export type BannerEvent =
  /** New items. `allowed` filters each one at arrival (the open session, the notification prefs). */
  | { type: "arrive"; items: BannerItem[]; now: number; allowed: (i: BannerItem) => boolean }
  /** The user closed the banner, or tapped it. */
  | { type: "dismiss"; gen: number }
  /** The timer of the banner `gen` ran out. */
  | { type: "timeout"; gen: number }
  /** The user opened this pane: its waiting banners go away. */
  | { type: "opened"; hostId: string; paneId: string };

export type BannerEffect = { type: "timer"; gen: number; ms: number } | { type: "haptic" };

/** Shows the next banner of the queue, if there is one. */
function next(s: BannerState): { state: BannerState; effects: BannerEffect[] } {
  const [head, ...rest] = s.queue;
  if (!head) return { state: { ...s, current: undefined }, effects: [] };
  const gen = s.gen + 1;
  return { state: { ...s, current: { ...head, gen }, queue: rest, gen }, effects: [{ type: "timer", gen, ms: BANNER_MS }, { type: "haptic" }] };
}

export function bannerReducer(s: BannerState, e: BannerEvent): { state: BannerState; effects: BannerEffect[] } {
  switch (e.type) {
    case "arrive": {
      const recent: Record<string, number> = {};
      for (const [k, at] of Object.entries(s.recent)) if (e.now - at < DEDUPE_MS) recent[k] = at;
      const queue = [...s.queue];
      for (const it of e.items) {
        if (recent[it.key] !== undefined || !e.allowed(it)) continue;
        recent[it.key] = e.now;
        // A newer banner of the same pane replaces the waiting one.
        const old = queue.findIndex((q) => q.hostId === it.hostId && q.paneId === it.paneId);
        if (old >= 0) queue.splice(old, 1);
        queue.push(it);
      }
      const state = { ...s, recent, queue: queue.slice(-QUEUE_CAP) };
      return state.current ? { state, effects: [] } : next(state);
    }
    case "dismiss":
    case "timeout":
      return s.current?.gen === e.gen ? next(s) : { state: s, effects: [] };
    case "opened": {
      const queue = s.queue.filter((q) => !(q.hostId === e.hostId && q.paneId === e.paneId));
      const state = { ...s, queue };
      if (s.current && s.current.hostId === e.hostId && s.current.paneId === e.paneId) return next(state);
      return { state: queue.length === s.queue.length ? s : state, effects: [] };
    }
  }
}
