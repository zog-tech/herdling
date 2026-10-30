import { createContext } from "react";

/** Only this many of the newest rows can animate in at once; more means a page loaded. */
const MAX_NEW = 3;

/**
 * Decides which thread rows animate in: only items that arrive while the user is at the bottom.
 * The first page, older pages and rows the list mounts again on scroll do not animate.
 * A plain object, not React state: rows read it once when they mount.
 */
export class Arrivals {
  private known = new Set<string>();
  private ready = false;
  /** The user is at the newest item (set by the list's scroll handler). */
  atBottom = true;

  /** The list committed these items. */
  commit(ids: readonly string[]) {
    for (const id of ids) this.known.add(id);
    if (ids.length > 0) this.ready = true;
  }

  /** True when the row of `id` at `index` (0 = newest) should animate in as it mounts. */
  claim(id: string, index: number): boolean {
    return this.ready && this.atBottom && index < MAX_NEW && !this.known.has(id);
  }
}

export const ArrivalsContext = createContext<Arrivals | null>(null);
