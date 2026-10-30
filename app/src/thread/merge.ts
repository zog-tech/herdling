import type { ThreadItem } from "@zogssh/protocol";

/** Deep equality for JSON-like values (what the companion sends). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Merges `incoming` into `existing`: an item with a known `id` replaces the old one in place,
 * new items are appended in their incoming order. An incoming copy equal to the old item keeps
 * the old object, so memoized rows skip it. Returns `existing` itself when nothing changed, so a
 * state update with the result does not re-render. `incomingWins`: an incoming item always replaces.
 */
export function mergeItems(existing: ThreadItem[], incoming: ThreadItem[], incomingWins = false): ThreadItem[] {
  if (incoming.length === 0) return existing;
  const index = new Map<string, number>();
  existing.forEach((item, i) => index.set(item.id, i));
  let out: ThreadItem[] | undefined;
  for (const item of incoming) {
    const at = index.get(item.id);
    if (at === undefined) {
      out ??= existing.slice();
      index.set(item.id, out.length);
      out.push(item);
    } else {
      const cur = (out ?? existing)[at];
      if (cur === item || (!incomingWins && jsonEqual(cur, item))) continue;
      out ??= existing.slice();
      out[at] = item;
    }
  }
  return out ?? existing;
}

/**
 * An older page in front of the loaded items. The loaded copies always win and keep their
 * objects, so the rows already on screen do not re-render.
 */
export function prependOlder(older: ThreadItem[], loaded: ThreadItem[]): ThreadItem[] {
  return mergeItems(older, loaded, true);
}
