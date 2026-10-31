import * as Notifications from "expo-notifications";

import type { PushData } from "@herdling/protocol";

import { CHOICE_CATEGORY } from "@/push/choiceIds";
import { currentPrefs } from "@/push/prefs";
import { yesNo } from "@/thread/parseChoices";

import { DEMO_HOST_ID } from "./demoHost";
import type { DemoNotice } from "./scenario";

/**
 * Shows a demo notice as a local notification (no push server, no token).
 * Obeys the "Finished" and "Needs you" switches. Asks for permission once when the system allows it.
 * A tap opens the session, through the same routing as a push (`data: {hostId, paneId}`).
 * A "needs you" notice with a Yes and No menu gets the same buttons as a push from herdlingd.
 */
export async function showDemoNotice(n: DemoNotice): Promise<void> {
  if (!currentPrefs()[n.kind]) return;
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return;
    await Notifications.scheduleNotificationAsync({ content: demoContent(n), trigger: null });
  } catch (e) {
    console.warn("[demo] local notification failed:", e instanceof Error ? e.message : String(e));
  }
}

/** The notification content of a demo notice, with the choice buttons when the menu is Yes … No. */
export function demoContent(n: DemoNotice): Notifications.NotificationContentInput {
  const data: PushData = { hostId: DEMO_HOST_ID, paneId: n.paneId };
  const yn = n.kind === "needs_you" && n.choices ? yesNo(n.choices.map((label, i) => ({ key: String(i + 1), label, selected: i === 0 }))) : null;
  if (!yn) return { title: n.title, body: n.body, data };
  return {
    title: n.title,
    body: `${n.body}\n${yn.yes.label} · ${yn.no.label}`,
    data: { ...data, choice: { ...yn, revision: 0 } },
    categoryIdentifier: CHOICE_CATEGORY,
  };
}
