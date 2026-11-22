import { NativeModule, requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

/** An image pasted from the edit menu: JPEG, base64 without a data: prefix, size in pixels. */
export type PastedImage = { base64: string; width: number; height: number };

/**
 * A video pasted from the edit menu. On success `uri` is a file URI in the cache folder. On failure
 * `uri` is missing and `error` is "too_large" (with `size`) or a message. `duration` is in milliseconds.
 */
export type PastedVideo = { uri?: string; name: string; size: number; mime?: string; duration?: number; error?: string };

type PasteEvents = { onPasteImage: (e: PastedImage) => void; onPasteVideo: (e: PastedVideo) => void };

declare class PasteNativeModule extends NativeModule<PasteEvents> {
  /** Present from the build with video paste. */
  video?: boolean;
  setVideoMaxBytes?(maxBytes: number): void;
}

type VideoPasteEvents = { onPasteVideo: (e: PastedVideo) => void };

declare class VideoPasteNativeModule extends NativeModule<VideoPasteEvents> {
  attach(maxBytes: number): boolean;
  detach(): void;
}

// iOS: builds 6 and older do not have this module. An OTA update must not crash them.
const Paste = Platform.OS === "ios" ? requireOptionalNativeModule<PasteNativeModule>("HerdlingPaste") : null;
// Android: only builds with video paste have this module.
const VideoPaste = Platform.OS === "android" ? requireOptionalNativeModule<VideoPasteNativeModule>("HerdlingVideoPaste") : null;

/**
 * True when the edit menu of a multiline input can paste an image ("Paste" shows for an image).
 * False on older builds and on Android: they paste with a button.
 */
export const hasNativePaste = Paste != null;

/** True when the edit menu of the prompt box can paste a video. False on older builds: there the video picker still works. */
export const hasVideoPaste = Paste?.video === true || VideoPaste != null;

/**
 * Calls `cb` for each image pasted from the edit menu. Returns a function that stops it.
 * While no listener is on, the native hook does nothing and "Paste" does not show for an image.
 */
export function addPasteImageListener(cb: (e: PastedImage) => void): () => void {
  if (!Paste) return () => {};
  const sub = Paste.addListener("onPasteImage", cb);
  return () => sub.remove();
}

/**
 * Calls `cb` for each video pasted into the focused prompt box. Add it only while the box has the
 * focus: on Android the hook goes on the focused input. A video larger than `maxBytes` is not
 * copied (`error: "too_large"`). Returns a function that stops it.
 */
export function addPasteVideoListener(cb: (e: PastedVideo) => void, maxBytes: number): () => void {
  if (Paste?.video === true) {
    Paste.setVideoMaxBytes?.(maxBytes);
    const sub = Paste.addListener("onPasteVideo", cb);
    return () => sub.remove();
  }
  if (VideoPaste) {
    const sub = VideoPaste.addListener("onPasteVideo", cb);
    VideoPaste.attach(maxBytes);
    return () => {
      VideoPaste.detach();
      sub.remove();
    };
  }
  return () => {};
}
