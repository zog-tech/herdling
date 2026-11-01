import * as SecureStore from "expo-secure-store";

import { DEFAULT_CHOICE, isAccentId, isThemeId, type ThemeChoice } from "./palettes";

/** The keychain key of the theme prefs store (`themePrefs.ts`). */
export const THEME_PREFS_KEY = "herdling.theme_prefs";

/**
 * The saved theme choice from the JSON that zustand `persist` writes: `{"state":{...},"version":0}`.
 * A missing, damaged or unknown value gives the default for that field.
 */
export function parseChoice(raw: string | null | undefined): ThemeChoice {
  if (!raw) return DEFAULT_CHOICE;
  try {
    const s = (JSON.parse(raw) as { state?: { theme?: unknown; accent?: unknown } }).state ?? {};
    return {
      theme: isThemeId(s.theme) ? s.theme : DEFAULT_CHOICE.theme,
      accent: isAccentId(s.accent) ? s.accent : DEFAULT_CHOICE.accent,
    };
  } catch {
    return DEFAULT_CHOICE;
  }
}

let cached: ThemeChoice | undefined;

/**
 * The saved choice, read synchronously once at start, before the first screen renders, so the
 * app never shows the wrong colors first. Every build has the synchronous keychain read.
 * When the read fails (for example a locked keychain), the app starts in the default theme.
 */
export function savedChoice(): ThemeChoice {
  if (cached) return cached;
  try {
    cached = parseChoice(SecureStore.getItem(THEME_PREFS_KEY));
  } catch {
    cached = DEFAULT_CHOICE;
  }
  return cached;
}
