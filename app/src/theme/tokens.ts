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
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const type = {
  size: { caption: 12, small: 14, body: 16, title: 20, heading: 28 },
  lineHeight: { body: 1.5 },
} as const;

/** Minimum touch target in points. */
export const hitTarget = 44;
