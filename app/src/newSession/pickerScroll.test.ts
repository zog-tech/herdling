import { revealOffset } from "./pickerScroll";

describe("revealOffset", () => {
  it("does not scroll when the chip shows already, so the Shell chip stays in view", () => {
    // Shell at 16 (80 wide), Claude Code at 104 (130 wide), on a 390 pt wide row.
    expect(revealOffset(104, 130, 390, 16)).toBeUndefined();
    expect(revealOffset(16, 80, 390, 16)).toBeUndefined();
  });

  it("scrolls a chip far down the row to the start of the row", () => {
    expect(revealOffset(600, 100, 390, 16)).toBe(584);
    // A chip that is cut at the right edge.
    expect(revealOffset(300, 100, 390, 16)).toBe(284);
  });

  it("does not scroll before the row width is known", () => {
    expect(revealOffset(600, 100, 0, 16)).toBeUndefined();
  });
});
