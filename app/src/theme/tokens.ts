/**
 * "Night Watch" palette: warm blacks, graphite, ivory text and one lantern gold.
 * Gold is scarce: only the primary action, the "working" lantern, and focus or selected state.
 * Contrast (WCAG) measured on `bg` #0A0A0B / `card` #141416 / `raised` #1C1C1F:
 * text 17.7 / 16.5 / 15.2, textMuted 7.4 / 6.9 / 6.4, border 3.7 / 3.5 / 3.2, edge 3.2 on bg.
 */
export const colors = {
  /** The night field: the page. */
  bg: "#0A0A0B",
  card: "#141416",
  /** Raised fill (bubbles, icon tiles, the pressed row). Not an edge of a control. */
  raised: "#1C1C1F",
  /**
   * One step above `raised`: the selected pill of a segmented control on a `raised` track.
   * text 13.9:1, textMuted 5.3:1 on it.
   */
  raisedHigh: "#2C2B2F",
  /** Below the page: terminal and code blocks. */
  sunken: "#070708",
  /** Lines that only group content (dividers, table rules). Not an edge of a control. */
  divider: "#2A2A2E",
  /** 1 pt top highlight of a card, like brushed metal under a lantern. */
  hairline: "rgba(255,255,255,0.06)",
  /** Edges of controls (inputs, outline buttons): 3.7:1 on bg, 3.5:1 on card, 3.2:1 on raised. */
  border: "#706B62",
  /** Edge of tappable cards: 3.2:1 against the page around them, quieter than `border`. */
  edge: "#64605A",
  /** Warm ivory, not pure white. */
  text: "#F5F2EA",
  /** Warm stone. 6.9:1 on card. */
  textMuted: "#A39E93",
  /** Lantern gold: the primary action and the selected state. 8.4:1 on card. */
  accent: "#D4A857",
  /** A pressed gold control. `onAccent` on it is 6.7:1. */
  accentPressed: "#B8903F",
  /** Text and icons on gold and on other status fills: 9.0:1 on accent. */
  onAccent: "#0A0A0B",
  /** Links in replies: ivory with an underline, so gold stays scarce. */
  link: "#F5F2EA",
  /** 4.7:1 on card; always with an icon or a label. */
  danger: "#E5484D",
  /**
   * Modal backdrop. Measured: at 0.6 the text behind drops to 3.3:1, so it no longer competes
   * with the sheet (at 0.5 it is 4.7:1, still readable as content).
   */
  scrim: "rgba(0,0,0,0.6)",
  /**
   * Fill of a glass control where Liquid Glass is not available (iOS 17 to 25): `raised` at 92%.
   * Text and icons on it keep the `raised` ratios (text 15.2:1, textMuted 6.4:1).
   */
  glassFallback: "rgba(28,28,31,0.92)",
  /**
   * The tint of a Board row that needs you: ember at 8% over `bg` (about #1C120E).
   * Measured on it: text 15.9:1, textMuted 6.7:1, ember 5.9:1.
   */
  blockedTint: "rgba(232,121,74,0.08)",
  /** Every status also has its own icon and label; color is never the only cue. */
  status: {
    /** The lantern: lit while work happens. Same gold as `accent`. 8.4:1 on card. */
    working: "#D4A857",
    /** Ember: the agent needs you. 6.4:1 on card. */
    blocked: "#E8794A",
    /** Calm stone: an idle agent needs nothing. 6.9:1 on card. */
    idle: "#A39E93",
    /** Pasture sage: finished work. 7.9:1 on card. */
    done: "#8DB580",
    /** Dimmer stone; its icon is a question mark. 5.0:1 on card. */
    unknown: "#8A857B",
  },
  /**
   * Diff view (`git.diff`) on `sunken`. Every line also keeps its "+" or "-" sign, so color is never
   * the only cue. Measured: `add` 7.5:1 on `addBg`, `del` 6.8:1 on `delBg`, `terminal.fg` 13.5:1 or more on both.
   */
  diff: {
    /** Pasture sage (`status.done`) at 12% over `sunken`. */
    addBg: "#171C16",
    /** `danger` at 12% over `sunken`. */
    delBg: "#220F10",
    /** The sign and text of an added line. */
    add: "#8DB580",
    /** The sign and text of a deleted line: a lighter `danger`, for contrast on `delBg`. */
    del: "#F07A7E",
  },
  /**
   * Search matches. The current match is the selected state: gold with `onAccent` text (9.0:1).
   * Other matches: a dim gold fill with `terminal.fg` text (7.0:1).
   */
  search: {
    matchBg: "#5A4721",
    matchFg: "#E8E3D8",
    currentBg: "#D4A857",
    currentFg: "#0A0A0B",
  },
  /**
   * The letter mark of an agent kind (`ui/AgentMark`) on a `raised` tile. Muted tints, never gold
   * and never the ember of "needs you". The name is always next to the mark, so the tint is
   * never the only cue. On `raised`: claude 8.4:1, codex 15.2:1, pi 7.6:1, opencode 9.2:1,
   * omp 8.1:1, gemini 7.0:1, other 6.4:1.
   */
  agent: {
    claude: "#E3A98C",
    codex: "#F5F2EA",
    pi: "#B9A3E3",
    opencode: "#9FC7C0",
    omp: "#D7A3C9",
    gemini: "#7FA7F0",
    other: "#A39E93",
  },
  /** Terminal view: screen background and default text color (15.7:1). */
  terminal: {
    bg: "#070708",
    fg: "#E8E3D8",
  },
  /**
   * ANSI 16-color palette: 0–7 normal (black, red, green, yellow, blue, magenta, cyan, white), 8–15 bright.
   * Black and white entries are warmed. On `sunken` every entry but black is 4.2:1 or more.
   */
  ansi: [
    "#3D3935",
    "#EF4444",
    "#22C55E",
    "#EAB308",
    "#3B82F6",
    "#A855F7",
    "#06B6D4",
    "#D6D0C4",
    "#77726A",
    "#F87171",
    "#4ADE80",
    "#FACC15",
    "#60A5FA",
    "#C084FC",
    "#22D3EE",
    "#F5F2EA",
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
  /** The one large number at the top of the Board. Tabular figures, tight tracking. */
  display: { size: 44, weight: "700", maxScale: 1.3, letterSpacing: -1 },
  /** Tight tracking at large sizes. */
  largeTitle: { size: 28, weight: "700", maxScale: 1.6, letterSpacing: -0.4 },
  title: { size: 20, weight: "600", maxScale: 2 },
  /** The title of a list row (an agent on the Board): iOS "headline". */
  headline: { size: 17, weight: "600", maxScale: 2 },
  body: { size: 16, weight: "400", maxScale: 3 },
  callout: { size: 14, weight: "400", maxScale: 2.5 },
  caption: { size: 12, weight: "400", maxScale: 2 },
  mono: { size: 13, weight: "400", maxScale: 2 },
  /** Section header: small caps style, uppercase, in `textMuted`. */
  section: { size: 12, weight: "600", maxScale: 1.6, letterSpacing: 0.8 },
} as const;

/** Caps for dense rows: card pills, chips, header labels. */
export const denseScale = { pill: 1.4, row: 1.6 } as const;

/** A status dot (dot + word replaces the outlined pill). */
export const dot = { size: 8 } as const;

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
  /** Voice input: the "Transcribing…" shimmer crosses the bar once in this time (linear, looped). */
  shimmerMs: 1200,
  /** Reduce Motion: the "Transcribing…" text fades between full and this opacity instead. */
  shimmerDim: 0.45,
  /** A raised control (a menu row, a key, a chip): scale and fill on press. */
  raisedPressMs: 120,
  /** The send button: gold fades in when there is text, and it dips on press. */
  send: { fadeMs: 150, pressScale: 0.94 },
  /**
   * The lantern glow behind a working status icon. One breath (0.35 → 0.7 → 0.35) takes `periodMs`.
   * When work stops it fades out in `fadeOutMs`. Reduce Motion: static at `still`.
   */
  lantern: { periodMs: 2400, min: 0.35, max: 0.7, still: 0.5, fadeOutMs: 400, sizeRatio: 2.4 },
  /** Board: the cards enter once per app launch, one after the other. */
  boardEnter: { stepMs: 40, maxCards: 8, durationMs: 260, rise: 8 },
  /** "Needs you": the ember edge of a card glows once when it starts. */
  emberPulseMs: 600,
  /** Thread: a new item at the bottom fades and rises into place. */
  arrive: { durationMs: 200, rise: 6 },
  /** The state line of a queued prompt crossfades on a change. */
  crossfadeMs: 150,
  /** The Thread/Terminal pill slides to the selected segment. */
  segment: { duration: 300, dampingRatio: 1 },
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
  focusRing: { width: 2, color: colors.accent },
  /** A pressed raised control: scale plus the `raised` fill. */
  pressedScale: 0.97,
  /**
   * A light layer under the pointer (iPad trackpad or mouse): ivory at 5%, a little lighter than
   * the pressed layer. Text keeps its contrast on it.
   */
  hoverFill: "rgba(245,242,234,0.05)",
  /**
   * The selected Board row in the two-column layout (the session on the right): ivory at 8%.
   * A gold marker at the left edge also marks it.
   */
  selectedFill: "rgba(245,242,234,0.08)",
} as const;

/**
 * Elevation on dark: depth by light, not shadow. Each step up is a lighter fill plus a 1 pt edge;
 * a card also has a 1 pt top highlight (`colors.hairline`, see `ui/TopHighlight`).
 * 0 page, 1 card and sheet, 2 raised control on a card.
 */
export const elevation = {
  0: { backgroundColor: colors.bg },
  1: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.divider },
  2: { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
  /** A tappable card: level 1 with an edge that passes 3:1. */
  tappable: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.edge },
} as const;

/** Icon sizes (lucide) in points. `header` matches the icons of a screen header row. */
export const icon = { sm: 16, md: 20, header: 22, lg: 24, strokeWidth: 2 } as const;
