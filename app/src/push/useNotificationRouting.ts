import * as Notifications from "expo-notifications";
import { usePathname, useRootNavigationState, useRouter, type Href } from "expo-router";
import { useEffect, useRef } from "react";

import { answerChoiceTap, choiceTap } from "./choiceActions";

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

/** The current route, for the foreground notification handler (it runs outside React). */
let currentPath: string | undefined;

/** Foreground pushes show no banner while the user looks at that session: the screen already shows (and speaks) it. */
export function showBannerFor(data: unknown): boolean {
  return !isPushSession(currentPath, data);
}

/**
 * Opens the session screen of the pane a tapped push is about: for the push that launched
 * the app, and for each tap while it runs. Waits until the root navigator is mounted.
 * A tap for the session already on screen sets its `from` param instead of opening a second copy.
 * A tap on the Yes or No button of a "needs you" push also answers the menu (`pane.answer`).
 */
export function useNotificationRouting(): void {
  const router = useRouter();
  const pathname = usePathname();
  const navReady = !!useRootNavigationState()?.key;
  const handled = useRef(new Set<string>());
  const path = useRef(pathname);
  path.current = pathname;
  currentPath = pathname;

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
      else router.navigate(target as Href);
      const tap = choiceTap(r.actionIdentifier, data);
      if (tap) void answerChoiceTap(tap);
    };
    open(Notifications.getLastNotificationResponse());
    Notifications.clearLastNotificationResponse();
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [navReady, router]);
}
