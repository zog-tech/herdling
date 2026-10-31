import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { excerpt, findMatches, itemText, SEARCH_DEBOUNCE_MS, SEARCH_ITEM_CAP, step, type Excerpt } from "./search";
import { newMarks } from "./searchMarks";
import type { Thread } from "./useThread";

/** `value`, `ms` after its last change. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export type ThreadSearch = {
  /** The debounced query. */
  term: string;
  count: number;
  /** Index of the current match in `matches` (oldest first), -1 for none. */
  index: number;
  /** The item to scroll to. */
  currentId?: string;
  excerpt?: Excerpt;
  note?: string;
  /** True while older pages load for the search. */
  seeking: boolean;
  /** True when "Search older messages" can load more. */
  canSeek: boolean;
  older: () => void;
  newer: () => void;
  /** The store the thread rows read their marks from. */
  marks: ReturnType<typeof newMarks>;
};

/**
 * Search in the loaded thread items. A new query starts at the newest match. "Older" past the
 * oldest loaded match loads older pages until it finds one, up to `SEARCH_ITEM_CAP` items.
 */
export function useThreadSearch(thread: Thread, open: boolean, query: string): ThreadSearch {
  const term = useDebounced(open ? query : "", SEARCH_DEBOUNCE_MS);
  const { items, hasOlder, loadingOlder, loadOlder } = thread;
  const matches = useMemo(() => (open ? findMatches(items, term) : []), [open, items, term]);
  const [currentId, setCurrentId] = useState<string>();
  /** Set while older pages load: the oldest match when the search started (undefined: none). */
  const [seek, setSeek] = useState<{ from?: string }>();
  const [note, setNote] = useState<string>();
  const [marks] = useState(newMarks);
  const latest = useRef(matches);
  latest.current = matches;

  // A new query: start at the newest match.
  useEffect(() => {
    const m = latest.current;
    setCurrentId(m.length > 0 ? m[m.length - 1] : undefined);
    setSeek(undefined);
    setNote(undefined);
  }, [term, open]);

  const index = currentId ? matches.indexOf(currentId) : -1;
  // The current item is gone (or there was none and matches came): the newest match.
  useEffect(() => {
    if (index < 0 && matches.length > 0 && !seek) setCurrentId(matches[matches.length - 1]);
  }, [index, matches, seek]);

  useEffect(() => {
    marks.setState({ ids: new Set(matches), current: index >= 0 ? currentId : undefined });
  }, [marks, matches, currentId, index]);

  // Load older pages until an older match shows, the history ends, or the cap is reached.
  useEffect(() => {
    if (!seek) return;
    const at = seek.from ? matches.indexOf(seek.from) : matches.length;
    if (at > 0) {
      setCurrentId(matches[at - 1]);
      setSeek(undefined);
      return;
    }
    if (!hasOlder || items.length >= SEARCH_ITEM_CAP) {
      setSeek(undefined);
      setNote(hasOlder ? `No older match in the last ${items.length} messages.` : "No older match. This is the start of the conversation.");
      return;
    }
    if (!loadingOlder) loadOlder();
  }, [seek, matches, hasOlder, loadingOlder, loadOlder, items.length]);

  const canSeek = open && !!term.trim() && hasOlder && items.length < SEARCH_ITEM_CAP;

  const older = useCallback(() => {
    setNote(undefined);
    const m = latest.current;
    const i = currentId ? m.indexOf(currentId) : -1;
    if (i > 0) setCurrentId(m[i - 1]);
    else if (canSeek) setSeek({ from: m[0] });
    else if (m.length > 0) setCurrentId(m[step(i, m.length, -1)]);
  }, [currentId, canSeek]);

  const newer = useCallback(() => {
    setNote(undefined);
    const m = latest.current;
    if (m.length === 0) return;
    const i = currentId ? m.indexOf(currentId) : -1;
    setCurrentId(m[step(i, m.length, 1)]);
  }, [currentId]);

  const current = index >= 0 ? items.find((it) => it.id === currentId) : undefined;
  const ex = useMemo(() => (current ? excerpt(itemText(current), term) : undefined), [current, term]);

  return {
    term,
    count: matches.length,
    index,
    currentId: index >= 0 ? currentId : undefined,
    excerpt: ex,
    note,
    seeking: !!seek,
    canSeek,
    older,
    newer,
    marks,
  };
}
