import { sheetKeyboardShift } from "./sheetKeyboard";

test("a tall sheet stops at its largest height", () => {
  // Sheet 600 at a 0.75 detent: the largest height is 800, so 200 of room. Navigation bar 24.
  expect(sheetKeyboardShift(600, 0.75, 350, 24)).toBe(176);
});

test("a small keyboard moves the sheet by its own height", () => {
  expect(sheetKeyboardShift(600, 0.75, 150, 24)).toBe(126);
});

test("the shift is never below zero", () => {
  expect(sheetKeyboardShift(600, 0.75, 10, 24)).toBe(0);
  expect(sheetKeyboardShift(800, 1, 300, 24)).toBe(0);
});
