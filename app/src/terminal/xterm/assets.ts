/**
 * The xterm.js assets of the terminal page, from `assets.generated.ts`. That module is large, so it
 * loads on first use (the first terminal view), not when the app starts.
 */
export type XtermAssets = {
  css: string;
  xterm: string;
  search: string;
  unicode11: string;
  fontRegular: string;
  fontBold: string;
  versions: { xterm: string; search: string; unicode11: string; jetbrainsMono: string };
};

let cached: XtermAssets | undefined;

export function loadXtermAssets(): XtermAssets {
  if (cached) return cached;
  const g = require("./assets.generated") as typeof import("./assets.generated");
  cached = {
    css: g.XTERM_CSS,
    xterm: g.XTERM_JS,
    search: g.SEARCH_JS,
    unicode11: g.UNICODE11_JS,
    fontRegular: g.FONT_REGULAR_B64,
    fontBold: g.FONT_BOLD_B64,
    versions: g.XTERM_VERSIONS,
  };
  return cached;
}
