/**
 * Loads `react-native-webview` only when the build has it. Builds before the browser preview do
 * not have the native part, and its JavaScript asks for the native module when it loads. So an
 * OTA update must not import it at the top of a file.
 */
import type { ComponentType, Ref } from "react";
import { TurboModuleRegistry } from "react-native";
import type { WebViewProps } from "react-native-webview";

/** The parts of the web view handle that the preview screen calls. */
export type WebViewHandle = { goBack(): void; goForward(): void; reload(): void };

export type WebViewComponent = ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

let loaded: WebViewComponent | null | undefined;

/** True when the build has the web view. */
export function hasWebView(): boolean {
  return TurboModuleRegistry.get("RNCWebViewModule") != null;
}

/** The `WebView` component, or null when the build does not have it. */
export function loadWebView(): WebViewComponent | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  if (!hasWebView()) return null;
  try {
    loaded = (require("react-native-webview") as typeof import("react-native-webview")).WebView as unknown as WebViewComponent;
  } catch {
    loaded = null;
  }
  return loaded;
}
