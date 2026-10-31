import { NativeModule, requireOptionalNativeModule } from "expo";

/** An image pasted from the edit menu: JPEG, base64 without a data: prefix, size in pixels. */
export type PastedImage = { base64: string; width: number; height: number };

type PasteEvents = { onPasteImage: (e: PastedImage) => void };

declare class PasteNativeModule extends NativeModule<PasteEvents> {}

// Builds 6 and older do not have this module. An OTA update must not crash them.
const Paste = requireOptionalNativeModule<PasteNativeModule>("HerdlingPaste");

/**
 * True when the edit menu of a multiline input can paste an image ("Paste" shows for an image).
 * False on older builds: they paste with a button.
 */
export const hasNativePaste = Paste != null;

/**
 * Calls `cb` for each image pasted from the edit menu. Returns a function that stops it.
 * While no listener is on, the native hook does nothing and "Paste" does not show for an image.
 */
export function addPasteImageListener(cb: (e: PastedImage) => void): () => void {
  if (!Paste) return () => {};
  const sub = Paste.addListener("onPasteImage", cb);
  return () => sub.remove();
}
