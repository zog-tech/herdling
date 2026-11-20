import { Platform, Share } from "react-native";

import type { Shown } from "./viewerMachine";

/** A name that is safe in a cache file name: the chars of the original, others as `_`. */
export function cacheName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return clean.slice(-64) || "file";
}

/** The data URI of a loaded image. */
export function imageUri(file: Shown): string | undefined {
  return file.kind === "image" && file.data_b64 ? `data:${file.mime};base64,${file.data_b64}` : undefined;
}

/**
 * Opens the system share sheet for the file on screen. iOS shares an image as a file: it is
 * written to the cache with expo-file-system (in every build). React Native's `Share` on Android
 * takes only text, so Android shares the path of the image on the computer. A text file shares
 * its text; another file shares its path.
 */
export async function shareShown(file: Shown): Promise<void> {
  if (file.kind === "image" && file.data_b64 && Platform.OS === "ios") {
    const { File, Paths } = require("expo-file-system") as typeof import("expo-file-system");
    const out = new File(Paths.cache, `herdling-share-${Date.now()}-${cacheName(file.name)}`);
    await out.write(file.data_b64, { encoding: "base64" });
    await Share.share({ url: out.uri });
    return;
  }
  if (file.kind === "text") {
    await Share.share({ message: file.text, title: file.name });
    return;
  }
  await Share.share({ message: file.path });
}
