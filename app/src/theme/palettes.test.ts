import { contrast, mix, rgb, withAlpha } from "./contrast";
import fixture from "./nightWatch.fixture.json";
import { ACCENTS, DEFAULT_CHOICE, THEMES, buildColors, type ThemeChoice } from "./palettes";
import { NIGHT_WATCH, colors, elevation, state, type Colors } from "./tokens";

jest.mock("expo-secure-store", () => ({ getItem: jest.fn(() => null) }));

const combos: ThemeChoice[] = THEMES.flatMap((t) => ACCENTS.map((a) => ({ theme: t.id, accent: a.id })));
const name = (c: ThemeChoice) => `${c.theme}+${c.accent}`;

/** The opaque color of an `rgba(...)` fill over `bg`. */
function flatten(fill: string, bg: string): string {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(fill);
  if (!m) return fill;
  const hex = `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
  return mix(hex, bg, Number(m[4]));
}

test("night_watch_is_the_same_as_before_themes", () => {
  // The fixture is the `colors` object of the app before themes, value for value.
  expect(NIGHT_WATCH).toEqual(fixture);
  expect(buildColors(NIGHT_WATCH, DEFAULT_CHOICE)).toEqual(fixture);
  // No saved choice: the live colors are Night Watch.
  expect(colors).toEqual(fixture);
  expect(state.focusRing.color).toBe("#D4A857");
  expect(elevation[2]).toEqual({ backgroundColor: "#1C1C1F", borderWidth: 1, borderColor: "#706B62" });
});

test("every_theme_has_every_token", () => {
  const keys = (o: object, p = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && !Array.isArray(v) ? keys(v as object, `${p}${k}.`) : [`${p}${k}`]));
  for (const c of combos) expect(keys(buildColors(NIGHT_WATCH, c))).toEqual(keys(NIGHT_WATCH));
});

describe.each(combos.map((c) => [name(c), c] as const))("%s", (_n, choice) => {
  const c: Colors = buildColors(NIGHT_WATCH, choice);
  const surfaces = { bg: c.bg, card: c.card, raised: c.raised } as const;

  test("text_and_muted_text_pass_on_every_surface", () => {
    for (const bg of Object.values(surfaces)) {
      expect(contrast(c.text, bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(c.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(c.text, c.raisedHigh)).toBeGreaterThanOrEqual(7);
    expect(contrast(c.textMuted, c.raisedHigh)).toBeGreaterThanOrEqual(4.5);
  });

  test("accent_passes_as_text_and_as_a_fill", () => {
    expect(contrast(c.accent, c.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.accent, c.raised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.onAccent, c.accentPressed)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.search.currentFg, c.search.currentBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.search.matchFg, c.search.matchBg)).toBeGreaterThanOrEqual(4.5);
  });

  test("edges_pass_three_to_one", () => {
    for (const bg of Object.values(surfaces)) expect(contrast(c.border, bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.edge, c.bg)).toBeGreaterThanOrEqual(3);
  });

  test("statuses_pass_on_card_and_needs_you_differs_from_working", () => {
    for (const s of Object.values(c.status)) expect(contrast(s, c.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.status.blocked, flatten(c.blockedTint, c.bg))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.text, flatten(c.blockedTint, c.bg))).toBeGreaterThanOrEqual(7);
    // The lantern follows the accent. "Needs you" must be at least as far from it as ember is
    // from the lantern gold in Night Watch (about 53 in RGB distance).
    expect(c.status.working).toBe(c.accent);
    const [a, b] = [rgb(c.status.working), rgb(c.status.blocked)];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(50);
  });

  test("terminal_and_diff_pass", () => {
    expect(contrast(c.terminal.fg, c.terminal.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(c.diff.add, c.diff.addBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.diff.del, c.diff.delBg)).toBeGreaterThanOrEqual(4.5);
    for (const fg of c.ansi.slice(1)) expect(contrast(fg, c.sunken)).toBeGreaterThanOrEqual(4);
  });

  test("glass_fallback_is_raised_at_92_percent", () => {
    expect(c.glassFallback).toBe(withAlpha(c.raised, 0.92));
  });
});

test("ember_accent_moves_needs_you_to_rose", () => {
  const c = buildColors(NIGHT_WATCH, { theme: "nightWatch", accent: "ember" });
  expect(c.status.blocked).toBe("#EE7BB4");
  expect(c.blockedTint).toBe(withAlpha("#EE7BB4", 0.08));
  // Other accents keep the ember of "needs you".
  expect(buildColors(NIGHT_WATCH, { theme: "graphite", accent: "seaGlass" }).status.blocked).toBe(NIGHT_WATCH.status.blocked);
});

test("a_theme_does_not_change_night_watch", () => {
  const before = JSON.stringify(NIGHT_WATCH);
  buildColors(NIGHT_WATCH, { theme: "graphite", accent: "iris" });
  expect(JSON.stringify(NIGHT_WATCH)).toBe(before);
});
