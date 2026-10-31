/**
 * Local echo: the terminal shows a sent line at once, dimmed, before the computer echoes it.
 * Pure functions on parsed screen lines, so the rules have tests.
 */
import type { Line, Span } from "./ansi";

/** A sent line that the screen does not show yet. `base` is the plain screen at send time. */
export type Echo = { id: number; text: string; at: number; base: string };

/** An echo goes away after this time, also when the screen never shows the text. */
export const ECHO_TIMEOUT_MS = 2_000;

const lineText = (line: Line) => line.map((s) => s.text).join("");

/** The screen as plain text, one line per row. */
export function plainText(lines: readonly Line[]): string {
  return lines.map(lineText).join("\n");
}

/** Index of the last line with visible text, or -1. */
function lastFilled(lines: readonly Line[]): number {
  for (let i = lines.length - 1; i >= 0; i--) if (lineText(lines[i]).trim()) return i;
  return -1;
}

/** The last line with visible text, as plain text ("" when there is none). */
export function lastFilledLine(lines: readonly Line[]): string {
  const i = lastFilled(lines);
  return i < 0 ? "" : lineText(lines[i]);
}

/**
 * The screen with `pending` texts added, dimmed: the first at the end of the last line with
 * text (where the prompt is), each next one on a new line below it. The same array when
 * nothing is pending, so a memoized view does not render again.
 */
export function overlayEcho(lines: Line[], pending: readonly string[], opts?: { underline?: boolean }): Line[] {
  const items = pending.filter((t) => t.length > 0);
  if (items.length === 0) return lines;
  const span = (text: string): Span => (opts?.underline ? { text, dim: true, underline: true } : { text, dim: true });
  const at = lastFilled(lines);
  const out = lines.slice();
  const [first, ...rest] = items;
  const extra = rest.map((t) => [span(t)]);
  if (at < 0) {
    out.push([span(first)], ...extra);
    return out;
  }
  out[at] = [...lines[at], span(first)];
  out.splice(at + 1, 0, ...extra);
  return out;
}

/**
 * The echoes still to show: an echo goes when a newer screen (not the screen at send time)
 * contains its text, or when it is older than `ECHO_TIMEOUT_MS`. The same array when none goes.
 */
export function settleEchoes(echoes: Echo[], screen: string | undefined, now: number): Echo[] {
  if (echoes.length === 0) return echoes;
  const kept = echoes.filter(
    (e) => now - e.at < ECHO_TIMEOUT_MS && !(screen !== undefined && screen !== e.base && screen.includes(e.text)),
  );
  return kept.length === echoes.length ? echoes : kept;
}
