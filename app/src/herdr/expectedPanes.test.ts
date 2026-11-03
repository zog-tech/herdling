import { clearExpected, EXPECT_MS, expectedKind, expectPane, resetExpected } from "./expectedPanes";

afterEach(resetExpected);

test("a_mark_holds_until_it_expires", () => {
  expectPane("h", "p1", "agent", 1_000);
  expect(expectedKind("h", "p1", 1_000)).toBe("agent");
  expect(expectedKind("h", "p1", 1_000 + EXPECT_MS - 1)).toBe("agent");
  expect(expectedKind("h", "p1", 1_000 + EXPECT_MS)).toBeUndefined();
});

test("a_mark_belongs_to_one_host_and_one_pane", () => {
  expectPane("h", "p1", "shell", 0);
  expect(expectedKind("h", "p1", 0)).toBe("shell");
  expect(expectedKind("h", "p2", 0)).toBeUndefined();
  expect(expectedKind("g", "p1", 0)).toBeUndefined();
});

test("clear_removes_the_mark", () => {
  expectPane("h", "p1", "agent");
  clearExpected("h", "p1");
  expect(expectedKind("h", "p1")).toBeUndefined();
  // Clearing a pane with no mark does nothing.
  clearExpected("h", "p1");
  expect(expectedKind("h", "p1")).toBeUndefined();
});
