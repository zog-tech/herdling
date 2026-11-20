/**
 * The load flow of the file viewer as a pure state machine. A load asks `files.get` for the path.
 * An image comes in parts of at most 384 KiB: the machine asks for the next part until `eof`, and
 * then joins the base64 parts. A retry starts a new load with a new generation; a reply of an old
 * generation changes nothing.
 */
import type { FileGet, FileImage } from "@herdling/protocol";

/** What the viewer shows when the load is done. An image has all its bytes in `data_b64`. */
export type Shown = Exclude<FileGet, FileImage> | (FileImage & { data_b64?: string });

export type ViewerState =
  | { kind: "loading"; gen: number }
  /** An image whose first parts came. `received`: decoded bytes so far. */
  | { kind: "parts"; gen: number; meta: FileImage; parts: string[]; received: number }
  | { kind: "ready"; gen: number; file: Shown }
  | { kind: "failed"; gen: number; code: string; message: string };

export type ViewerEvent =
  | { type: "load" }
  | { type: "result"; gen: number; result: FileGet }
  | { type: "error"; gen: number; code: string; message: string };

/** Ask `files.get` for the path; `offset` for the next part of an image. */
export type ViewerEffect = { type: "fetch"; gen: number; offset: number };

export const initialViewer: ViewerState = { kind: "loading", gen: 0 };

/** The decoded length of a base64 text. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

const fail = (gen: number, code: string, message: string): { state: ViewerState; effects: ViewerEffect[] } => ({
  state: { kind: "failed", gen, code, message },
  effects: [],
});

/** One image part in: the next fetch, or the whole image. */
function imagePart(gen: number, meta: FileImage, parts: string[], received: number, part: FileImage): { state: ViewerState; effects: ViewerEffect[] } {
  if (part.size !== meta.size) return fail(gen, "changed", "The file changed while it loaded.");
  const data = part.data_b64 ?? "";
  const nextParts = [...parts, data];
  const nextReceived = received + base64Bytes(data);
  if (part.eof || nextReceived >= meta.size) {
    return { state: { kind: "ready", gen, file: { ...meta, data_b64: nextParts.join(""), offset: 0, eof: true } }, effects: [] };
  }
  // No bytes and no end: the file got shorter. Stop, else the loop never ends.
  if (data.length === 0) return fail(gen, "changed", "The file changed while it loaded.");
  return {
    state: { kind: "parts", gen, meta, parts: nextParts, received: nextReceived },
    effects: [{ type: "fetch", gen, offset: nextReceived }],
  };
}

export function viewerReducer(state: ViewerState, event: ViewerEvent): { state: ViewerState; effects: ViewerEffect[] } {
  switch (event.type) {
    case "load": {
      const gen = state.gen + 1;
      return { state: { kind: "loading", gen }, effects: [{ type: "fetch", gen, offset: 0 }] };
    }
    case "result": {
      if (event.gen !== state.gen) return { state, effects: [] };
      const r = event.result;
      if (state.kind === "loading") {
        if (r.kind !== "image" || r.too_large || r.data_b64 === undefined) return { state: { kind: "ready", gen: state.gen, file: r }, effects: [] };
        const { data_b64: _data, ...meta } = r;
        return imagePart(state.gen, meta, [], 0, r);
      }
      if (state.kind === "parts") {
        if (r.kind !== "image") return fail(state.gen, "changed", "The file changed while it loaded.");
        return imagePart(state.gen, state.meta, state.parts, state.received, r);
      }
      return { state, effects: [] };
    }
    case "error":
      if (event.gen !== state.gen || (state.kind !== "loading" && state.kind !== "parts")) return { state, effects: [] };
      return fail(state.gen, event.code, event.message);
  }
}

/** The sentence that the viewer shows for a failed load. */
export function failText(code: string, message: string): string {
  switch (code) {
    case "not_found":
      return "This file or folder does not exist on the computer.";
    case "offline":
      return "The computer is offline.";
    case "unknown_method":
      return "Update herdlingd on this computer to open files.";
    case "changed":
      return message;
    default:
      return message || "The file did not load.";
  }
}
