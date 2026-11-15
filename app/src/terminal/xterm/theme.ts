/**
 * The xterm.js theme of the terminal page, from the design tokens: the terminal colors and the 16
 * ANSI colors of the app theme or of the terminal theme ("Paper"). Pure.
 */
import type { SearchDecorations, XtermTheme } from "./bridge";

const NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

/** The token colors that the terminal uses. */
export type TerminalColors = {
  terminal: { bg: string; fg: string };
  ansi: readonly string[];
  search: { matchBg: string; matchFg: string; currentBg: string; currentFg: string };
};

export function xtermTheme(c: TerminalColors): XtermTheme {
  const t: XtermTheme = {
    background: c.terminal.bg,
    foreground: c.terminal.fg,
    cursor: c.terminal.fg,
    cursorAccent: c.terminal.bg,
    selectionBackground: c.search.matchBg,
    selectionForeground: c.search.matchFg,
  };
  NAMES.forEach((n, i) => {
    const color = c.ansi[i];
    if (color) t[n] = color;
  });
  return t;
}

/** The search match colors: the current match is the selected state (gold), the others dim gold. */
export function searchDecorations(c: TerminalColors): SearchDecorations {
  return {
    matchBackground: c.search.matchBg,
    matchOverviewRuler: c.search.matchBg,
    activeMatchBackground: c.search.currentBg,
    activeMatchColorOverviewRuler: c.search.currentBg,
  };
}
