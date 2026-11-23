/**
 * The native side of "Share to Herdling": the `ExpoShareIntentModule` of `expo-share-intent`.
 *
 * iOS: the share extension copies what the user shares into the App Group, then opens
 * `herdling://dataUrl=herdlingShareKey#<type>`. `getShareIntent(url)` reads it and sends `onChange`.
 * Android: the main activity gets ACTION_SEND or ACTION_SEND_MULTIPLE. `getShareIntent("")` (at start
 * and when the app comes back) or a new intent sends `onChange`.
 *
 * Binaries before this feature do not have the module, and an over-the-air update must not crash
 * them. So the module loads with `requireOptionalNativeModule`, and every function does nothing without it.
 */
import { NativeModule, requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type ShareEvents = {
  onChange: (e: { value?: unknown }) => void;
  onError: (e: { value?: unknown }) => void;
};

declare class ShareIntentNativeModule extends NativeModule<ShareEvents> {
  getShareIntent(url: string): Promise<void>;
  clearShareIntent(key: string): void;
}

const Share = requireOptionalNativeModule<ShareIntentNativeModule>("ExpoShareIntentModule");

/** The App Group key of the shared data: `<scheme>ShareKey`. The extension writes it. */
export const SHARE_KEY = "herdlingShareKey";

/** True when this binary can receive shares. */
export const hasShareIntent = Share != null;

/** True for the URL that the iOS share extension opens. Other URLs are links into the app. */
export function isShareUrl(url: string | null | undefined): boolean {
  return !!url && /^[a-z][a-z0-9+.-]*:\/\/dataUrl=/i.test(url);
}

/**
 * Asks the module for the shared data. The data comes in the `onChange` event.
 * iOS needs the URL that the extension opened: any other URL comes back as a text share, so
 * other URLs are ignored. Android reads the intent of the activity and takes no URL.
 */
export function requestShare(url?: string | null): void {
  if (!Share) return;
  if (Platform.OS === "ios") {
    if (url && isShareUrl(url)) Share.getShareIntent(url).catch(() => {});
    return;
  }
  Share.getShareIntent("").catch(() => {});
}

/** Forgets the shared data on the native side, so it does not come again. */
export function clearShare(): void {
  try {
    Share?.clearShareIntent(SHARE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Calls `onValue` with the raw value of each share and `onError` with a native error. Returns a function that stops it. */
export function addShareListener(onValue: (value: unknown) => void, onError: (message: string) => void): () => void {
  if (!Share) return () => {};
  const a = Share.addListener("onChange", (e) => onValue(e?.value));
  const b = Share.addListener("onError", (e) => onError(String(e?.value ?? "unknown error")));
  return () => {
    a.remove();
    b.remove();
  };
}
