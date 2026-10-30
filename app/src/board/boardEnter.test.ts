import { motion } from "@/theme/tokens";

import { claimEnterDelay, resetBoardEnter } from "./boardEnter";

beforeEach(resetBoardEnter);

test("the first cards get delays one step apart, up to the cap", () => {
  const { stepMs, maxCards } = motion.boardEnter;
  const delays = Array.from({ length: maxCards + 2 }, () => claimEnterDelay(1000));
  expect(delays.slice(0, 3)).toEqual([0, stepMs, stepMs * 2]);
  expect(delays[maxCards - 1]).toBe((maxCards - 1) * stepMs);
  expect(delays[maxCards]).toBeUndefined();
});

test("cards that mount after the first load do not animate", () => {
  expect(claimEnterDelay(1000)).toBe(0);
  expect(claimEnterDelay(5000)).toBeUndefined();
});
