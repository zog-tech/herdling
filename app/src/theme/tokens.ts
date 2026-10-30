export const colors = {
  bg: "#0F172A",
  card: "#1B2336",
  muted: "#272F42",
  border: "#475569",
  text: "#F8FAFC",
  textMuted: "#94A3B8",
  accent: "#22C55E",
  danger: "#EF4444",
  status: {
    working: "#60A5FA",
    blocked: "#F59E0B",
    idle: "#22C55E",
    done: "#22C55E",
    unknown: "#94A3B8",
  },
  /** Terminal view: screen background and default text color. */
  terminal: {
    bg: "#0F172A",
    fg: "#E2E8F0",
  },
  /** ANSI 16-color palette: 0–7 normal (black, red, green, yellow, blue, magenta, cyan, white), 8–15 bright. */
  ansi: [
    "#334155",
    "#EF4444",
    "#22C55E",
    "#EAB308",
    "#3B82F6",
    "#A855F7",
    "#06B6D4",
    "#CBD5E1",
    "#64748B",
    "#F87171",
    "#4ADE80",
    "#FACC15",
    "#60A5FA",
    "#C084FC",
    "#22D3EE",
    "#F8FAFC",
  ],
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const type = {
  size: { caption: 12, small: 14, body: 16, title: 20, heading: 28 },
  lineHeight: { body: 1.5 },
} as const;

/** Minimum touch target in points. */
export const hitTarget = 44;
