/**
 * What another app shared to Herdling, and how it becomes a prompt. Pure: the share screen and
 * the share bridge use it, the tests call it directly.
 *
 * The native module (`expo-share-intent`) sends a JSON string on iOS and an object on Android, in
 * a few shapes: `{ text }`, `{ weburls: [{ url, meta }] }` or `{ files: [...] }`. `parseShare` turns
 * each one into one `SharedContent`. It never throws: a value it cannot read gives `undefined`.
 */
import {
  fileRoom,
  formatBytes,
  isPhoto,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_PHOTOS,
  MAX_VIDEO_BYTES,
  photoRoom,
  type Attachment,
  type DocFile,
  type Photo,
  type Video,
} from "@/thread/attachments";
import { isLongPaste, type PastedText } from "@/thread/pastedText";

/** The kind of a shared file. A photo goes like a picked photo, a video like a picked video. */
export type SharedKind = "image" | "video" | "file";

/** One shared file. `uri` is a `file://` or a `content://` URI. `duration` is in milliseconds. */
export type SharedFile = { kind: SharedKind; uri: string; name: string; size?: number; mime?: string; duration?: number };

/** One share: a link, a text, files, or a text with a link in it. */
export type SharedContent = {
  /** The link: a shared web page, or the first link in a shared text. */
  url?: string;
  /** The shared text. Not set when the text was only the link. */
  text?: string;
  /** A title from the sending app (Android) or from the page (iOS Safari). */
  title?: string;
  /** An image of the page from its meta tags (iOS Safari). */
  image?: string;
  files: SharedFile[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** The first http or https link in `text`, without the punctuation that ends a sentence. */
export function firstUrl(text: string): string | undefined {
  const m = /https?:\/\/[^\s<>"'`]+/i.exec(text);
  if (!m) return undefined;
  let url = m[0];
  // A link at the end of a sentence or in brackets: "(see https://x.dev/a)." keeps "https://x.dev/a".
  while (/[).,;:!?\]}'"]$/.test(url)) {
    const last = url[url.length - 1];
    if (last === ")" && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
    url = url.slice(0, -1);
  }
  return url.length > "https://".length ? url : undefined;
}

/** A shared text: only a link, a text with a link in it, or a plain text. */
export function fromText(text: string, title?: string): SharedContent | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const url = firstUrl(t);
  if (url && url === t) return { url, title, files: [] };
  return { url, text: t, title, files: [] };
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i;

/** The kind of a file from its MIME type, else its name. `hint` is the iOS media type (0 image, 1 video). */
export function kindOf(mime: string | undefined, name: string, hint?: number): SharedKind {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime && mime !== "application/octet-stream") return "file";
  if (IMAGE_EXT.test(name)) return "image";
  if (VIDEO_EXT.test(name)) return "video";
  if (hint === 0) return "image";
  if (hint === 1) return "video";
  return "file";
}

/** A path becomes a `file://` URI. A URI stays as it is. */
function toUri(path: string): string {
  return path.startsWith("/") ? `file://${path}` : path;
}

/** The last part of a path or URI, decoded. */
function baseName(uri: string): string | undefined {
  const last = uri.split("?")[0].split("/").filter(Boolean).pop();
  if (!last) return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * One file of the native value, or undefined for an entry with no path. Android gives a
 * `contentUri` (readable with the grant of the share) and sometimes a `filePath` that the app may not
 * read, so the `contentUri` comes first.
 */
function fileOf(v: unknown, index: number): SharedFile | undefined {
  if (!isObj(v)) return undefined;
  const raw = str(v.contentUri) ?? str(v.path) ?? str(v.filePath);
  if (!raw) return undefined;
  const uri = toUri(raw);
  const name = str(v.fileName)?.trim() || baseName(uri) || `file-${index + 1}`;
  const mime = str(v.mimeType);
  return {
    kind: kindOf(mime, name, typeof v.type === "number" ? v.type : undefined),
    uri,
    name,
    size: num(v.fileSize),
    mime,
    duration: num(v.duration),
  };
}

/** Reads the meta tags that the iOS Safari step sends as a JSON string. */
function metaOf(v: unknown): Obj {
  if (isObj(v)) return v;
  if (typeof v !== "string") return {};
  try {
    const m: unknown = JSON.parse(v);
    return isObj(m) ? m : {};
  } catch {
    return {};
  }
}

/**
 * The shared content of one native value, or undefined when it holds nothing that Herdling can
 * send. iOS sends a JSON string, Android an object.
 */
export function parseShare(value: unknown): SharedContent | undefined {
  let v: unknown = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  if (!isObj(v)) return undefined;
  const text = str(v.text);
  if (text) {
    const meta = metaOf(v.meta);
    return fromText(text, str(meta.title)?.trim());
  }
  if (Array.isArray(v.weburls)) {
    const first = v.weburls.find((w): w is Obj => isObj(w) && !!str(w.url));
    if (first) {
      const url = String(first.url).trim();
      const meta = metaOf(first.meta);
      const title = str(meta["og:title"]) ?? str(meta["twitter:title"]) ?? str(meta.title);
      const image = str(meta["og:image"]) ?? str(meta["twitter:image"]);
      return { url, title: title?.trim(), image: image?.trim(), files: [] };
    }
  }
  if (Array.isArray(v.files)) {
    const files = v.files.flatMap((f, i) => {
      const file = fileOf(f, i);
      return file ? [file] : [];
    });
    if (files.length > 0) return { files };
  }
  return undefined;
}

/** True when the share has nothing to send. */
export const isEmpty = (c: SharedContent) => !c.url && !c.text && c.files.length === 0;

/** The largest file of each kind that a host takes. `chunked`: the host takes an upload in parts. */
export function sizeLimit(kind: SharedKind, chunked: boolean): number {
  if (kind === "image") return MAX_FILE_BYTES;
  return chunked ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
}

/** A shared file as an attachment of the composer. An image has no data yet: it is read at upload. */
export function toAttachment(f: SharedFile): Attachment {
  if (f.kind === "image") return { uri: f.uri, name: f.name, base64: "" } satisfies Photo;
  if (f.kind === "video") return { kind: "video", uri: f.uri, name: f.name, size: f.size, duration: f.duration, mime: f.mime } satisfies Video;
  return { kind: "file", uri: f.uri, name: f.name, size: f.size, mime: f.mime } satisfies DocFile;
}

/** The attachments of a share, and the names of the files that do not go. */
export type SharePlan = {
  items: Attachment[];
  /** Over the size limit of the host. */
  tooLarge: string[];
  /** Over the count limit (`MAX_ATTACHMENTS` items, `MAX_PHOTOS` photos). */
  extra: string[];
};

/**
 * Which shared files go to the host, in the order of the share: the same limits as the composer.
 * `chunked`: the host takes an upload in parts (larger videos and files).
 */
export function planFiles(files: readonly SharedFile[], chunked: boolean): SharePlan {
  const items: Attachment[] = [];
  const tooLarge: string[] = [];
  const extra: string[] = [];
  for (const f of files) {
    if (f.size != null && f.size > sizeLimit(f.kind, chunked)) {
      tooLarge.push(f.name);
      continue;
    }
    const a = toAttachment(f);
    const room = isPhoto(a) ? photoRoom(items) : fileRoom(items);
    if (room <= 0) extra.push(f.name);
    else items.push(a);
  }
  return { items, tooLarge, extra };
}

/** The file name of a long shared text. */
export const SHARED_TEXT_NAME = "shared-text.txt";

/**
 * A shared text that is too long for the prompt line goes as a `.txt` file, like a long paste in
 * the composer. Only when the host takes files.
 */
export function textAsFile(text: string | undefined, canFiles: boolean): PastedText | undefined {
  if (!text || !canFiles || !isLongPaste(text)) return undefined;
  return { kind: "text", n: 1, name: SHARED_TEXT_NAME, text };
}

/** The line about files that do not go, or undefined. */
export function droppedText(plan: Pick<SharePlan, "tooLarge" | "extra">, chunked: boolean): string | undefined {
  const parts: string[] = [];
  if (plan.tooLarge.length > 0) {
    parts.push(`Too large (max ${formatBytes(sizeLimit("file", chunked))}): ${plan.tooLarge.join(", ")}.`);
  }
  if (plan.extra.length > 0) {
    parts.push(`Up to ${MAX_ATTACHMENTS} items and ${MAX_PHOTOS} photos go with one prompt. Left out: ${plan.extra.join(", ")}.`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** A short line for the share: "Link", "Text", "2 photos", "1 video and 1 file". */
export function shareSummary(c: SharedContent): string {
  if (c.files.length === 0) return c.url && !c.text ? "Link" : c.url ? "Text with a link" : "Text";
  const n = (kind: SharedKind) => c.files.filter((f) => f.kind === kind).length;
  const word = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);
  const parts = [
    n("image") > 0 ? word(n("image"), "photo", "photos") : undefined,
    n("video") > 0 ? word(n("video"), "video", "videos") : undefined,
    n("file") > 0 ? word(n("file"), "file", "files") : undefined,
  ].filter((p): p is string => !!p);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
}

/**
 * The files that are copies the iOS share extension made in the App Group folder. The app deletes
 * them after the share. Other files (an Android content URI, a file of another app) are never deleted.
 */
export function ownCopies(files: readonly SharedFile[]): string[] {
  return files.filter((f) => f.uri.startsWith("file://") && f.uri.includes("/Shared/AppGroup/")).map((f) => f.uri);
}
