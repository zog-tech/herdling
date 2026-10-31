import * as Notifications from "expo-notifications";

import { currentPrefs } from "@/push/prefs";

import { DEMO_HOST_ID } from "./demoHost";
import type { DemoNotice } from "./scenario";

/**
 * Shows a demo notice as a local notification (no push server, no token).
 * Obeys the "Finished" and "Needs you" switches. Asks for permission once when the system allows it.
 * A tap opens the session, through the same routing as a push (`data: {hostId, paneId}`).
 */
export async function showDemoNotice(n: DemoNotice): Promise<void> {
  if (!currentPrefs()[n.kind]) return;
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: n.title, body: n.body, data: { hostId: DEMO_HOST_ID, paneId: n.paneId } },
      trigger: null,
    });
  } catch (e) {
    console.warn("[demo] local notification failed:", e instanceof Error ? e.message : String(e));
  }
}
