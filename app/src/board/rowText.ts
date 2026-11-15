import { timeAgo } from "@/hosts/ConnBadge";

import type { RowStyle } from "./boardPrefs";
import { BUCKET_LABEL, type Bucket, type BoardItem } from "./buckets";
import { helperSummary, sameName } from "./tasks";

/** The muted line of an idle agent with no latest line, in the styles that show where to tap. */
export const IDLE_PLACEHOLDER = "Waiting for your next prompt";

/**
 * The muted placeholder line of a row, or undefined. Only `divided` and `cards` show it, and only
 * for an idle agent with no line: an empty row gives no reason to tap it.
 */
export function placeholderLine(item: Pick<BoardItem, "bucket" | "line" | "terminalTitle">, style: RowStyle): string | undefined {
  if (style === "flat" || item.bucket !== "idle") return undefined;
  return item.line ?? item.terminalTitle ? undefined : IDLE_PLACEHOLDER;
}

/** A short elapsed time in whole minutes: `"Less than 1 min"`, `"4 min"`, `"2 h 5 min"`, `"3 h"`. */
export function shortElapsed(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  if (m < 1) return "Less than 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/**
 * The muted text at the left of a card footer, or undefined (the footer then shows only "Open").
 * - Working: how long it works ("4 min").
 * - Needs you: how long it waits ("Waiting 4 min").
 * - Ready or idle: "Last active 2 h ago". Only when the host gave the time (`sinceKnown`): the
 *   app's own first sighting of an idle agent is the app launch, not the last activity.
 */
export function footerMeta(bucket: Bucket, elapsedS: number | undefined, sinceKnown: boolean): string | undefined {
  if (elapsedS === undefined) return undefined;
  switch (bucket) {
    case "working":
      return shortElapsed(elapsedS);
    case "needs_you":
      return `Waiting ${shortElapsed(elapsedS).toLowerCase()}`;
    default:
      return sinceKnown ? `Last active ${timeAgo(0, elapsedS * 1000)}` : undefined;
  }
}

/** A short age for a row status: "now", "3m", "2h", "4d". */
export function shortAgo(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** The status word of a row with its age: "Working · 3m". With no age, the word only. */
export function statusWithAge(bucket: Bucket, elapsedS: number | undefined): string {
  return elapsedS === undefined ? BUCKET_LABEL[bucket] : `${BUCKET_LABEL[bucket]} · ${shortAgo(elapsedS)}`;
}

/**
 * The title of a card as two parts: the group in bold, then the task name. A card with no group
 * (herdr 1, an older herdlingd) or a task with the name of the group has only the task. A title
 * that starts with the group ("api · tests", the workspace and tab names) keeps only the rest.
 */
export function titleParts(item: Pick<BoardItem, "group" | "title">): { group?: string; task: string } {
  const group = item.group;
  if (!group || sameName(group, item.title)) return { task: item.title };
  const prefix = `${group.trim()} · `;
  const rest = item.title.toLowerCase().startsWith(prefix.toLowerCase()) ? item.title.slice(prefix.length).trim() : item.title;
  return { group, task: rest || item.title };
}

/** The second line of a card: "<computer> · <kind>", then the repo line and the helpers. */
export function cardSubtitle(item: Pick<BoardItem, "subtitle" | "repoLine" | "helpers">): string {
  return [item.subtitle, item.repoLine, helperSummary(item.helpers ?? [])].filter(Boolean).join(" · ");
}
