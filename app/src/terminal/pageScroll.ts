/**
 * Page Up and Page Down for a full-screen app in a pane (Claude Code in fullscreen mode, less,
 * vim). Such an app draws on the alternate screen, so herdr keeps no scrollback for it and
 * `pane.read` gives only the visible screen. The phone has nothing to scroll, so it sends the
 * page keys to the app, and the app scrolls itself.
 */

/**
 * The bytes that a terminal sends for Page Up and Page Down (VT220 sequences).
 * herdr `pane.send_keys` (0.9.x) does not accept page keys, so the app types these bytes as
 * text. herdr writes the text as it is, also when the app turned on bracketed paste.
 */
export const PAGE_TEXT = { up: "\x1b[5~", down: "\x1b[6~" } as const;

export type PageDirection = keyof typeof PAGE_TEXT;

/**
 * True when the content is taller than the view, so the phone can scroll it.
 * Undefined until both heights are known.
 */
export function overflows(contentHeight: number | undefined, viewHeight: number | undefined): boolean | undefined {
  if (contentHeight === undefined || viewHeight === undefined || viewHeight <= 0) return undefined;
  // One point of slack: rounding must not count as overflow.
  return contentHeight > viewHeight + 1;
}

/** The `scroll` field of a herdr pane (`pane.get`). */
export type PaneScroll = { max_offset_from_bottom: number; viewport_rows: number };

/** The `scroll` field of a `pane.get` result, when it has the expected shape. */
export function paneScroll(result: unknown): PaneScroll | undefined {
  const s = (result as { pane?: { scroll?: Record<string, unknown> } } | null)?.pane?.scroll;
  if (!s || typeof s.max_offset_from_bottom !== "number" || typeof s.viewport_rows !== "number") return undefined;
  return { max_offset_from_bottom: s.max_offset_from_bottom, viewport_rows: s.viewport_rows };
}

/**
 * True when the pane shows a full-screen app. Then herdr has no scrollback for the pane, and
 * the read screen fills every row (herdr cuts empty rows at the end of a shell screen).
 * A shell with a short screen gets false: Page Up there can type a "~" into the prompt.
 */
export function fullScreenApp(scroll: PaneScroll | undefined, screenLines: number): boolean {
  if (!scroll || scroll.viewport_rows <= 0) return false;
  return scroll.max_offset_from_bottom === 0 && screenLines >= scroll.viewport_rows;
}
