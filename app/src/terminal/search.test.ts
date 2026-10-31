import type { Line } from "./ansi";
import { findInLines, markLines } from "./search";

const lines: Line[] = [
  [{ text: "$ " }, { text: "pnpm test", bold: true }],
  [{ text: "FAIL", fg: "#f00" }, { text: " src/a.test.ts  fail fail" }],
  [{ text: "done" }],
];

const styles = { current: { fg: "C", bg: "CB" }, other: { fg: "O", bg: "OB" } };

describe("findInLines", () => {
  it("finds every match in any case, across spans", () => {
    expect(findInLines(lines, "fail")).toEqual([
      { line: 1, start: 0, end: 4 },
      { line: 1, start: 20, end: 24 },
      { line: 1, start: 25, end: 29 },
    ]);
    expect(findInLines(lines, "$ pnpm")).toEqual([{ line: 0, start: 0, end: 6 }]);
    expect(findInLines(lines, " ")).toEqual([]);
  });
});

describe("markLines", () => {
  it("splits spans at the match and keeps the other lines", () => {
    const m = findInLines(lines, "$ pnpm");
    const out = markLines(lines, m, 0, styles);
    expect(out[0]).toEqual([
      { text: "$ ", fg: "C", bg: "CB", inverse: false, dim: false },
      { text: "pnpm", bold: true, fg: "C", bg: "CB", inverse: false, dim: false },
      { text: " test", bold: true },
    ]);
    expect(out[1]).toBe(lines[1]);
    expect(out[2]).toBe(lines[2]);
  });

  it("marks the current match apart from the others", () => {
    const m = findInLines(lines, "fail");
    const out = markLines(lines, m, 2, styles);
    const marked = out[1].filter((s) => s.bg);
    expect(marked.map((s) => [s.text, s.bg])).toEqual([
      ["FAIL", "OB"],
      ["fail", "OB"],
      ["fail", "CB"],
    ]);
    // The text is the same after marking.
    expect(out[1].map((s) => s.text).join("")).toBe(lines[1].map((s) => s.text).join(""));
  });

  it("returns the same lines when nothing matches", () => {
    expect(markLines(lines, [], -1, styles)).toBe(lines);
  });
});
