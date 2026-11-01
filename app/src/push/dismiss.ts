import * as Notifications from "expo-notifications";

/**
 * Removes the delivered notifications of one pane from the Notification Center and the Lock Screen.
 * The app calls it when the user opens the session of the pane and after an answer from the
 * notification buttons, so a notification that the user handled does not stay.
 * herdlingd puts `hostId` and `paneId` in the push data. expo-notifications is in every build.
 */

export type DismissDeps = {
  presented: () => Promise<Notifications.Notification[]>;
  dismiss: (identifier: string) => Promise<void>;
};

const defaultDeps: DismissDeps = {
  presented: () => Notifications.getPresentedNotificationsAsync(),
  dismiss: (id) => Notifications.dismissNotificationAsync(id),
};

/** True when the data of a notification has this `hostId` and `paneId`. */
export function isPaneNotification(data: unknown, hostId: string, paneId: string): boolean {
  if (typeof data !== "object" || data === null) return false;
  const d = data as { hostId?: unknown; paneId?: unknown };
  return d.hostId === hostId && d.paneId === paneId;
}

/**
 * Dismisses each delivered notification of the pane `paneId` on the host `hostId`.
 * Returns the number of notifications it dismissed. Never throws.
 */
export async function dismissPaneNotifications(hostId: string, paneId: string, deps: DismissDeps = defaultDeps): Promise<number> {
  if (!hostId || !paneId) return 0;
  try {
    const ids = (await deps.presented())
      .filter((n) => isPaneNotification(n.request.content.data, hostId, paneId))
      .map((n) => n.request.identifier);
    const results = await Promise.allSettled(ids.map((id) => deps.dismiss(id)));
    return results.filter((r) => r.status === "fulfilled").length;
  } catch (e) {
    console.warn("[push] dismiss failed:", e instanceof Error ? e.message : String(e));
    return 0;
  }
}
