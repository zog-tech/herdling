const mockSaved = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => mockSaved.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    mockSaved.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    mockSaved.delete(k);
  },
}));

import { currentPrefs, samePrefs, useNotifPrefs, type NotifPrefs } from "./prefs";

const ALL_ON: NotifPrefs = { finished: true, needs_you: true, quiet_at_desk: true, replace: true, group: true, quiet_finished: true };

beforeEach(() => {
  mockSaved.clear();
  useNotifPrefs.setState(ALL_ON);
});

test("all_prefs_default_on", () => {
  expect(currentPrefs()).toEqual(ALL_ON);
});

test("set_pref_changes_only_that_pref", () => {
  useNotifPrefs.getState().setPref("group", false);
  expect(currentPrefs()).toEqual({ ...ALL_ON, group: false });
});

test("current_prefs_has_no_functions", () => {
  expect(Object.values(currentPrefs()).every((v) => typeof v === "boolean")).toBe(true);
});

test("prefs_saved_by_an_older_app_keep_the_new_defaults", async () => {
  mockSaved.set("herdling.notif_prefs", JSON.stringify({ state: { finished: false, needs_you: true, quiet_at_desk: false }, version: 0 }));
  await useNotifPrefs.persist.rehydrate();
  expect(currentPrefs()).toEqual({ ...ALL_ON, finished: false, quiet_at_desk: false });
});

test("new_prefs_are_saved", async () => {
  useNotifPrefs.getState().setPref("quiet_finished", false);
  await Promise.resolve();
  const saved = JSON.parse(mockSaved.get("herdling.notif_prefs") ?? "{}") as { state?: Partial<NotifPrefs> };
  expect(saved.state).toEqual({ ...ALL_ON, quiet_finished: false });
});

test("same_prefs_compares_each_pref", () => {
  expect(samePrefs(ALL_ON, { ...ALL_ON })).toBe(true);
  for (const k of Object.keys(ALL_ON) as (keyof NotifPrefs)[]) {
    expect(samePrefs(ALL_ON, { ...ALL_ON, [k]: false })).toBe(false);
  }
});
