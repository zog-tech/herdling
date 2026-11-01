import type { Colors } from "./tokens";

/**
 * Themes and accents the user picks in Settings, "Theme". A theme changes the surfaces and text;
 * an accent changes the gold of the primary action, the selected state and the "working" lantern.
 * Both build on the Night Watch values in `tokens.ts`: a token that a theme does not name keeps
 * its Night Watch value. Only dark themes: see `design-system/herdling/MASTER.md`, "Themes".
 * This file imports only types, so `tokens.ts` can use it while it loads.
 */

export type ThemeId = "nightWatch" | "midnight" | "graphite";
export type AccentId = "lantern" | "ember" | "seaGlass" | "iris" | "ivory";
export type ThemeChoice = { theme: ThemeId; accent: AccentId };

export const DEFAULT_CHOICE: ThemeChoice = { theme: "nightWatch", accent: "lantern" };

type DeepPartial<T> = T extends string
  ? string
  : T extends readonly string[]
    ? readonly string[]
    : { readonly [K in keyof T]?: DeepPartial<T[K]> };

export type ThemeDef = {
  id: ThemeId;
  label: string;
  detail: string;
  /** The tokens that differ from Night Watch. */
  colors: DeepPartial<Colors>;
};

export type AccentDef = {
  id: AccentId;
  label: string;
  accent: string;
  /** A pressed accent control. `onAccent` on it is 4.5:1 or more. */
  accentPressed: string;
  /** Text and icons on the accent fill: 4.5:1 or more. */
  onAccent: string;
  /** Search matches that are not the current one: the accent at about 40% over `sunken`. */
  matchBg: string;
  /**
   * "Needs you" when the accent is too near to ember. The lantern (working) follows the accent,
   * so ember would show the same color for "working" and "needs you".
   */
  blocked?: { color: string; tint: string };
};

/** Graphite: cool neutral greys. Same steps as Night Watch, with a blue cast instead of a warm one. */
const GRAPHITE_TEXT = "#F1F3F6";
const GRAPHITE_MUTED = "#9BA1AB";
const GRAPHITE_TERMINAL_FG = "#E2E5EA";

export const THEMES: readonly ThemeDef[] = [
  {
    id: "nightWatch",
    label: "Night Watch",
    detail: "Warm blacks and ivory text.",
    colors: {},
  },
  {
    id: "midnight",
    label: "Midnight",
    detail: "True black for OLED screens.",
    colors: {
      bg: "#000000",
      card: "#0E0E10",
      raised: "#18181B",
      raisedHigh: "#28272B",
      sunken: "#000000",
      divider: "#252528",
      glassFallback: "rgba(24,24,27,0.92)",
      diff: { addBg: "#11160F", delBg: "#1B0909" },
      terminal: { bg: "#000000" },
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    detail: "Cool neutral greys.",
    colors: {
      bg: "#0A0B0D",
      card: "#141619",
      raised: "#1C1F23",
      raisedHigh: "#2B2E33",
      sunken: "#070809",
      divider: "#2A2D32",
      border: "#6A707A",
      edge: "#5F656E",
      text: GRAPHITE_TEXT,
      textMuted: GRAPHITE_MUTED,
      link: GRAPHITE_TEXT,
      glassFallback: "rgba(28,31,35,0.92)",
      status: { idle: GRAPHITE_MUTED, unknown: "#838993" },
      diff: { addBg: "#171D17", delBg: "#221011" },
      search: { matchFg: GRAPHITE_TERMINAL_FG },
      agent: { codex: GRAPHITE_TEXT, other: GRAPHITE_MUTED },
      terminal: { bg: "#070809", fg: GRAPHITE_TERMINAL_FG },
      // The warmed black and white entries turn cool; the colored entries stay.
      ansi: [
        "#363A40",
        "#EF4444",
        "#22C55E",
        "#EAB308",
        "#3B82F6",
        "#A855F7",
        "#06B6D4",
        "#CDD2DA",
        "#6E747D",
        "#F87171",
        "#4ADE80",
        "#FACC15",
        "#60A5FA",
        "#C084FC",
        "#22D3EE",
        GRAPHITE_TEXT,
      ],
    },
  },
];

export const ACCENTS: readonly AccentDef[] = [
  { id: "lantern", label: "Lantern", accent: "#D4A857", accentPressed: "#B8903F", onAccent: "#0A0A0B", matchBg: "#5A4721" },
  {
    id: "ember",
    label: "Ember",
    accent: "#F0884A",
    accentPressed: "#D06F35",
    onAccent: "#0A0A0B",
    matchBg: "#643B22",
    // A rose "needs you": ember would be the same color as the working lantern.
    blocked: { color: "#EE7BB4", tint: "rgba(238,123,180,0.08)" },
  },
  { id: "seaGlass", label: "Sea glass", accent: "#5EC2B0", accentPressed: "#45A08F", onAccent: "#0A0A0B", matchBg: "#2A524B" },
  { id: "iris", label: "Iris", accent: "#A898F0", accentPressed: "#8B7AD8", onAccent: "#0A0A0B", matchBg: "#474165" },
  { id: "ivory", label: "Ivory", accent: "#E9E4D8", accentPressed: "#C7C1B4", onAccent: "#0A0A0B", matchBg: "#615F5B" },
];

export function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

export function isAccentId(v: unknown): v is AccentId {
  return ACCENTS.some((a) => a.id === v);
}

export function themeDef(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function accentDef(id: AccentId): AccentDef {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

type Plain = { [k: string]: unknown };

const isObject = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

/** A deep copy of `base` with the values of `over` on top. Arrays are replaced, not merged. */
function merge<T>(base: T, over: unknown): T {
  if (!isObject(base)) return (over === undefined ? base : over) as T;
  const out: Plain = {};
  const o = isObject(over) ? over : {};
  for (const k of Object.keys(base)) {
    const b = (base as Plain)[k];
    out[k] = isObject(b) ? merge(b, o[k]) : Array.isArray(b) ? [...((o[k] as unknown[]) ?? b)] : (o[k] ?? b);
  }
  return out as T;
}

/**
 * The full set of colors for a choice. `base` is Night Watch. The lantern (`status.working`) and
 * the current search match follow the accent. Night Watch with Lantern gives `base` unchanged.
 */
/** `#RRGGBB` as `rgba(r,g,b,alpha)`: the accent tints follow the accent. */
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha.toFixed(2)})`;
}

export function buildColors(base: Colors, choice: ThemeChoice): Colors {
  const a = accentDef(choice.accent);
  const themed = merge(base, themeDef(choice.theme).colors);
  return merge(themed, {
    accent: a.accent,
    accentPressed: a.accentPressed,
    onAccent: a.onAccent,
    accentTint: tint(a.accent, 0.12),
    hintFill: tint(a.accent, 0.1),
    hintEdge: tint(a.accent, 0.35),
    status: { working: a.accent, ...(a.blocked ? { blocked: a.blocked.color } : {}) },
    ...(a.blocked ? { blockedTint: a.blocked.tint } : {}),
    search: { matchBg: a.matchBg, currentBg: a.accent, currentFg: a.onAccent },
  });
}
