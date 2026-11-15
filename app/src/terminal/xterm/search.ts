/**
 * Search in the xterm.js view: which search addon call follows a change of the search box or of
 * the current match. The session screen keeps the current index (-1 or out of range: the last
 * match, as in the classic view); the page moves one match with `findNext` or `findPrevious`.
 */
export type SearchState = { term: string; index: number };

const resolve = (i: number, count: number) => (count === 0 ? -1 : i >= 0 && i < count ? i : count - 1);

/** The call for the change from `prev` to `next` with `count` matches, or null for no call. */
export function searchOp(prev: SearchState | undefined, next: SearchState, count: number): "next" | "prev" | "clear" | null {
  if (!next.term.trim()) return prev && prev.term.trim() ? "clear" : null;
  // A new query starts at the last match, the one nearest the end of the output.
  if (!prev || prev.term !== next.term) return "prev";
  const a = resolve(prev.index, count);
  const b = resolve(next.index, count);
  if (a === b) return null;
  if (a === count - 1 && b === 0) return "next";
  if (a === 0 && b === count - 1) return "prev";
  return b > a ? "next" : "prev";
}
