import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

import type { WidthMode } from "./fit";

type Store = {
  mode: WidthMode;
  /** True after the one-time note of "Phone width". */
  phoneNoteSeen: boolean;
  set: (mode: WidthMode) => void;
  notePhone: () => void;
};

/**
 * Terminal width mode: fit to screen (default), wrap lines, scroll sideways, or the phone width of
 * a Herdr 2 pane. Persisted per device.
 */
export const useTerminalWidth = create<Store>()(
  persist(
    (set) => ({ mode: "fit", phoneNoteSeen: false, set: (mode) => set({ mode }), notePhone: () => set({ phoneNoteSeen: true }) }),
    {
      name: "herdling.terminal_width",
      storage: secureJSONStorage(),
      partialize: (s) => ({ mode: s.mode, phoneNoteSeen: s.phoneNoteSeen }),
    },
  ),
);

/** Connections whose `pane.watch` gave no `drive: true` for a size: an older herdlingd. */
const noDrive = new WeakSet<object>();

/** Remembers that this connection cannot drive a pane at the phone size. */
export function markNoDrive(rpc: object): void {
  noDrive.add(rpc);
}

/** False after a watch on this connection gave no `drive`. */
export function canDrive(rpc: object | undefined): boolean {
  return !!rpc && !noDrive.has(rpc);
}
