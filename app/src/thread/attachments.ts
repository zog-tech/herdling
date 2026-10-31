import type { FilePut } from "@herdling/protocol";
import { requireOptionalNativeModule } from "expo";

import type { RpcClient } from "@/rpc/RpcClient";

/** Most photos on one prompt. */
export const MAX_PHOTOS = 4;
/** Most attachments (photos and files together) on one prompt. */
export const MAX_ATTACHMENTS = 6;
/**
 * Largest file the app sends. A current herdlingd takes up to 25 MiB (`files.put`); an older one takes
 * 10 MiB and answers `too_large` for a larger file.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** JPEG quality the picker uses. */
export const PHOTO_QUALITY = 0.8;
/** Bound for one `files.put` call. A large photo over a slow link takes a while. */
const UPLOAD_TIMEOUT_MS = 60_000;
/** Bound for one `files.put` of a document, which can be up to 25 MiB. */
const FILE_UPLOAD_TIMEOUT_MS = 180_000;

/**
 * True when this binary has the photo picker. Builds before the picker was added do not, and an
 * over-the-air update must not crash them, so the picker module loads only on use.
 */
export function photosAvailable(): boolean {
  return requireOptionalNativeModule("ExponentImagePicker") != null;
}

/**
 * True when this binary has the clipboard module. Older builds do not, so the paste row
 * hides there instead of crashing. Builds with the native paste hook do not use it.
 */
export function clipboardAvailable(): boolean {
  return requireOptionalNativeModule("ExpoClipboard") != null;
}

/**
 * True when this binary has the document picker. Builds before it was added do not, and an
 * over-the-air update must not crash them, so "Attach file" hides there and the module loads only on use.
 */
export function documentsAvailable(): boolean {
  return requireOptionalNativeModule("ExpoDocumentPicker") != null;
}

/** A picked photo, ready to upload. */
export type Photo = { uri: string; name: string; base64: string; kind?: "photo" };

/** A picked document (text, code, a log, PDF, JSON, CSV, zip, ...). Its data is read only at upload. */
export type DocFile = { kind: "file"; uri: string; name: string; size?: number; mime?: string };

/** A photo or a file on the next prompt. */
export type Attachment = Photo | DocFile;

export const isFile = (a: Attachment): a is DocFile => a.kind === "file";

/** How many more photos fit: at most `MAX_PHOTOS` photos and `MAX_ATTACHMENTS` items in all. */
export function photoRoom(items: readonly Attachment[]): number {
  const photos = items.filter((a) => !isFile(a)).length;
  return Math.max(0, Math.min(MAX_PHOTOS - photos, MAX_ATTACHMENTS - items.length));
}

/** How many more files fit. */
export function fileRoom(items: readonly Attachment[]): number {
  return Math.max(0, MAX_ATTACHMENTS - items.length);
}

/** "12 KB", "3.4 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The result of a document pick: the files to attach, and the names of files that are too large. */
export type PickedFiles = { files: DocFile[]; tooLarge: string[] };

/**
 * Opens the system file picker for up to `max` files of any type. Returns no files when the user
 * cancels or when this binary has no picker. A file over `MAX_FILE_BYTES` is left out and named in `tooLarge`.
 */
export async function pickFiles(max: number): Promise<PickedFiles> {
  if (max <= 0 || !documentsAvailable()) return { files: [], tooLarge: [] };
  const DocumentPicker = require("expo-document-picker") as typeof import("expo-document-picker");
  const r = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: true, copyToCacheDirectory: true });
  if (r.canceled) return { files: [], tooLarge: [] };
  const tooLarge: string[] = [];
  const files: DocFile[] = [];
  for (const a of r.assets) {
    if (a.size != null && a.size > MAX_FILE_BYTES) {
      tooLarge.push(a.name);
      continue;
    }
    files.push({ kind: "file", uri: a.uri, name: a.name || `file-${files.length + 1}`, size: a.size, mime: a.mimeType });
  }
  return { files: files.slice(0, max), tooLarge };
}

/** Reads a picked file as base64 with expo-file-system (present in every build). */
async function readBase64(uri: string): Promise<string> {
  const { File } = require("expo-file-system") as typeof import("expo-file-system");
  return new File(uri).base64();
}

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

/**
 * Reads the clipboard image as JPEG. Call it only on a user tap: iOS shows the paste prompt here.
 * Only for builds without the native paste hook (modules/paste).
 * `index` is the 1-based number for the file name. Returns undefined when no image is there.
 */
export async function pasteImage(index: number): Promise<Photo | undefined> {
  if (!clipboardAvailable()) return undefined;
  const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
  const img = await Clipboard.getImageAsync({ format: "jpeg", jpegQuality: PHOTO_QUALITY });
  const base64 = img?.data.replace(/^data:[^,]*,/, "");
  if (!img || !base64) return undefined;
  return { uri: img.data.startsWith("data:") ? img.data : `data:image/jpeg;base64,${base64}`, name: `pasted-${index}.jpg`, base64 };
}

/** `IMG_1.HEIC` → `IMG_1.jpg`; no name → `photo-<n>.jpg`. The data is JPEG after the picker. */
export function jpegName(fileName: string | null | undefined, index: number): string {
  const base = fileName?.replace(/\.[^.]*$/, "").trim();
  return `${base || `photo-${index + 1}`}.jpg`;
}

/**
 * Uploads each attachment with `files.put`, in order. `progress(done)` runs after each one. Throws on
 * the first failure. `read` gives the base64 data of a file (a test passes its own).
 */
export async function uploadPhotos(
  rpc: RpcClient,
  items: Attachment[],
  progress?: (done: number) => void,
  read: (uri: string) => Promise<string> = readBase64,
): Promise<string[]> {
  const paths: string[] = [];
  for (const a of items) {
    const data = isFile(a) ? await read(a.uri) : a.base64;
    const r = await rpc.call<FilePut>("files.put", { name: a.name, data_b64: data }, isFile(a) ? FILE_UPLOAD_TIMEOUT_MS : UPLOAD_TIMEOUT_MS);
    paths.push(r.path);
    progress?.(paths.length);
  }
  return paths;
}

/** The prompt text, then each path on its own line. The agents read the files at these paths. */
export function withPaths(text: string, paths: string[]): string {
  const body = text.trimEnd();
  return [...(body ? [body] : []), ...paths].join("\n");
}
