import { space } from "@/theme/tokens";

import { actionBarPlacement, screenBottomPadding } from "./screenInsets";

test("content_ends_above_the_safe_area_or_above_the_bar", () => {
  expect(screenBottomPadding({ safeBottom: 34 })).toBe(space.xl + 34);
  // An iOS tab: the safe area includes the tab bar.
  expect(screenBottomPadding({ safeBottom: 83 })).toBe(space.xl + 83);
  expect(screenBottomPadding({ safeBottom: 34, barSpace: 100 })).toBe(space.xl + 100);
  expect(screenBottomPadding({ safeBottom: -3 })).toBe(space.xl);
});

test("bar_sits_on_the_home_indicator_the_tab_bar_or_the_keyboard", () => {
  expect(actionBarPlacement({ safeBottom: 34, windowBottom: 34 })).toEqual({ bottom: 0, paddingBottom: 34 });
  expect(actionBarPlacement({ safeBottom: 0, windowBottom: 0 })).toEqual({ bottom: 0, paddingBottom: space.md });
  expect(actionBarPlacement({ safeBottom: 83, windowBottom: 34 })).toEqual({ bottom: 83, paddingBottom: space.md });
  expect(actionBarPlacement({ safeBottom: 83, windowBottom: 34, keyboardLift: 300 })).toEqual({ bottom: 300, paddingBottom: space.md });
});
