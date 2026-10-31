import type { ThreadItem } from "@herdling/protocol";

/**
 * Search in the thread: the text of each item, the items that match a query, and a short excerpt
 * around the match. Pure and cached per item object, so a new keystroke does not read every item again.
 */

/** Wait after the last keystroke before the search runs. */
export const SEARCH_DEBOUNCE_MS = 200;
/** "Search older messages" loads pages until the thread holds this many items. */
export const SEARCH_ITEM_CAP = 2000;
/** Chars of context on each side of the match in the excerpt. */
const EXCERPT_CONTEXT = 36;

/** The searchable text of an item: what the row shows, plus the tool output. */
export function itemText(item: ThreadItem): string {
  switch (item.kind) {
    case "user":
      return item.text;
    case "assistant":
      return item.markdown;
    case "thinking":
      return item.text ?? "";
    case "tool":
      return [item.name, item.input_summary, item.result?.text ?? ""].join("\n");
    case "subagent":
      return [item.description, item.result_summary ?? "", item.activity ?? ""].join("\n");
    case "system":
      return item.text;
    default:
      return "";
  }
}

const lowered = new WeakMap<ThreadItem, string>();

function lowerText(item: ThreadItem): string {
  let t = lowered.get(item);
  if (t === undefined) {
    t = itemText(item).toLowerCase();
    lowered.set(item, t);
  }
  return t;
}

/** The query as the search uses it: trimmed and in lower case. Empty means no search. */
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

/** Ids of the items that contain `query` (any case), oldest first. */
export function findMatches(items: readonly ThreadItem[], query: string): string[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const out: string[] = [];
  for (const item of items) if (lowerText(item).includes(q)) out.push(item.id);
  return out;
}

export type Excerpt = { before: string; match: string; after: string };

/** The first match of `query` in `text` with some context, on one line. */
export function excerpt(text: string, query: string): Excerpt | undefined {
  const q = normalizeQuery(query);
  if (!q) return undefined;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return undefined;
  const flat = (s: string) => s.replace(/\s+/g, " ");
  const start = Math.max(0, i - EXCERPT_CONTEXT);
  const end = Math.min(text.length, i + q.length + EXCERPT_CONTEXT);
  return {
    before: (start > 0 ? "…" : "") + flat(text.slice(start, i)).trimStart(),
    match: flat(text.slice(i, i + q.length)),
    after: flat(text.slice(i + q.length, end)).trimEnd() + (end < text.length ? "…" : ""),
  };
}

/**
 * The next current match after a step. `dir` -1 goes to an older match, +1 to a newer one; the
 * steps wrap. No current match starts at the newest.
 */
export function step(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return count - 1;
  return (current + dir + count) % count;
}

/** "3 of 12", "No matches", or empty before a query. */
export function countLabel(index: number, count: number, query: string): string {
  if (!normalizeQuery(query)) return "";
  if (count === 0) return "No matches";
  return `${index + 1} of ${count}`;
}
