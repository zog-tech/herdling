/**
 * Copy for screens that must work when the build has no clipboard module. The check reads the
 * native module registry before `expo-clipboard` loads.
 */
import { requireOptionalNativeModule } from "expo";

/** True when the build has the clipboard module. */
export function hasClipboard(): boolean {
  return requireOptionalNativeModule("ExpoClipboard") != null;
}

/** Copies the text when the build has the clipboard module. False when it does not. */
export function copyIfAvailable(text: string): boolean {
  if (!hasClipboard()) return false;
  const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
  void Clipboard.setStringAsync(text);
  return true;
}
