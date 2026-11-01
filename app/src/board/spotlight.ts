import type { BoardItem } from "./buckets";

/**
 * The rules of the Dashboard top of the Board: which agents get a large tile, the tile size, and
 * the summary of the computers button. Pure functions.
 */

/** At most this many tiles for agents that want attention. */
export const SPOTLIGHT_MAX = 8;
/** At most this many tiles for recent idle agents, when no agent wants attention. */
export const RECENT_MAX = 4;

export type Spotlight = {
  /** "highlights": agents that need you, work or have an unread reply. "recent": recent idle agents. */
  kind: "highlights" | "recent";
  items: BoardItem[];
};

/**
 * The agents of the carousel: needs you, then working, then ready (unread reply), then background
 * work, at most 8. Each bucket keeps the given order. With none of them, the idle agents with the
 * newest status change first, at most 4, so a new user sees large agents to tap.
 */
export function spotlight(items: BoardItem[]): Spotlight {
  const hot = [
    ...items.filter((i) => i.bucket === "needs_you"),
    ...items.filter((i) => i.bucket === "working"),
    ...items.filter((i) => i.bucket === "ready"),
    ...items.filter((i) => i.bucket === "background"),
  ];
  if (hot.length > 0) return { kind: "highlights", items: hot.slice(0, SPOTLIGHT_MAX) };
  const idle = items
    .filter((i) => i.bucket === "idle")
    .sort((a, b) => (b.since ?? -1) - (a.since ?? -1) || b.agent.state_change_seq - a.agent.state_change_seq);
  return { kind: "recent", items: idle.slice(0, RECENT_MAX) };
}

/** The section label above the carousel. */
export const spotlightLabel = (kind: Spotlight["kind"]) => (kind === "highlights" ? "Highlights" : "Recent");

/** Tile width: 78 % of the room, at most 340 pt, so the next tile shows at the right edge. */
export const TILE_MAX = 340;
export function tileWidth(room: number): number {
  return Math.min(TILE_MAX, Math.round(room * 0.78));
}

/** At most this many host circles in the computers button. */
export const HOST_BADGES_MAX = 3;

export type HostBadge = { id: string; letter: string; online: boolean };

/**
 * The circles of the computers button: the first letter of each host and its online state, at most
 * 3, and the number of hosts that do not fit ("+2"). Online hosts come first; else the saved order.
 */
export function hostBadges(
  hosts: readonly { id: string; name: string }[],
  online: ReadonlySet<string>,
): { badges: HostBadge[]; more: number; online: number; label: string } {
  const all = hosts.map((h) => ({ id: h.id, letter: (h.name.trim()[0] ?? "?").toUpperCase(), online: online.has(h.id) }));
  const sorted = [...all.filter((b) => b.online), ...all.filter((b) => !b.online)];
  const on = sorted.filter((b) => b.online).length;
  const label =
    hosts.length === 0 ? "Computers, none added" : `Computers, ${on} of ${hosts.length} online`;
  return { badges: sorted.slice(0, HOST_BADGES_MAX), more: Math.max(0, all.length - HOST_BADGES_MAX), online: on, label };
}
