import { FIT_MIN_SIZE } from "../fit";

import { cellRatio, nextXtermMode, shownXtermMode, xtermLayout } from "./layout";

// JetBrains Mono at 12 px in the page: 7.2 × 16.
const ratio = cellRatio({ cellWidth: 7.2, cellHeight: 16, fontSize: 12 });

describe("xterm layout", () => {
  it("cellRatio", () => {
    expect(ratio).toEqual({ w: 0.6, h: 16 / 12 });
    expect(cellRatio({ cellWidth: 0, cellHeight: 16, fontSize: 12 })).toBeNull();
  });

  it("phone width drives the grid of the view at the normal size", () => {
    expect(xtermLayout({ mode: "phone", width: 360, height: 640, ratio, base: 12 })).toEqual({
      fontSize: 12,
      drive: { cols: 50, rows: 40 },
    });
  });

  it("phone width clamps to the pane.watch limits", () => {
    const l = xtermLayout({ mode: "phone", width: 50, height: 40, ratio, base: 12 });
    expect(l.drive).toEqual({ cols: 20, rows: 5 });
  });

  it("fit scales the pane grid into the view", () => {
    // 150 columns in 360 pt: 360 / (150 × 0.6) = 4, clamped to the smallest size.
    expect(xtermLayout({ mode: "fit", width: 360, height: 640, ratio, pane: { cols: 150, rows: 40 }, base: 12 })).toEqual({
      fontSize: FIT_MIN_SIZE,
      drive: null,
    });
    // 60 columns: 10 pt.
    expect(xtermLayout({ mode: "fit", width: 360, height: 640, ratio, pane: { cols: 60, rows: 24 }, base: 12 }).fontSize).toBe(10);
    // A narrow pane is never above the normal size.
    expect(xtermLayout({ mode: "fit", width: 360, height: 640, ratio, pane: { cols: 20, rows: 5 }, base: 12 }).fontSize).toBe(12);
  });

  it("fit never goes below the smallest size for a very wide pane", () => {
    expect(xtermLayout({ mode: "fit", width: 360, height: 640, ratio, pane: { cols: 300, rows: 80 }, base: 12 }).fontSize).toBe(FIT_MIN_SIZE);
  });

  it("fit also fits the rows in the height", () => {
    // 60 rows in 480 pt: 480 / (60 × 1.333) = 6 → the smallest size.
    expect(xtermLayout({ mode: "fit", width: 800, height: 480, ratio, pane: { cols: 40, rows: 60 }, base: 12 }).fontSize).toBe(FIT_MIN_SIZE);
    // 30 rows: 12 pt is too high (30 × 16 = 480 > 400), 10 pt fits.
    expect(xtermLayout({ mode: "fit", width: 800, height: 400, ratio, pane: { cols: 40, rows: 30 }, base: 12 }).fontSize).toBe(10);
  });

  it("scroll keeps the normal size unless the rows do not fit", () => {
    expect(xtermLayout({ mode: "scroll", width: 360, height: 640, ratio, pane: { cols: 150, rows: 24 }, base: 12 }).fontSize).toBe(12);
    expect(xtermLayout({ mode: "scroll", width: 360, height: 400, ratio, pane: { cols: 150, rows: 30 }, base: 12 }).fontSize).toBe(10);
  });

  it("no measure or no pane grid yet: the normal size", () => {
    expect(xtermLayout({ mode: "fit", width: 360, height: 640, ratio: null, base: 12 })).toEqual({ fontSize: 12, drive: null });
    expect(xtermLayout({ mode: "fit", width: 360, height: 640, ratio, base: 12 })).toEqual({ fontSize: 12, drive: null });
  });

  it("modes: wrap shows as fit; the button skips wrap", () => {
    expect(shownXtermMode("wrap", true)).toBe("fit");
    expect(shownXtermMode("phone", false)).toBe("fit");
    expect(shownXtermMode("phone", true)).toBe("phone");
    expect(nextXtermMode("fit", true)).toBe("scroll");
    expect(nextXtermMode("wrap", false)).toBe("scroll");
    expect(nextXtermMode("scroll", true)).toBe("phone");
    expect(nextXtermMode("scroll", false)).toBe("fit");
    expect(nextXtermMode("phone", true)).toBe("fit");
  });
});
