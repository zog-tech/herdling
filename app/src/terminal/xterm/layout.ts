/**
 * Width modes of the xterm.js view, from the cell size that the page measures. Pure.
 *
 * - "phone": the pane takes the grid of the view at the normal font size (`pane.watch` `cols` and
 *   `rows`).
 * - "fit": the pane keeps its grid; the font gets smaller so the columns fit the width and the
 *   rows fit the height.
 * - "scroll": the normal font size (smaller only so the rows fit the height); the page scrolls
 *   sideways.
 * - "wrap": a terminal grid cannot wrap. The view shows it as "fit".
 */
import { FIT_MIN_SIZE, PHONE_COLS, PHONE_ROWS, type WidthMode } from "../fit";

/** The cell width and height per point of font size. */
export type CellRatio = { w: number; h: number };

/** The cell ratio of a page measure, or null when it has no size. */
export function cellRatio(m: { cellWidth: number; cellHeight: number; fontSize: number }): CellRatio | null {
  if (m.fontSize <= 0 || m.cellWidth <= 0 || m.cellHeight <= 0) return null;
  return { w: m.cellWidth / m.fontSize, h: m.cellHeight / m.fontSize };
}

export type XtermLayout = { fontSize: number; drive: { cols: number; rows: number } | null };

const quarter = (n: number) => Math.floor(n * 4) / 4;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The mode that the xterm.js view shows for the saved `mode`. */
export function shownXtermMode(mode: WidthMode, phoneOk: boolean): WidthMode {
  if (mode === "wrap") return "fit";
  if (mode === "phone" && !phoneOk) return "fit";
  return mode;
}

/** The next mode of the width button in the xterm.js view: fit, scroll, then phone when allowed. */
export function nextXtermMode(mode: WidthMode, phone: boolean): WidthMode {
  if (mode === "fit" || mode === "wrap") return "scroll";
  if (mode === "scroll" && phone) return "phone";
  return "fit";
}

export function xtermLayout(i: {
  mode: WidthMode;
  /** The view size in points. */
  width: number;
  height: number;
  ratio: CellRatio | null;
  /** The grid of the pane (from the stream), when known. */
  pane?: { cols: number; rows: number };
  /** The normal font size. */
  base: number;
}): XtermLayout {
  const { ratio, base, width, height } = i;
  if (!ratio || width <= 0 || height <= 0) return { fontSize: base, drive: null };
  if (i.mode === "phone") {
    return {
      fontSize: base,
      drive: {
        cols: clamp(Math.floor(width / (ratio.w * base)), PHONE_COLS.min, PHONE_COLS.max),
        rows: clamp(Math.floor(height / (ratio.h * base)), PHONE_ROWS.min, PHONE_ROWS.max),
      },
    };
  }
  const pane = i.pane;
  if (!pane || pane.cols <= 0 || pane.rows <= 0) return { fontSize: base, drive: null };
  const byHeight = height / (pane.rows * ratio.h);
  const raw = i.mode === "scroll" ? byHeight : Math.min(width / (pane.cols * ratio.w), byHeight);
  return { fontSize: clamp(quarter(raw), FIT_MIN_SIZE, base), drive: null };
}
