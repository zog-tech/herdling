import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

import { buildColors, type AccentId, type ThemeChoice, type ThemeId } from "./palettes";
import { THEME_PREFS_KEY, parseChoice, savedChoice } from "./savedChoice";
import { NIGHT_WATCH, applyColors, colors } from "./tokens";

type ThemePrefsStore = ThemeChoice & {
  /** Goes up by one each time new colors are applied. The root layout mounts the screens again on a change. */
  applied: number;
  setTheme: (theme: ThemeId) => void;
  setAccent: (accent: AccentId) => void;
};

/** True when the live colors already show `choice`. */
function showing(choice: ThemeChoice): boolean {
  const next = buildColors(NIGHT_WATCH, choice);
  return JSON.stringify(next) === JSON.stringify(colors);
}

/**
 * Applies `choice` to the live colors. Returns false when they already show it, so the screens
 * do not mount again for no change.
 */
export function applyChoice(choice: ThemeChoice): boolean {
  if (showing(choice)) return false;
  applyColors(buildColors(NIGHT_WATCH, choice));
  return true;
}

/**
 * The theme and accent, persisted in the keychain. The start value is the choice that `tokens.ts`
 * read synchronously at launch, so the store and the live colors agree before hydration.
 */
export const useThemePrefs = create<ThemePrefsStore>()(
  persist(
    (set, get) => ({
      ...savedChoice(),
      applied: 0,
      setTheme: (theme) => {
        if (applyChoice({ theme, accent: get().accent })) set({ theme, applied: get().applied + 1 });
        else set({ theme });
      },
      setAccent: (accent) => {
        if (applyChoice({ theme: get().theme, accent })) set({ accent, applied: get().applied + 1 });
        else set({ accent });
      },
    }),
    {
      name: THEME_PREFS_KEY,
      storage: secureJSONStorage(),
      partialize: (s): ThemeChoice => ({ theme: s.theme, accent: s.accent }),
      // A value from a newer app (an unknown theme or accent) falls back to the default.
      merge: (saved, current) => ({ ...current, ...parseChoice(JSON.stringify({ state: saved })) }),
      // The launch read can fail (a locked keychain) while the later read works: apply the loaded value.
      onRehydrateStorage: () => (s) => {
        if (s && applyChoice({ theme: s.theme, accent: s.accent })) {
          useThemePrefs.setState({ applied: useThemePrefs.getState().applied + 1 });
        }
      },
    },
  ),
);
