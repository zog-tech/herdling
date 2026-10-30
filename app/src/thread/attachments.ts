import type { FilePut } from "@zogssh/protocol";
import { requireOptionalNativeModule } from "expo";

import type { RpcClient } from "@/rpc/RpcClient";

/** Most photos on one prompt. */
export const MAX_PHOTOS = 4;
/** JPEG quality the picker uses. */
export const PHOTO_QUALITY = 0.8;
/** Bound for one `files.put` call. A large photo over a slow link takes a while. */
const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * True when this binary has the photo picker. Builds before the picker was added do not, and an
 * over-the-air update must not crash them, so the picker module loads only on use.
 */
export function photosAvailable(): boolean {
  return requireOptionalNativeModule("ExponentImagePicker") != null;
}

/** A picked photo, ready to upload. */
export type Photo = { uri: string; name: string; base64: string };

/**
 * Opens the photo library for up to `max` images. Returns [] when the user cancels.
 * The picker gives JPEG data at `PHOTO_QUALITY` (HEIC photos are converted).
 */
export async function pickPhotos(max: number): Promise<Photo[]> {
  if (max <= 0 || !photosAvailable()) return [];
  const ImagePicker = require("expo-image-picker") as typeof import("expo-image-picker");
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: max,
    orderedSelection: true,
    quality: PHOTO_QUALITY,
    base64: true,
    exif: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (r.canceled) return [];
  return r.assets
    .filter((a) => !!a.base64)
    .slice(0, max)
    .map((a, i) => ({ uri: a.uri, name: jpegName(a.fileName, i), base64: a.base64! }));
}

/** `IMG_1.HEIC` → `IMG_1.jpg`; no name → `photo-<n>.jpg`. The data is JPEG after the picker. */
export function jpegName(fileName: string | null | undefined, index: number): string {
  const base = fileName?.replace(/\.[^.]*$/, "").trim();
  return `${base || `photo-${index + 1}`}.jpg`;
}

/** Uploads each photo with `files.put`, in order. `progress(done)` runs after each one. Throws on the first failure. */
export async function uploadPhotos(rpc: RpcClient, photos: Photo[], progress?: (done: number) => void): Promise<string[]> {
  const paths: string[] = [];
  for (const p of photos) {
    const r = await rpc.call<FilePut>("files.put", { name: p.name, data_b64: p.base64 }, UPLOAD_TIMEOUT_MS);
    paths.push(r.path);
    progress?.(paths.length);
  }
  return paths;
}

/** The prompt text, then each path on its own line. Claude Code reads image paths in a prompt. */
export function withPaths(text: string, paths: string[]): string {
  const body = text.trimEnd();
  return [...(body ? [body] : []), ...paths].join("\n");
}
