import type { Hello } from "@herdling/protocol";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

/**
 * How the terminal view draws a pane. "terminal": a terminal emulator (xterm.js in a web view) on
 * the raw stream of `pane.watch` (`format: "vt"`). "classic": the screen text with ANSI colors in
 * React Native text.
 */
export type Renderer = "terminal" | "classic";

type Store = { renderer: Renderer; set: (renderer: Renderer) => void };

/** The renderer choice of Settings, Terminal. Persisted per device. */
export const useTerminalRenderer = create<Store>()(
  persist((set) => ({ renderer: "terminal", set: (renderer) => set({ renderer }) }), {
    name: "herdling.terminal_renderer",
    storage: secureJSONStorage(),
    partialize: (s) => ({ renderer: s.renderer }),
  }),
);

/** True when the host streams raw terminal bytes (`hello.watch_formats` has `vt`). */
export function hostHasVt(hello: Hello | undefined): boolean {
  return hello?.watch_formats?.includes("vt") ?? false;
}

/**
 * The renderer for a terminal view: "terminal" only when the user did not choose "classic", the
 * host has the raw stream, and the build has the web view. Else "classic".
 */
export function chooseRenderer(pref: Renderer, hello: Hello | undefined, webView: boolean): Renderer {
  return pref === "terminal" && webView && hostHasVt(hello) ? "terminal" : "classic";
}
