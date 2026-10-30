import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "zogssh.expo_token";

let cached: string | undefined;
let inflight: Promise<string | null> | undefined;

function projectId(): string | null {
  const id = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  return typeof id === "string" && id ? id : null;
}

async function lastGoodToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
}

async function fetchToken(): Promise<string | null> {
  const id = projectId();
  if (!id) return null;
  let perm: Notifications.NotificationPermissionsStatus;
  try {
    perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  } catch (e) {
    console.warn("[push] permission check failed:", e instanceof Error ? e.message : String(e));
    return lastGoodToken();
  }
  if (!perm.granted) {
    // A real denial: the companion must stop sending to the old token.
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    return null;
  }
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    cached = data;
    await SecureStore.setItemAsync(TOKEN_KEY, data).catch(() => {});
    return data;
  } catch (e) {
    // A transient failure (no network, simulator) keeps the last good token, so pushes do not stop.
    console.warn("[push] no push token:", e instanceof Error ? e.message : String(e));
    return lastGoodToken();
  }
}

/**
 * This phone's Expo push token. Asks for notification permission the first time; concurrent
 * callers share one request. Null when permission is denied or the EAS project id is missing.
 * When the token request fails for another reason, gives the last good token (or null if none).
 */
export function getExpoToken(): Promise<string | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchToken().finally(() => {
      inflight = undefined;
    });
  }
  return inflight;
}
