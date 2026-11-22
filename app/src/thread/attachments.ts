import type { FilePut, FilePutBegin, Hello } from "@herdling/protocol";
import { requireOptionalNativeModule } from "expo";
import { Keyboard } from "react-native";

import { listsMethod } from "@/hosts/methods";
import type { RpcClient } from "@/rpc/RpcClient";
import { logDisplay } from "@/ui/displayLog";

import { utf8Base64, type PastedText } from "./pastedText";

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
 * Largest video the app sends to a herdlingd with the upload in parts (`files.put_begin`).
 * The same limit as `MAX_CHUNKED_BYTES` in herdlingd. An older herdlingd takes `MAX_FILE_BYTES`.
 */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
/** Part size of an upload in parts when herdlingd does not say. */
export const CHUNK_BYTES = 4 * 1024 * 1024;
/** The app never reads a larger part into memory, whatever herdlingd says. */
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
/** Bound for one `files.put_chunk` call: 4 MiB over a slow link. */
const CHUNK_TIMEOUT_MS = 120_000;
/** Bound for `files.put_begin` and `files.put_end`. */
const CONTROL_TIMEOUT_MS = 30_000;
/**
 * The line before the path of a video in the prompt. An agent cannot look at a video file directly,
 * so the line tells it how to see the frames.
 */
export const VIDEO_NOTE = "(The next file is a video. Use ffmpeg to look at frames if you need them.)";

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

/**
 * A picked or pasted video. Its data is read in parts only at upload. `duration` is in milliseconds.
 * `size` is the size the picker gave; the upload reads the real size of the file.
 */
export type Video = { kind: "video"; uri: string; name: string; size?: number; duration?: number; mime?: string };

/** A photo, a file or a video on the next prompt. */
export type Attachment = Photo | DocFile | Video;

export const isFile = (a: Attachment): a is DocFile => a.kind === "file";
export const isVideo = (a: Attachment | PastedText): a is Video => a.kind === "video";
export const isPhoto = (a: Attachment): a is Photo => a.kind === undefined || a.kind === "photo";

/** How many more photos fit: at most `MAX_PHOTOS` photos and `MAX_ATTACHMENTS` items in all. */
export function photoRoom(items: readonly Attachment[]): number {
  const photos = items.filter(isPhoto).length;
  return Math.max(0, Math.min(MAX_PHOTOS - photos, MAX_ATTACHMENTS - items.length));
}

/** How many more files fit. */
export function fileRoom(items: readonly Attachment[]): number {
  return Math.max(0, MAX_ATTACHMENTS - items.length);
}

/** True when the host takes an upload in parts. Only a host that lists its methods can. */
export function canChunk(hello: Hello | undefined): boolean {
  return listsMethod(hello, "files.put_begin");
}

/** The largest video the host takes. */
export function videoLimit(chunked: boolean): number {
  return chunked ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
}

/** Splits videos into the ones that fit `limit` and the names of the ones that do not. Other items always fit. */
export function splitTooLarge<T extends Attachment>(items: readonly T[], limit: number): { fit: T[]; tooLarge: string[] } {
  const fit: T[] = [];
  const tooLarge: string[] = [];
  for (const a of items) {
    if (isVideo(a) && a.size != null && a.size > limit) tooLarge.push(a.name);
    else fit.push(a);
  }
  return { fit, tooLarge };
}

/** The message for videos that are too large. On an older herdlingd, it tells the user to update. */
export function tooLargeVideoText(names: readonly string[], chunked: boolean): string {
  const base = `Too large to attach (max ${formatBytes(videoLimit(chunked))}): ${names.join(", ")}`;
  return chunked ? base : `${base}. Update herdlingd for videos up to ${formatBytes(MAX_VIDEO_BYTES)}.`;
}

/** "0:42", "12:05", "1:02:03". `ms` is in milliseconds. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "0:42 · 31.2 MB" for a video tile. Leaves out the parts it does not know. */
export function videoCaption(v: Pick<Video, "duration" | "size">): string {
  return [v.duration != null ? formatDuration(v.duration) : undefined, v.size != null ? formatBytes(v.size) : undefined]
    .filter(Boolean)
    .join(" · ");
}

/** "12 KB", "3.4 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Wait before the second try to open a picker. */
export const PRESENTER_RETRY_MS = 400;

/** What the composer shows when a picker cannot open two times. */
export const PRESENTER_HELP = {
  photos: "Could not open Photos. If the screen is shared with AirPlay, stop sharing and try again.",
  files: "Could not open Files. If the screen is shared with AirPlay, stop sharing and try again.",
} as const;

/**
 * A picker could not find a view controller to show itself on. The message is for the user.
 * Expo finds that controller from the key window of the app scene. With no key window
 * (seen while the screen is shared with AirPlay) it finds none.
 */
export class PresenterError extends Error {}

/**
 * True for the error that expo-image-picker ("Cannot determine currently presented view
 * controller") and expo-document-picker ("Could not find the current ViewController") give when
 * they find no view controller to show on.
 */
export function isPresenterError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: unknown } | null)?.code;
  return (
    /currently presented view controller|current ViewController/i.test(msg) ||
    code === "ERR_MISSING_CURRENT_VIEW_CONTROLLER" ||
    code === "ERR_MISSING_VIEW_CONTROLLER"
  );
}

/** An error message on one line, for the display log. */
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Opens a picker with `open`. When it fails because it finds no view controller, it closes the
 * keyboard (a keyboard window can hold the key status), waits `PRESENTER_RETRY_MS` and tries once more.
 * A second failure throws a `PresenterError` with help for the user. Each failure goes to the display log.
 */
export async function withPresenterRetry<T>(
  kind: keyof typeof PRESENTER_HELP,
  open: () => Promise<T>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  try {
    return await open();
  } catch (e) {
    logDisplay(`picker ${kind} failed, try 1: ${errorText(e)}`);
    if (!isPresenterError(e)) throw e;
  }
  Keyboard.dismiss();
  await wait(PRESENTER_RETRY_MS);
  try {
    return await open();
  } catch (e) {
    logDisplay(`picker ${kind} failed, try 2: ${errorText(e)}`);
    if (!isPresenterError(e)) throw e;
    throw new PresenterError(PRESENTER_HELP[kind]);
  }
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
  const r = await withPresenterRetry("files", () =>
    DocumentPicker.getDocumentAsync({ type: "*/*", multiple: true, copyToCacheDirectory: true }),
  );
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
 * Opens the photo library for photos and videos: up to `max` items in all, of which up to
 * `maxPhotos` photos. Extra photos are left out. Returns [] when the user cancels.
 *
 * Photos come as JPEG data at `PHOTO_QUALITY`, as in `pickPhotos`. Videos are files.
 * On iOS the picker exports each video as H.264 at up to 1920x1080 in an MP4
 * (`VideoExportPreset.H264_1920x1080`). That keeps a long 4K clip to a sane size, and H.264 is the
 * format that every ffmpeg reads. Android has no export option: the picker copies the original file.
 */
export async function pickMedia(max: number, maxPhotos: number): Promise<Attachment[]> {
  if (max <= 0 || !photosAvailable()) return [];
  const ImagePicker = require("expo-image-picker") as typeof import("expo-image-picker");
  const r = await withPresenterRetry("photos", () =>
    ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: max,
      orderedSelection: true,
      quality: PHOTO_QUALITY,
      base64: true,
      exif: false,
      videoExportPreset: ImagePicker.VideoExportPreset.H264_1920x1080,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    }),
  );
  if (r.canceled) return [];
  const out: Attachment[] = [];
  let photos = 0;
  r.assets.forEach((a, i) => {
    if (out.length >= max) return;
    if (a.type === "video") {
      out.push({
        kind: "video",
        uri: a.uri,
        name: videoName(a.fileName, a.uri, i),
        size: a.fileSize ?? undefined,
        duration: a.duration ?? undefined,
        mime: a.mimeType ?? undefined,
      });
    } else if (a.base64 && photos < maxPhotos) {
      photos += 1;
      out.push({ uri: a.uri, name: jpegName(a.fileName, i), base64: a.base64 });
    }
  });
  return out;
}

/**
 * The name of a picked video. The picker can give a name with the wrong extension (an exported MP4
 * keeps `.MOV`), so the extension comes from the file. No name gives `video-<n>.<ext>`.
 */
export function videoName(fileName: string | null | undefined, uri: string, index: number): string {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(uri.split("?")[0])?.[1]?.toLowerCase() ?? "mp4";
  const base = fileName?.replace(/\.[^.]*$/, "").trim();
  return `${base || `video-${index + 1}`}.${ext}`;
}

/**
 * Opens the photo library for up to `max` images. Returns [] when the user cancels.
 * The picker gives JPEG data at `PHOTO_QUALITY` (HEIC photos are converted).
 */
export async function pickPhotos(max: number): Promise<Photo[]> {
  if (max <= 0 || !photosAvailable()) return [];
  const ImagePicker = require("expo-image-picker") as typeof import("expo-image-picker");
  const r = await withPresenterRetry("photos", () =>
    ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: max,
      orderedSelection: true,
      quality: PHOTO_QUALITY,
      base64: true,
      exif: false,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    }),
  );
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

/** Where an upload is: item `index` of `total`, and the part of that item that is sent (0 to 1). */
export type UploadProgress = { index: number; total: number; fraction: number };

/** "Uploading 1 of 2 · 34%". A one-item upload with no percent yet says "Uploading…". */
export function uploadLabel(p: UploadProgress): string {
  const n = Math.min(p.index + 1, p.total);
  const pct = Math.floor(Math.min(1, Math.max(0, p.fraction)) * 100);
  return `Uploading ${n} of ${p.total} · ${pct}%`;
}

/** One part of an upload in parts. */
export type Chunk = { offset: number; length: number };

/** The parts of a file of `size` bytes, each `chunkBytes` long except the last one. An empty file has none. */
export function planChunks(size: number, chunkBytes: number): Chunk[] {
  const step = Math.max(1, Math.floor(chunkBytes));
  const out: Chunk[] = [];
  for (let offset = 0; offset < size; offset += step) out.push({ offset, length: Math.min(step, size - offset) });
  return out;
}

/** How one item goes up: in parts (`files.put_begin`), or in one `files.put` call. */
export type UploadRoute = "chunked" | "single";

/** Videos go in parts when the host can take that. All other items, and videos on an older herdlingd, go in one call. */
export function uploadRoute(item: Attachment | PastedText, chunked: boolean): UploadRoute {
  return chunked && item.kind === "video" ? "chunked" : "single";
}

/** The error of an upload that the user stopped. Nothing is sent. */
export class UploadCanceled extends Error {
  constructor() {
    super("Upload canceled");
  }
}

/** Reads a file in parts. A test passes its own. */
export type FileReader = {
  size(uri: string): Promise<number>;
  /** Opens the file. `read` gives the next `length` bytes as base64. */
  open(uri: string): Promise<{ read(length: number): Promise<string>; close(): void }>;
};

/** Standard base64 of `bytes`. Fast enough for a 4 MiB part on Hermes: it makes one string per 32 KiB. */
export function bytesToBase64(bytes: Uint8Array): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const codes = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    codes[o++] = abc.charCodeAt(n >> 18);
    codes[o++] = abc.charCodeAt((n >> 12) & 63);
    codes[o++] = abc.charCodeAt((n >> 6) & 63);
    codes[o++] = abc.charCodeAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest > 0) {
    const n = (bytes[i] << 16) | (rest === 2 ? bytes[i + 1] << 8 : 0);
    codes[o++] = abc.charCodeAt(n >> 18);
    codes[o++] = abc.charCodeAt((n >> 12) & 63);
    codes[o++] = rest === 2 ? abc.charCodeAt((n >> 6) & 63) : 61;
    codes[o++] = 61;
  }
  const parts: string[] = [];
  const STEP = 32 * 1024;
  for (let j = 0; j < codes.length; j += STEP) {
    parts.push(String.fromCharCode.apply(null, codes.subarray(j, j + STEP) as unknown as number[]));
  }
  return parts.join("");
}

/**
 * Reads a file in parts with the `FileHandle` of expo-file-system (present in every build).
 * The legacy ranged read is not used: on Android it reads the file from the start for each part.
 */
const fileReader: FileReader = {
  async size(uri) {
    const { File } = require("expo-file-system") as typeof import("expo-file-system");
    return new File(uri).size;
  },
  async open(uri) {
    const { File } = require("expo-file-system") as typeof import("expo-file-system");
    const handle = new File(uri).open();
    return {
      // Some versions read synchronously: `await` takes both.
      read: async (length) => bytesToBase64(await handle.readBytes(length)),
      close: () => handle.close(),
    };
  },
};

/** Options of `uploadPhotos`. */
export type UploadOptions = {
  /** The host takes an upload in parts (see `canChunk`). */
  chunked?: boolean;
  /** Byte progress, for "Uploading 1 of 2 · 34%". */
  onProgress?: (p: UploadProgress) => void;
  /** Checked before each call. When it is aborted, the upload stops with `UploadCanceled`. */
  signal?: { readonly aborted: boolean };
  /** Reads a video in parts (a test passes its own). */
  files?: FileReader;
};

/**
 * Uploads each attachment in order and returns the paths. A pasted text goes as a UTF-8 `.txt`
 * file. A video goes in parts when the host can take that (`uploadVideo`); everything else goes in
 * one `files.put` call. `progress(done)` runs after each item. Throws on the first failure.
 * `read` gives the base64 data of a file (a test passes its own).
 */
export async function uploadPhotos(
  rpc: RpcClient,
  items: (Attachment | PastedText)[],
  progress?: (done: number) => void,
  read: (uri: string) => Promise<string> = readBase64,
  opts: UploadOptions = {},
): Promise<string[]> {
  const paths: string[] = [];
  const total = items.length;
  const check = () => {
    if (opts.signal?.aborted) throw new UploadCanceled();
  };
  for (const [index, a] of items.entries()) {
    check();
    opts.onProgress?.({ index, total, fraction: 0 });
    if (uploadRoute(a, !!opts.chunked) === "chunked") {
      const v = a as Video;
      paths.push(await uploadVideo(rpc, v, (fraction) => opts.onProgress?.({ index, total, fraction }), check, opts.files));
    } else {
      if (isVideo(a)) {
        // An older herdlingd: one call, up to MAX_FILE_BYTES. Check the real size before the file is read.
        const size = await (opts.files ?? fileReader).size(a.uri);
        if (size > MAX_FILE_BYTES) throw Object.assign(new Error(tooLargeVideoText([a.name], false)), { code: "too_large_video" });
      }
      const data = a.kind === "text" ? utf8Base64(a.text) : isFile(a) || isVideo(a) ? await read(a.uri) : a.base64;
      check();
      const timeout = a.kind === "file" || a.kind === "text" || a.kind === "video" ? FILE_UPLOAD_TIMEOUT_MS : UPLOAD_TIMEOUT_MS;
      const r = await rpc.call<FilePut>("files.put", { name: a.name, data_b64: data }, timeout);
      paths.push(r.path);
    }
    opts.onProgress?.({ index, total, fraction: 1 });
    progress?.(paths.length);
  }
  return paths;
}

/**
 * Uploads one video in parts: `files.put_begin`, one `files.put_chunk` per part in order, then
 * `files.put_end`. On any failure (or a cancel) it asks herdlingd to delete the partial file
 * (`files.put_abort`, best effort) and throws. `check` throws to stop between parts.
 */
export async function uploadVideo(
  rpc: RpcClient,
  v: Video,
  onFraction: (f: number) => void,
  check: () => void = () => {},
  files: FileReader = fileReader,
): Promise<string> {
  const size = await files.size(v.uri);
  if (size > MAX_VIDEO_BYTES) throw Object.assign(new Error(tooLargeVideoText([v.name], true)), { code: "too_large_video" });
  const begin = await rpc.call<FilePutBegin>("files.put_begin", { name: v.name, size }, CONTROL_TIMEOUT_MS);
  const id = begin.upload_id;
  const step = Math.min(MAX_CHUNK_BYTES, begin.chunk_bytes && begin.chunk_bytes > 0 ? begin.chunk_bytes : CHUNK_BYTES);
  let file: Awaited<ReturnType<FileReader["open"]>> | undefined;
  try {
    file = await files.open(v.uri);
    for (const c of planChunks(size, step)) {
      check();
      const data = await file.read(c.length);
      check();
      await rpc.call("files.put_chunk", { upload_id: id, offset: c.offset, data_b64: data }, CHUNK_TIMEOUT_MS);
      onFraction((c.offset + c.length) / size);
    }
    check();
    const r = await rpc.call<FilePut>("files.put_end", { upload_id: id }, CONTROL_TIMEOUT_MS);
    return r.path;
  } catch (e) {
    rpc.call("files.put_abort", { upload_id: id }, CONTROL_TIMEOUT_MS).catch(() => {});
    throw e;
  } finally {
    file?.close();
  }
}

/** Why an upload failed, for "Upload failed, nothing sent: …". */
export function uploadErrorText(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  if (code === "too_large") return "a file is larger than this computer accepts. Update herdlingd for files up to 25 MB";
  return e instanceof Error ? e.message : String(e);
}

/**
 * The attachment lines of the prompt: each path on its own line, in the order of `items`.
 * A video path comes after `VIDEO_NOTE`. `paths[i]` is the path of `items[i]`.
 */
export function pathLines(items: readonly (Attachment | PastedText)[], paths: readonly string[]): string[] {
  return paths.flatMap((p, i) => (items[i] && isVideo(items[i]) ? [VIDEO_NOTE, p] : [p]));
}

/** The prompt text, then each path on its own line. The agents read the files at these paths. */
export function withPaths(text: string, paths: string[]): string {
  const body = text.trimEnd();
  return [...(body ? [body] : []), ...paths].join("\n");
}
