import * as Notifications from "expo-notifications";
import { usePathname, useRootNavigationState, useRouter, type Href } from "expo-router";
import { useEffect, useRef } from "react";

import { useLayoutClass } from "@/ui/layout";

/** The `{hostId, paneId}` of a push's data, or null when the data has another shape. */
function pushPane(data: unknown): { hostId: string; paneId: string } | null {
  if (typeof data !== "object" || data === null) return null;
  const { hostId, paneId } = data as { hostId?: unknown; paneId?: unknown };
  if (typeof hostId !== "string" || typeof paneId !== "string" || !hostId || !paneId) return null;
  return { hostId, paneId };
}

/** The session route for a push's data `{hostId, paneId}`, or null when the data has another shape. */
export function notificationTarget(data: unknown): string | null {
  const p = pushPane(data);
  return p ? `/session/${encodeURIComponent(p.hostId)}/${encodeURIComponent(p.paneId)}?from=push` : null;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** True when `pathname` (encoded or not) is the session screen of the push's pane. */
export function isPushSession(pathname: string | undefined, data: unknown): boolean {
  const p = pushPane(data);
  if (!p || !pathname) return false;
  const parts = pathname.split("?")[0].split("/").filter(Boolean).map(decode);
  return parts.length === 3 && parts[0] === "session" && parts[1] === p.hostId && parts[2] === p.paneId;
}

/**
 * The Overview route for a push's data in the two-column layout: the pane in the detail column.
 * Null when the data has another shape.
 */
export function columnTarget(data: unknown): Href | null {
  const p = pushPane(data);
  return p ? { pathname: "/", params: { host: p.hostId, pane: p.paneId, from: "push" } } : null;
}

/** The current route, for the foreground notification handler (it runs outside React). */
let currentPath: string | undefined;
/** The pane in the detail column while Overview has the focus (regular width), else null. */
let columnPane: { hostId: string; paneId: string } | null = null;

/** Overview calls this when the pane in its detail column changes. */
export function setColumnPane(p: { hostId: string; paneId: string } | null): void {
  columnPane = p;
}

/** True when the detail column shows the push's pane. */
function isColumnSession(data: unknown): boolean {
  const p = pushPane(data);
  return !!p && !!columnPane && columnPane.hostId === p.hostId && columnPane.paneId === p.paneId;
}

/** Foreground pushes show no banner while the user looks at that session: the screen already shows (and speaks) it. */
export function showBannerFor(data: unknown): boolean {
  return !isPushSession(currentPath, data) && !isColumnSession(data);
}

/**
 * Opens the session screen of the pane a tapped push is about: for the push that launched
 * the app, and for each tap while it runs. Waits until the root navigator is mounted.
 * A tap for the session already on screen sets its `from` param instead of opening a second copy.
 */
export function useNotificationRouting(): void {
  const router = useRouter();
  const pathname = usePathname();
  const navReady = !!useRootNavigationState()?.key;
  const handled = useRef(new Set<string>());
  const path = useRef(pathname);
  path.current = pathname;
  currentPath = pathname;
  // Regular width opens the pane in the detail column of Overview, as a row tap does there.
  const layoutNow = useLayoutClass();
  const layout = useRef(layoutNow);
  layout.current = layoutNow;

  useEffect(() => {
    if (!navReady) return;
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const id = r.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);
      const data = r.notification.request.content.data;
      const target = notificationTarget(data);
      if (!target) return;
      if (isPushSession(path.current, data)) router.setParams({ from: "push" });
      else if (layout.current === "regular") router.navigate(columnTarget(data) ?? (target as Href));
      else router.navigate(target as Href);
    };
    open(Notifications.getLastNotificationResponse());
    Notifications.clearLastNotificationResponse();
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [navReady, router]);
}
