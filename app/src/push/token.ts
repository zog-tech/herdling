import Constants from "expo-constants";
import * as Notifications from "expo-notifications";

let cached: string | undefined;

/**
 * This phone's Expo push token. Asks for notification permission the first time.
 * Null when permission is denied, the EAS project id is missing, or the token request fails
 * (for example on a simulator).
 */
export async function getExpoToken(): Promise<string | null> {
  if (cached) return cached;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  if (typeof projectId !== "string" || !projectId) return null;
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    cached = data;
    return data;
  } catch (e) {
    console.warn("[push] no push token:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
