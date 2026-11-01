import { NIGHT_WATCH, colors } from "./tokens";

// The keychain holds Graphite with Iris before the app starts: `tokens.ts` applies it while it loads.
jest.mock("expo-secure-store", () => ({
  getItem: jest.fn((k: string) => (k === "herdling.theme_prefs" ? JSON.stringify({ state: { theme: "graphite", accent: "iris" }, version: 0 }) : null)),
}));

test("the_saved_theme_applies_before_any_screen_reads_a_color", () => {
  expect(colors.bg).toBe("#0A0B0D");
  expect(colors.accent).toBe("#A898F0");
  expect(colors.status.working).toBe("#A898F0");
  // Night Watch itself does not change.
  expect(NIGHT_WATCH.bg).toBe("#0A0A0B");
});
