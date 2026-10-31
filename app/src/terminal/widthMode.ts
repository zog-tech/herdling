import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

import type { WidthMode } from "./fit";

type Store = { mode: WidthMode; set: (mode: WidthMode) => void };

/** Terminal width mode: fit to screen (default), wrap lines, or scroll sideways. Persisted per device. */
export const useTerminalWidth = create<Store>()(
  persist((set) => ({ mode: "fit", set: (mode) => set({ mode }) }), {
    name: "zogssh.terminal_width",
    storage: secureJSONStorage(),
    partialize: (s) => ({ mode: s.mode }),
  }),
);
