import type { ThreadItem } from "@zogssh/protocol";

/**
 * Merges `incoming` into `existing`: an item with a known `id` replaces the old one in place,
 * new items are appended in their incoming order. Returns `existing` itself when `incoming` is empty.
 */
export function mergeItems(existing: ThreadItem[], incoming: ThreadItem[]): ThreadItem[] {
  if (incoming.length === 0) return existing;
  const index = new Map<string, number>();
  existing.forEach((item, i) => index.set(item.id, i));
  const out = existing.slice();
  for (const item of incoming) {
    const at = index.get(item.id);
    if (at === undefined) {
      index.set(item.id, out.length);
      out.push(item);
    } else {
      out[at] = item;
    }
  }
  return out;
}
