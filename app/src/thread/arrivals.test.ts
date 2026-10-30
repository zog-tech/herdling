import { Arrivals } from "./arrivals";

test("the first page does not animate", () => {
  const a = new Arrivals();
  expect(a.claim("1", 0)).toBe(false);
});

test("a new item at the bottom animates once the list has items", () => {
  const a = new Arrivals();
  a.commit(["1", "2"]);
  expect(a.claim("3", 0)).toBe(true);
  a.commit(["1", "2", "3"]);
  // Mounted again by the list (scrolled back into view): no animation.
  expect(a.claim("3", 0)).toBe(false);
});

test("older pages and items away from the bottom do not animate", () => {
  const a = new Arrivals();
  a.commit(["5", "6"]);
  expect(a.claim("1", 40)).toBe(false);
  a.atBottom = false;
  expect(a.claim("7", 0)).toBe(false);
});
