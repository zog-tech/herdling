export const colors = {
  bg: "#0F172A",
  card: "#1B2336",
  muted: "#272F42",
  border: "#475569",
  text: "#F8FAFC",
  textMuted: "#94A3B8",
  accent: "#22C55E",
  danger: "#EF4444",
  /** Modal backdrop. */
  scrim: "rgba(0,0,0,0.5)",
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

/**
 * Motion tokens. Durations in ms. Springs use Reanimated's physics form (damping, stiffness).
 * Curves are cubic-bezier control points: build them with `cubicBezier(...)` at the use site.
 */
export const motion = {
  /** Press feedback on a card or a large control. */
  press: {
    /** Scale when the finger lands. */
    scale: 0.98,
    /** Scale the hold moves toward while a long press charges. */
    holdScale: 0.96,
    /** Time to reach `scale`. */
    inMs: 100,
    /** Opacity of the light layer on a pressed card. */
    overlay: 0.04,
    /** Hold time before a long press fires. */
    longPressMs: 350,
  },
  spring: {
    /** Snap back to rest after a press or a long press. */
    release: { damping: 15, stiffness: 220 },
  },
  /** An exit takes this share of its enter time: leaving is faster than arriving. */
  exitRatio: 0.65,
  ease: {
    /** Strong ease-out for UI that enters or reacts. */
    out: [0.23, 1, 0.32, 1] as const,
    /** Movement that starts and ends on screen. */
    inOut: [0.77, 0, 0.175, 1] as const,
  },
  /** Status icon motion. */
  status: {
    /** One full turn of the working spinner (linear). */
    spinMs: 1000,
    /** Scale peak of the pop when work finishes, and of the pulse when the agent needs you. */
    popScale: 1.25,
    popInMs: 120,
    pulseScale: 1.2,
    pulseInMs: 150,
    pulseOutMs: 250,
  },
} as const;

/** Icon sizes (lucide) in points. `header` matches the icons of a screen header row. */
export const icon = { sm: 16, md: 20, header: 22, lg: 24, strokeWidth: 2 } as const;
