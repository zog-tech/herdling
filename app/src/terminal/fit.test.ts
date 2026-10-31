import type { Line } from "./ansi";
import {
  FIT_MIN_SIZE,
  fitFontSize,
  lineHeightFor,
  nextWidthMode,
  widestCols,
} from "./fit";

const line = (...texts: string[]): Line =>
  texts.map((text) => ({ text }) as Line[number]);

describe("widestCols", () => {
  it("is 0 for no lines", () => expect(widestCols([])).toBe(0));
  it("trims spaces at the end", () =>
    expect(widestCols([line("abc     ")])).toBe(3));
  it("keeps spaces inside and at the start", () =>
    expect(widestCols([line("  a b  ")])).toBe(5));
  it("joins spans", () => expect(widestCols([line("ab", "cd  ")])).toBe(4));
  it("counts code points, not UTF-16 units", () =>
    expect(widestCols([line("a😀b")])).toBe(3));
  it("takes the widest line", () =>
    expect(widestCols([line("ab"), line("abcde  "), line("abc")])).toBe(5));
});

describe("fitFontSize", () => {
  it("uses the normal size when the text already fits", () =>
    expect(fitFontSize(20, 400, 12)).toBe(12));
  it("shrinks for a wide screen", () => {
    // 100 cols in 300 pt: 300 / 60 = 5 -> clamped up to the minimum.
    expect(fitFontSize(100, 300, 12)).toBe(FIT_MIN_SIZE);
    // 50 cols in 300 pt: 300 / 30 = 10.
    expect(fitFontSize(50, 300, 12)).toBe(10);
  });
  it("clamps at the minimum", () =>
    expect(fitFontSize(500, 300, 12)).toBe(FIT_MIN_SIZE));
  it("rounds down so the text never overflows", () => {
    const size = fitFontSize(53, 300, 12);
    expect(size * 0.6 * 53).toBeLessThanOrEqual(300);
  });
  it("is stable for the same column count", () => {
    expect(fitFontSize(80, 361, 12)).toBe(fitFontSize(80, 361, 12));
  });
  it("falls back to the normal size without data", () => {
    expect(fitFontSize(0, 300, 12)).toBe(12);
    expect(fitFontSize(80, 0, 12)).toBe(12);
  });
});

describe("lineHeightFor", () => {
  it("is 17 at 12 pt", () => expect(lineHeightFor(12)).toBe(17));
  it("scales down", () => expect(lineHeightFor(7)).toBe(10));
});

describe("nextWidthMode", () => {
  it("cycles", () => {
    expect(nextWidthMode("fit")).toBe("wrap");
    expect(nextWidthMode("wrap")).toBe("scroll");
    expect(nextWidthMode("scroll")).toBe("fit");
  });
});
