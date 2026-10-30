import * as Notifications from "expo-notifications";
import { useRootNavigationState, useRouter, type Href } from "expo-router";
import { useEffect, useRef } from "react";

/** The session route for a push's data `{hostId, paneId}`, or null when the data has another shape. */
export function notificationTarget(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const { hostId, paneId } = data as { hostId?: unknown; paneId?: unknown };
  if (typeof hostId !== "string" || typeof paneId !== "string" || !hostId || !paneId) return null;
  return `/session/${encodeURIComponent(hostId)}/${encodeURIComponent(paneId)}?from=push`;
}

/**
 * Opens the session screen of the pane a tapped push is about: for the push that launched
 * the app, and for each tap while it runs. Waits until the root navigator is mounted.
 */
export function useNotificationRouting(): void {
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!navReady) return;
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const id = r.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);
      const target = notificationTarget(r.notification.request.content.data);
      if (target) router.push(target as Href);
    };
    open(Notifications.getLastNotificationResponse());
    Notifications.clearLastNotificationResponse();
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [navReady, router]);
}
