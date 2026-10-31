import type { Line, Span } from "./ansi";

/** Search in the terminal text: the matches per line, and the lines with the matches marked. Pure. */

export type TermMatch = { line: number; start: number; end: number };

/** Every match of `query` (any case) in the lines, top to bottom. Matches do not overlap. */
export function findInLines(lines: readonly Line[], query: string): TermMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: TermMatch[] = [];
  lines.forEach((line, i) => {
    const text = line.map((s) => s.text).join("").toLowerCase();
    let from = 0;
    for (;;) {
      const at = text.indexOf(q, from);
      if (at < 0) break;
      out.push({ line: i, start: at, end: at + q.length });
      from = at + q.length;
    }
  });
  return out;
}

export type MarkStyle = { fg: string; bg: string };

/**
 * The lines with each match drawn in `other` and the current match in `current`. Only lines with a
 * match are new arrays; the other lines stay the same objects.
 */
export function markLines(
  lines: readonly Line[],
  matches: readonly TermMatch[],
  currentIndex: number,
  styles: { current: MarkStyle; other: MarkStyle },
): Line[] {
  if (matches.length === 0) return lines as Line[];
  const byLine = new Map<number, { start: number; end: number; current: boolean }[]>();
  matches.forEach((m, i) => {
    const list = byLine.get(m.line) ?? [];
    list.push({ start: m.start, end: m.end, current: i === currentIndex });
    byLine.set(m.line, list);
  });
  return lines.map((line, i) => {
    const marks = byLine.get(i);
    if (!marks) return line;
    const out: Span[] = [];
    let off = 0;
    for (const span of line) {
      const sStart = off;
      const sEnd = off + span.text.length;
      off = sEnd;
      let pos = sStart;
      for (const m of marks) {
        if (m.end <= pos || m.start >= sEnd) continue;
        const a = Math.max(m.start, pos);
        const b = Math.min(m.end, sEnd);
        if (a > pos) out.push({ ...span, text: span.text.slice(pos - sStart, a - sStart) });
        const st = m.current ? styles.current : styles.other;
        out.push({ ...span, text: span.text.slice(a - sStart, b - sStart), fg: st.fg, bg: st.bg, inverse: false, dim: false });
        pos = b;
      }
      if (pos < sEnd) out.push({ ...span, text: span.text.slice(pos - sStart) });
    }
    return out;
  });
}
