import type { AgentPreview } from "@herdling/protocol";

import { BUCKET_LABEL, type BoardItem, type PreviewEntry } from "./buckets";
import { backgroundText } from "./background";

/**
 * The text of a Dashboard tile: the title, the status time, the folder line and the main text.
 * Pure functions, so the priority rule has tests and the tile only draws.
 */

/** The main text of a tile with no preview text to show. */
export const TILE_EMPTY = "No reply yet";

/** What the main text shows. `question` takes the attention color; `empty` is quiet. */
export type TileMainKind = "question" | "activity" | "reply" | "background" | "empty";
export type TileMain = { kind: TileMainKind; text: string };

const nonEmpty = (s: string | null | undefined): string | undefined => (s && s.trim() ? s.trim() : undefined);

/**
 * The main text of a tile, one item by priority:
 * 1. The question, when the agent needs you.
 * 2. The activity, while the agent works.
 * 3. The last reply.
 * 4. For a background agent, the first background command (else the count of background work).
 * 5. Else `TILE_EMPTY`.
 */
export function tileMain(bucket: BoardItem["bucket"], p: AgentPreview | undefined): TileMain {
  const question = bucket === "needs_you" ? nonEmpty(p?.question) : undefined;
  if (question) return { kind: "question", text: question };
  const activity = bucket === "working" ? nonEmpty(p?.activity) : undefined;
  if (activity) return { kind: "activity", text: activity };
  const reply = nonEmpty(p?.last_reply);
  if (reply) return { kind: "reply", text: reply };
  if (bucket === "background") {
    const command = (p?.background?.commands ?? []).map(nonEmpty).find((c) => c !== undefined);
    const text = command ?? backgroundText(p?.background);
    if (text) return { kind: "background", text };
  }
  return { kind: "empty", text: TILE_EMPTY };
}

/**
 * The preview that describes the agent now, or undefined. A preview fetched while the agent had
 * another status describes the old state (the same rule as `mergeBoard`).
 */
export function currentPreview(item: Pick<BoardItem, "agent">, entry: PreviewEntry | undefined): PreviewEntry | undefined {
  return entry && entry.status === item.agent.agent_status ? entry : undefined;
}

/** The tile title: the agent's own name, else the terminal title, else the Board title. */
export function tileTitle(item: Pick<BoardItem, "agent" | "title">): string {
  return nonEmpty(item.agent.name) ?? nonEmpty(item.agent.terminal_title_stripped) ?? item.title;
}

/** The last part of a folder path: `/home/sam/proj/` gives `proj`. The root folder gives `/`. */
export function folderName(cwd: string | undefined): string | undefined {
  const path = nonEmpty(cwd);
  if (!path) return undefined;
  const parts = path.split("/").filter((s) => s.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : "/";
}

/** The second line: the folder, then the computer name when more than one computer is connected. */
export function tilePlace(item: Pick<BoardItem, "agent" | "hostName">, multiHost: boolean): string | undefined {
  const parts = [folderName(item.agent.cwd), multiHost ? nonEmpty(item.hostName) : undefined].filter((s) => s !== undefined);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** A compact elapsed time for the status line: `"<1m"`, `"4m"`, `"2h 5m"`, `"3h"`. */
export function compactElapsed(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/**
 * True when the tile shows the status time. Working and needs you: always when the start is known.
 * Other buckets: only when the host gave the time, because the app's own first sighting of an idle
 * agent is the app launch, not the last activity.
 */
export function showsTime(item: Pick<BoardItem, "bucket" | "since" | "sinceKnown">): boolean {
  if (item.since === undefined) return false;
  return item.bucket === "working" || item.bucket === "needs_you" || !!item.sinceKnown;
}

/** The status word and its time: `"Working · 4m"`. With no time: `"Working"`. */
export function statusLine(bucket: BoardItem["bucket"], elapsedS: number | undefined): string {
  return elapsedS === undefined ? BUCKET_LABEL[bucket] : `${BUCKET_LABEL[bucket]} · ${compactElapsed(elapsedS)}`;
}

/** What VoiceOver reads for a tile: title, status, folder line, main text, unread. */
export function tileLabel(title: string, status: string, place: string | undefined, main: TileMain, bucket: BoardItem["bucket"]): string {
  const parts = [title, status];
  if (place) parts.push(place);
  parts.push(main.text);
  if (bucket === "ready") parts.push("unread");
  return parts.join(", ");
}
