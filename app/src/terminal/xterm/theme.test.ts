import { colors } from "@/theme/tokens";

import { searchDecorations, xtermTheme } from "./theme";

describe("xtermTheme", () => {
  it("maps the terminal tokens and all 16 ANSI colors", () => {
    const t = xtermTheme(colors);
    expect(t.background).toBe(colors.terminal.bg);
    expect(t.foreground).toBe(colors.terminal.fg);
    expect(t.cursorAccent).toBe(colors.terminal.bg);
    expect(t.red).toBe(colors.ansi[1]);
    expect(t.brightWhite).toBe(colors.ansi[15]);
    const named = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
    expect([...named, ...named.map((n) => `bright${n[0].toUpperCase()}${n.slice(1)}`)].every((n) => /^#[0-9a-fA-F]{6}$/.test(t[n] ?? ""))).toBe(true);
  });

  it("paper: a light screen", () => {
    const t = xtermTheme({ ...colors, terminal: { bg: "#F7F4EC", fg: "#24211C" } });
    expect(t.background).toBe("#F7F4EC");
    expect(t.cursor).toBe("#24211C");
  });

  it("search colors come from the search tokens", () => {
    expect(searchDecorations(colors).activeMatchBackground).toBe(colors.search.currentBg);
  });
});
