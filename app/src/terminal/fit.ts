import type { Line } from "./ansi";

/** JetBrains Mono: one character is this wide, as a part of the font size. */
export const MONO_ADVANCE = 0.6;
/** Smallest font size for the fit mode, in points. */
export const FIT_MIN_SIZE = 7;
/** Line height at the normal size is this many points per point of font size (17 at 12 pt). */
export const LINE_RATIO = 17 / 12;

/**
 * How the terminal text meets the view width. "phone": a Herdr 2 pane lays out its output at the
 * grid of this view (`pane.watch` with `cols` and `rows`); the pane on the computer gets that size
 * while the phone watches it.
 */
export type WidthMode = "fit" | "wrap" | "scroll" | "phone";

/** The mode after this one, in the order fit, wrap, scroll, then phone when `phone` is true. */
export function nextWidthMode(mode: WidthMode, phone = false): WidthMode {
  if (mode === "fit") return "wrap";
  if (mode === "wrap") return "scroll";
  if (mode === "scroll" && phone) return "phone";
  return "fit";
}

/** The limits of `pane.watch` `cols` and `rows` (herdlingd clamps to them too). */
export const PHONE_COLS = { min: 20, max: 500 } as const;
export const PHONE_ROWS = { min: 5, max: 200 } as const;

/**
 * The grid of a view for "Phone width": the columns and rows of `fontSize` text that fit in
 * `width` × `height` points. Clamped to the `pane.watch` limits. Null while the view has no size.
 */
export function phoneGrid(width: number, height: number, fontSize: number): { cols: number; rows: number } | null {
  if (width <= 0 || height <= 0 || fontSize <= 0) return null;
  const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v));
  return {
    cols: clamp(Math.floor(width / (fontSize * MONO_ADVANCE)), PHONE_COLS),
    rows: clamp(Math.floor(height / lineHeightFor(fontSize)), PHONE_ROWS),
  };
}

/** Code points in a string. */
const length = (s: string) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/** Columns of the widest line, not counting spaces at the end of a line. */
export function widestCols(lines: Line[]): number {
  let max = 0;
  for (const line of lines) {
    const text = line
      .map((s) => s.text)
      .join("")
      .replace(/ +$/, "");
    const n = length(text);
    if (n > max) max = n;
  }
  return max;
}

/**
 * Font size so that `cols` columns fit in `width` points. Never above `maxSize`, never below
 * `FIT_MIN_SIZE`. Rounded down to a quarter point. The result depends only on the inputs,
 * so it stays the same while the column count stays the same.
 */
export function fitFontSize(
  cols: number,
  width: number,
  maxSize: number,
): number {
  if (cols <= 0 || width <= 0) return maxSize;
  const raw = width / (cols * MONO_ADVANCE);
  const size = Math.floor(raw * 4) / 4;
  return Math.min(maxSize, Math.max(FIT_MIN_SIZE, size));
}

/** Line height for a font size, rounded to a whole point. */
export const lineHeightFor = (fontSize: number) =>
  Math.round(fontSize * LINE_RATIO);
