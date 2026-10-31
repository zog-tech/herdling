import { SHORTCUTS, shortcutLabel, shortcutsFor, TAB_ROUTES } from "./shortcuts";

describe("SHORTCUTS", () => {
  it("has one entry per id and per key combination", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const combos = SHORTCUTS.map((s) => shortcutLabel(s));
    expect(new Set(combos).size).toBe(combos.length);
  });

  it("matches the keys of the spec", () => {
    const keys = Object.fromEntries(SHORTCUTS.map((s) => [s.id, shortcutLabel(s)]));
    expect(keys).toEqual({
      tab1: "⌘1",
      tab2: "⌘2",
      tab3: "⌘3",
      tab4: "⌘4",
      prevAgent: "⌘[",
      nextAgent: "⌘]",
      send: "⌘↩",
      interrupt: "⌘.",
      toggleMode: "⌘T",
      newSession: "⌘N",
      refresh: "⌘R",
      escape: "Esc",
    });
  });

  it("gives every shortcut a title for the iPadOS list", () => {
    for (const s of SHORTCUTS) expect(s.title.length).toBeGreaterThan(0);
  });

  it("uses only keys that the native module knows", () => {
    for (const s of SHORTCUTS) expect(s.input.length === 1 || s.input === "enter" || s.input === "escape").toBe(true);
  });
});

describe("TAB_ROUTES", () => {
  it("maps ⌘1 to ⌘4 to the four tabs", () => {
    expect(Object.values(TAB_ROUTES)).toEqual(["/", "/usage", "/automations", "/settings"]);
  });
});

describe("shortcutsFor", () => {
  it("keeps the table order and drops unknown ids", () => {
    expect(shortcutsFor(["send", "tab1", "nope"]).map((s) => s.id)).toEqual(["tab1", "send"]);
    expect(shortcutsFor([])).toEqual([]);
  });
});

describe("shortcutLabel", () => {
  it("orders the modifiers as Apple does", () => {
    expect(shortcutLabel({ input: "k", modifiers: ["command", "shift", "control", "alternate"] })).toBe("⌃⌥⇧⌘K");
  });
});
