/**
 * Dark-first palette. Contrast (WCAG) is measured on `bg` #0F172A and `card` #1B2336:
 * text 17:1 / 15:1, textMuted 7.0:1 / 6.1:1, border 3.8:1 / 3.3:1, edge 3.3:1 on bg.
 */
export const colors = {
  bg: "#0F172A",
  card: "#1B2336",
  /** Raised fill (bubbles, icon tiles, the pressed row) and dividers. Not an edge of a control. */
  muted: "#272F42",
  /** Edges of controls (inputs, outline buttons): 3:1 or more on bg and card. */
  border: "#64748B",
  /** Edge of tappable cards: 3:1 against the page around them, quieter than `border`. */
  edge: "#5B6B82",
  text: "#F8FAFC",
  textMuted: "#94A3B8",
  accent: "#22C55E",
  danger: "#EF4444",
  /**
   * Modal backdrop. Measured: at 0.6 the text behind drops to 3.4:1, so it no longer competes
   * with the sheet (at 0.5 it was 4.7:1, still readable as content).
   */
  scrim: "rgba(0,0,0,0.6)",
  /** Every status also has its own icon and label; color is never the only cue. */
  status: {
    working: "#60A5FA",
    blocked: "#F59E0B",
    /** Calm slate: an idle agent needs nothing. 6.1:1 on card. */
    idle: "#94A3B8",
    /** Green: finished work. 6.9:1 on card. */
    done: "#22C55E",
    /** Dimmer than idle; its icon is a question mark. 4.5:1 on card. */
    unknown: "#7C8BA1",
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

/**
 * Text roles. All scale with Dynamic Type; `maxScale` caps the growth (`maxFontSizeMultiplier`)
 * where a larger size breaks a dense row. A dense row may pass a lower cap.
 */
export const textRole = {
  largeTitle: { size: 28, weight: "700", maxScale: 1.6 },
  title: { size: 20, weight: "600", maxScale: 2 },
  body: { size: 16, weight: "400", maxScale: 3 },
  callout: { size: 14, weight: "400", maxScale: 2.5 },
  caption: { size: 12, weight: "400", maxScale: 2 },
  mono: { size: 13, weight: "400", maxScale: 2 },
} as const;

/** Caps for dense rows: card pills, chips, header labels. */
export const denseScale = { pill: 1.4, row: 1.6 } as const;

/** Minimum touch target in points. */
export const hitTarget = 44;

/**
 * Motion tokens. Durations in ms. Springs use Reanimated's physics form (damping, stiffness).
 * Curves are cubic-bezier control points: build them with `cubicBezier(...)` at the use site.
 */
export const motion = {
  /** Press feedback on a card or a large control. */
  press: {
    /** Opacity fade of a pressed control. */
    fadeMs: 80,
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
    /** A control that grows while it is held (the mic while recording). */
    growScale: 1.08,
  },
  spring: {
    /** Snap back to rest after a press or a long press. */
    release: { damping: 15, stiffness: 220 },
    /** Sheet or drawer that follows a finger; add the gesture velocity. */
    sheet: { duration: 300, dampingRatio: 0.8 },
    /** Swipe back to rest after a drag. */
    swipe: { duration: 300, dampingRatio: 0.8 },
  },
  /** Small state changes (a chip, a toggle) and a sheet or menu that enters without a finger. */
  stateMs: 180,
  enterMs: 240,
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

/** Interaction states, layered on the base look. */
export const state = {
  /** Pressed icon or ghost control. */
  pressedOpacity: 0.6,
  /** Pressed filled button (the fill stays readable). */
  pressedFill: 0.85,
  /** Light layer over a pressed card (same as `motion.press.overlay`). */
  pressedOverlay: 0.04,
  disabledOpacity: 0.4,
  /** A host that is offline: its content stays readable but steps back. */
  offlineOpacity: 0.6,
  focusRing: { width: 2, color: "#F8FAFC" },
} as const;

/**
 * Elevation on dark: shadows do not show, so each step up is a lighter fill plus a 1 pt edge.
 * 0 page, 1 card and sheet, 2 raised control on a card.
 */
export const elevation = {
  0: { backgroundColor: colors.bg },
  1: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.muted },
  2: { backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
  /** A tappable card: level 1 with an edge that passes 3:1. */
  tappable: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.edge },
} as const;

/** Icon sizes (lucide) in points. `header` matches the icons of a screen header row. */
export const icon = { sm: 16, md: 20, header: 22, lg: 24, strokeWidth: 2 } as const;
