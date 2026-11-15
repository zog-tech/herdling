import { readFileSync } from "fs";
import { join } from "path";

import { loadXtermAssets } from "./assets";
import { PAGE_SCRIPT, xtermHtml } from "./page";

// The generator is plain Node code in app/scripts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gen = require("../../../scripts/gen-xterm-assets.js") as { buildAssets: () => string; OUT: string };

describe("xterm assets", () => {
  it("the generated file matches the installed packages", () => {
    // A version bump without `node scripts/gen-xterm-assets.js` fails here.
    expect(readFileSync(join(__dirname, "assets.generated.ts"), "utf8") === gen.buildAssets()).toBe(true);
  });

  it("the page loads nothing from the network", () => {
    const html = xtermHtml(loadXtermAssets(), "#000000");
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<link[^>]*href=/i);
    expect(html).not.toMatch(/url\((["']?)(https?:)?\/\//i);
    expect(html).not.toMatch(/@import/i);
    expect(html).toContain("HerdlingMono");
    expect(loadXtermAssets().versions.xterm).toBe("6.0.0");
  });

  it("the page script never types into the pane", () => {
    expect(PAGE_SCRIPT).not.toMatch(/onData|onBinary|\.input\(/);
    expect(PAGE_SCRIPT).toContain("disableStdin: true");
  });

  it("the page script is valid JavaScript", () => {
    expect(() => new Function(PAGE_SCRIPT)).not.toThrow();
  });
});
