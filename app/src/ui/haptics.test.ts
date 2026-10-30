import * as Haptics from "expo-haptics";

import * as haptics from "./haptics";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

const H = Haptics as unknown as Record<"selectionAsync" | "impactAsync" | "notificationAsync", jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
  haptics.useFeelSettings.setState({ haptics: true });
  haptics.resetStatusThrottle();
});

test.each([
  ["tap", "selectionAsync", undefined],
  ["press", "impactAsync", "light"],
  ["peek", "impactAsync", "medium"],
  ["commit", "notificationAsync", "success"],
  ["warn", "notificationAsync", "warning"],
  ["fail", "notificationAsync", "error"],
] as const)("%s_maps_to_%s", (fn, call, arg) => {
  haptics[fn]();
  expect(H[call]).toHaveBeenCalledTimes(1);
  if (arg) expect(H[call]).toHaveBeenCalledWith(arg);
});

test("the_setting_turns_every_haptic_off", () => {
  haptics.useFeelSettings.setState({ haptics: false });
  haptics.tap();
  haptics.press();
  haptics.peek();
  haptics.commit();
  haptics.warn();
  haptics.fail();
  haptics.status({ from: "working", to: "done" }, 0);
  expect(H.selectionAsync).not.toHaveBeenCalled();
  expect(H.impactAsync).not.toHaveBeenCalled();
  expect(H.notificationAsync).not.toHaveBeenCalled();
});

test("status_maps_the_change_and_is_throttled", () => {
  haptics.status({ from: "working", to: "done" }, 10_000);
  expect(H.notificationAsync).toHaveBeenLastCalledWith("success");
  // Within 1.5 s: nothing.
  haptics.status({ from: "done", to: "blocked" }, 11_000);
  expect(H.notificationAsync).toHaveBeenCalledTimes(1);
  haptics.status({ from: "done", to: "blocked" }, 11_600);
  expect(H.notificationAsync).toHaveBeenLastCalledWith("warning");
  haptics.status({ from: "idle", to: "working" }, 20_000);
  expect(H.selectionAsync).toHaveBeenCalledTimes(1);
  // No change: nothing, and the throttle does not start.
  haptics.status({ from: "working", to: "working" }, 30_000);
  haptics.status({ from: "ready", to: "needs_you" }, 30_100);
  expect(H.notificationAsync).toHaveBeenCalledTimes(3);
});
