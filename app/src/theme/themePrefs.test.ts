import * as SecureStore from "expo-secure-store";

import { DEFAULT_CHOICE } from "./palettes";
import { THEME_PREFS_KEY, parseChoice } from "./savedChoice";
import { useThemePrefs } from "./themePrefs";
import { NIGHT_WATCH, applyColors, colors, elevation, state, themed } from "./tokens";

jest.mock("expo-secure-store", () => ({
  getItem: jest.fn(() => null),
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

const saved = () => {
  const calls = (SecureStore.setItemAsync as jest.Mock).mock.calls.filter(([k]) => k === THEME_PREFS_KEY);
  const last = calls[calls.length - 1];
  return last ? (JSON.parse(last[1] as string) as { state: unknown }).state : undefined;
};

afterEach(() => {
  useThemePrefs.getState().setTheme("nightWatch");
  useThemePrefs.getState().setAccent("lantern");
});

test("the_default_is_night_watch_with_lantern", () => {
  const s = useThemePrefs.getState();
  expect({ theme: s.theme, accent: s.accent }).toEqual(DEFAULT_CHOICE);
  expect(s.applied).toBe(0);
  expect(colors).toEqual(NIGHT_WATCH);
});

test("a_new_accent_applies_in_place_and_is_saved", async () => {
  const status = colors.status;
  const before = useThemePrefs.getState().applied;
  useThemePrefs.getState().setAccent("seaGlass");
  await Promise.resolve();
  expect(colors.accent).toBe("#5EC2B0");
  expect(colors.status.working).toBe("#5EC2B0");
  // The nested objects stay the same objects, so code that holds them sees the change.
  expect(colors.status).toBe(status);
  expect(state.focusRing.color).toBe("#5EC2B0");
  expect(useThemePrefs.getState().applied).toBe(before + 1);
  expect(saved()).toEqual({ theme: "nightWatch", accent: "seaGlass" });
});

test("a_new_theme_changes_surfaces_and_elevation", () => {
  useThemePrefs.getState().setTheme("midnight");
  expect(colors.bg).toBe("#000000");
  expect(colors.text).toBe(NIGHT_WATCH.text);
  expect(elevation[0].backgroundColor).toBe("#000000");
  expect(elevation[1]).toEqual({ backgroundColor: "#0E0E10", borderWidth: 1, borderColor: "#252528" });
});

test("the_same_choice_does_not_mount_the_screens_again", () => {
  const before = useThemePrefs.getState().applied;
  useThemePrefs.getState().setTheme("nightWatch");
  useThemePrefs.getState().setAccent("lantern");
  expect(useThemePrefs.getState().applied).toBe(before);
});

test("themed_values_build_again_after_a_theme_change", () => {
  const make = jest.fn(() => ({ color: colors.bg }));
  const get = themed(make);
  expect(get()).toBe(get());
  expect(make).toHaveBeenCalledTimes(1);
  applyColors({ ...NIGHT_WATCH, bg: "#000000" });
  expect(get().color).toBe("#000000");
  expect(make).toHaveBeenCalledTimes(2);
  applyColors(NIGHT_WATCH);
});

test("the_saved_choice_is_read_from_the_persist_json", () => {
  expect(parseChoice(null)).toEqual(DEFAULT_CHOICE);
  expect(parseChoice("not json")).toEqual(DEFAULT_CHOICE);
  expect(parseChoice(JSON.stringify({ state: { theme: "graphite", accent: "iris" }, version: 0 }))).toEqual({ theme: "graphite", accent: "iris" });
  // A theme from a newer app falls back; the known accent stays.
  expect(parseChoice(JSON.stringify({ state: { theme: "daylight", accent: "ember" } }))).toEqual({ theme: "nightWatch", accent: "ember" });
});
