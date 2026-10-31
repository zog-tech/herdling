import type { Line } from "./ansi";

/** JetBrains Mono: one character is this wide, as a part of the font size. */
export const MONO_ADVANCE = 0.6;
/** Smallest font size for the fit mode, in points. */
export const FIT_MIN_SIZE = 7;
/** Line height at the normal size is this many points per point of font size (17 at 12 pt). */
export const LINE_RATIO = 17 / 12;

/** How the terminal text meets the view width. */
export type WidthMode = "fit" | "wrap" | "scroll";

/** The mode after this one, in the order fit, wrap, scroll. */
export function nextWidthMode(mode: WidthMode): WidthMode {
  return mode === "fit" ? "wrap" : mode === "wrap" ? "scroll" : "fit";
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
