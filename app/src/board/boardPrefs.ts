import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

import { toggleKey, type BoardGroup, type SortBy } from "./arrange";

/**
 * How the Board shows each agent.
 * - `flat`: plain rows with a "⋯" button (the first look).
 * - `divided`: rows with a divider and a chevron at the right edge.
 * - `cards`: one card per agent, with a footer that says "Open".
 */
export type RowStyle = "flat" | "divided" | "cards";

/** The styles in the order Settings shows them, with their names. */
export const ROW_STYLES: readonly { id: RowStyle; label: string; detail: string }[] = [
  { id: "flat", label: "Rows", detail: "Plain rows with a menu button." },
  { id: "divided", label: "Rows with arrows", detail: "Rows with a line between them and an arrow." },
  { id: "cards", label: "Cards", detail: "One card for each agent, with an Open label." },
];

/**
 * The top of the Board.
 * - `dashboard`: the brand header, a carousel of large agent tiles, and a short summary line.
 * - `summary`: the "Overview" title and one large number with the other counts under it.
 */
export type HomeTop = "dashboard" | "summary";

export const HOME_TOPS: readonly { id: HomeTop; label: string; detail: string }[] = [
  { id: "dashboard", label: "Dashboard", detail: "The app name, then large tiles for the agents that need you." },
  { id: "summary", label: "Summary", detail: "One large number, then a line with the other counts." },
];

type BoardPrefs = {
  rowStyle: RowStyle;
  /** True after the user opens a session from the Board or closes the first-run hint. */
  hintDismissed: boolean;
  homeTop: HomeTop;
  groupBy: BoardGroup;
  sortBy: SortBy;
  /** The keys of the collapsed sections, for each group that can collapse. */
  collapsed: Partial<Record<BoardGroup, string[]>>;
};

type BoardPrefsStore = BoardPrefs & {
  setRowStyle: (s: RowStyle) => void;
  dismissHint: () => void;
  setHomeTop: (t: HomeTop) => void;
  setGroupBy: (g: BoardGroup) => void;
  setSortBy: (s: SortBy) => void;
  /** Collapses the section, or expands it when it is collapsed. */
  toggleCollapsed: (g: BoardGroup, key: string) => void;
};

/**
 * Board preferences, persisted. New and old installs start with cards and the Dashboard top: an
 * old install has no saved value, so it gets the default too (persist merges the saved fields over
 * the defaults).
 */
export const useBoardPrefs = create<BoardPrefsStore>()(
  persist(
    (set, get) => ({
      rowStyle: "cards",
      hintDismissed: false,
      homeTop: "dashboard",
      groupBy: "status",
      sortBy: "status",
      collapsed: {},
      setRowStyle: (rowStyle) => set({ rowStyle }),
      setHomeTop: (homeTop) => set({ homeTop }),
      setGroupBy: (groupBy) => set({ groupBy }),
      setSortBy: (sortBy) => set({ sortBy }),
      toggleCollapsed: (g, key) => set((s) => ({ collapsed: { ...s.collapsed, [g]: toggleKey(s.collapsed[g] ?? [], key) } })),
      // No write when it is already dismissed: each open of a session calls this.
      dismissHint: () => {
        if (!get().hintDismissed) set({ hintDismissed: true });
      },
    }),
    {
      name: "herdling.board_prefs",
      storage: secureJSONStorage(),
      partialize: (s): BoardPrefs => ({
        rowStyle: s.rowStyle,
        hintDismissed: s.hintDismissed,
        homeTop: s.homeTop,
        groupBy: s.groupBy,
        sortBy: s.sortBy,
        collapsed: s.collapsed,
      }),
    },
  ),
);

/**
 * True when the Board shows the "Tap an agent" hint: the saved prefs are loaded (so a dismissed
 * hint never flashes at launch), the user did not dismiss it, and there is at least one agent.
 */
export function showHint(p: { hydrated: boolean; dismissed: boolean; agents: number }): boolean {
  return p.hydrated && !p.dismissed && p.agents > 0;
}

/** True once the saved Board prefs are loaded. */
export function useBoardPrefsHydrated(): boolean {
  const [ready, setReady] = useState(() => useBoardPrefs.persist.hasHydrated());
  useEffect(() => {
    if (ready) return;
    const off = useBoardPrefs.persist.onFinishHydration(() => setReady(true));
    // It can finish between the first render and this effect.
    if (useBoardPrefs.persist.hasHydrated()) setReady(true);
    return off;
  }, [ready]);
  return ready;
}
