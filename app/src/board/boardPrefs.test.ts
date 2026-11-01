import * as SecureStore from "expo-secure-store";

import { showHint, useBoardPrefs } from "./boardPrefs";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

const saved = () => {
  const calls = (SecureStore.setItemAsync as jest.Mock).mock.calls.filter(([k]) => k === "herdling.board_prefs");
  const last = calls[calls.length - 1];
  return last ? (JSON.parse(last[1] as string) as { state: unknown }).state : undefined;
};

const DEFAULTS = { homeTop: "dashboard", groupBy: "status", sortBy: "status", collapsed: {} };

test("new_and_old_installs_default_to_cards_with_the_hint_on", () => {
  // No saved value (a new install, or an install from before this pref) gives the defaults.
  const s = useBoardPrefs.getState();
  expect(s.rowStyle).toBe("cards");
  expect(s.hintDismissed).toBe(false);
  expect(s.homeTop).toBe("dashboard");
  expect(s.groupBy).toBe("status");
  expect(s.sortBy).toBe("status");
});

test("the_row_style_and_the_dismissed_hint_are_saved", async () => {
  useBoardPrefs.getState().setRowStyle("divided");
  await Promise.resolve();
  expect(saved()).toEqual({ rowStyle: "divided", hintDismissed: false, ...DEFAULTS });

  useBoardPrefs.getState().dismissHint();
  await Promise.resolve();
  expect(useBoardPrefs.getState().hintDismissed).toBe(true);
  expect(saved()).toEqual({ rowStyle: "divided", hintDismissed: true, ...DEFAULTS });
});

test("dismissing_again_does_not_write_again", () => {
  useBoardPrefs.setState({ hintDismissed: true });
  const set = SecureStore.setItemAsync as jest.Mock;
  set.mockClear();
  useBoardPrefs.getState().dismissHint();
  useBoardPrefs.getState().dismissHint();
  expect(set).not.toHaveBeenCalled();
});

test("the_hint_shows_only_after_load_with_agents_and_until_dismissed", () => {
  expect(showHint({ hydrated: true, dismissed: false, agents: 2 })).toBe(true);
  // Before the saved prefs load, a dismissed hint must not flash.
  expect(showHint({ hydrated: false, dismissed: false, agents: 2 })).toBe(false);
  expect(showHint({ hydrated: true, dismissed: true, agents: 2 })).toBe(false);
  expect(showHint({ hydrated: true, dismissed: false, agents: 0 })).toBe(false);
});

test("the_top_the_group_and_the_sort_are_saved", async () => {
  useBoardPrefs.getState().setHomeTop("summary");
  useBoardPrefs.getState().setGroupBy("none");
  useBoardPrefs.getState().setSortBy("name");
  await Promise.resolve();
  expect(saved()).toMatchObject({ homeTop: "summary", groupBy: "none", sortBy: "name" });
});

test("collapsed_sections_are_saved_per_group_and_toggle", async () => {
  useBoardPrefs.setState({ collapsed: {} });
  const { toggleCollapsed } = useBoardPrefs.getState();
  toggleCollapsed("host", "h1");
  toggleCollapsed("workspace", "h1:w1");
  await Promise.resolve();
  expect(saved()).toMatchObject({ collapsed: { host: ["h1"], workspace: ["h1:w1"] } });
  toggleCollapsed("host", "h1");
  await Promise.resolve();
  expect(saved()).toMatchObject({ collapsed: { host: [], workspace: ["h1:w1"] } });
});
