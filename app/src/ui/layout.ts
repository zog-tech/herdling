/**
 * The layout class of the window: "compact" (the phone layout) or "regular" (two columns on
 * Overview: the board and the selected session). The class comes from the window width, not from
 * the device, because Stage Manager and Split View give any window size.
 *
 * In regular width the selected session lives in the Overview route as the search params
 * `?host=<id>&pane=<id>`. In compact width it is the pushed route `session/[hostId]/[paneId]`.
 * `columnAction` is the one rule that moves a session between the two places.
 */
import { useWindowDimensions } from "react-native";

export type LayoutClass = "compact" | "regular";

/** The smallest window width, in points, that gets two columns. */
export const REGULAR_MIN_WIDTH = 700;

/** The width of the board column in the regular layout, in points. */
export const BOARD_COLUMN_WIDTH = 380;

/** The layout class for a window width in points. */
export function layoutClass(width: number): LayoutClass {
  return width >= REGULAR_MIN_WIDTH ? "regular" : "compact";
}

/** The layout class of the current window. It changes when the window changes size. */
export function useLayoutClass(): LayoutClass {
  const { width } = useWindowDimensions();
  return layoutClass(width);
}

/** One pane on one host. */
export type PaneRef = { hostId: string; paneId: string };

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The pane of a session route path (`/session/<host>/<pane>`), or null for any other path. */
export function sessionFromPath(pathname: string | undefined): PaneRef | null {
  if (!pathname) return null;
  const parts = pathname.split("?")[0].split("/").filter(Boolean).map(decode);
  if (parts.length !== 3 || parts[0] !== "session" || !parts[1] || !parts[2]) return null;
  return { hostId: parts[1], paneId: parts[2] };
}

/** The pane of the Overview selection params, or null when no pane is selected. */
export function selectionFromParams(params: { host?: unknown; pane?: unknown }): PaneRef | null {
  const { host, pane } = params;
  if (typeof host !== "string" || typeof pane !== "string" || !host || !pane) return null;
  return { hostId: host, paneId: pane };
}

/** The path of the Overview route. */
export const OVERVIEW_PATH = "/";

export type ColumnAction =
  /** Nothing to do. */
  | { type: "none" }
  /** Regular width with a session route on top: remove the route and select its pane in Overview. */
  | { type: "toColumn"; pane: PaneRef }
  /** Regular width became compact on Overview with a selection: push the session route of that pane. */
  | { type: "toRoute"; pane: PaneRef };

/**
 * What to do so that the session shows in the right place for the layout.
 *
 * - Regular width and the session route is on top (a row tap in compact width before a resize,
 *   a push, a deep link, a new session): show it in the detail column instead.
 * - The layout changed from regular to compact while Overview shows a selection: push the
 *   session route, so the session stays open.
 *
 * `previous` is the layout class at the last check; it is undefined at the first check.
 */
export function columnAction(
  layout: LayoutClass,
  previous: LayoutClass | undefined,
  pathname: string | undefined,
  selection: PaneRef | null,
): ColumnAction {
  if (layout === "regular") {
    const pane = sessionFromPath(pathname);
    return pane ? { type: "toColumn", pane } : { type: "none" };
  }
  if (previous === "regular" && pathname === OVERVIEW_PATH && selection) return { type: "toRoute", pane: selection };
  return { type: "none" };
}

/**
 * The key of the next item in `keys` after `current` (`step` 1) or before it (`step` -1).
 * With no current item, it is the first (or the last) key. It stops at the ends.
 */
export function stepKey(keys: readonly string[], current: string | undefined, step: 1 | -1): string | undefined {
  if (keys.length === 0) return undefined;
  const at = current === undefined ? -1 : keys.indexOf(current);
  if (at < 0) return step === 1 ? keys[0] : keys[keys.length - 1];
  return keys[Math.min(keys.length - 1, Math.max(0, at + step))];
}
