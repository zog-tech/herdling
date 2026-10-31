import type { SttText } from "@herdling/protocol";

import type { Recorded } from "../../modules/voice";
import type { InputEngine } from "./settings";

/** The app waits this long for `stt.make`. The companion stops the command after 120 s. */
export const HOST_STT_TIMEOUT_MS = 130_000;

/** Engines that read the recording file. Undefined: not usable now (no model, no `stt.make`). */
export type Transcribers = {
  parakeet?: (uri: string) => Promise<string>;
  host?: (uri: string) => Promise<string>;
};

export type Transcribed = { text: string; engine: InputEngine; ms: number };

/** Every engine failed. `attempts` has one line per engine tried; the file stays for a retry. */
export class TranscribeError extends Error {
  constructor(readonly attempts: { engine: InputEngine; message: string }[]) {
    super(attempts.length ? attempts.map((a) => `${ENGINE_NAME[a.engine]}: ${a.message}`).join("; ") : "No voice engine is available");
  }
}

export const ENGINE_NAME: Record<InputEngine, string> = { parakeet: "Parakeet", host: "Host", apple: "Apple" };

/**
 * The order in which engines try a recording. Apple has text only from live recognition during
 * the recording; it cannot read a file. So Apple comes first when it ran, else last.
 */
export function engineOrder(primary: InputEngine): InputEngine[] {
  switch (primary) {
    case "parakeet":
      return ["parakeet", "host", "apple"];
    case "host":
      return ["host", "parakeet", "apple"];
    case "apple":
      return ["apple", "parakeet", "host"];
  }
}

const message = (e: unknown): string => {
  const m = (e as { message?: unknown })?.message;
  return typeof m === "string" && m ? m : String(e);
};

/**
 * Turns a recording into text with `primary`, then the next engines in `engineOrder`.
 * Apple uses the live text of the recording (none when live recognition did not run or failed).
 * Rejects with a `TranscribeError` when no engine gives text. Empty text is a result (nothing said).
 */
export async function transcribeRecording(
  rec: Recorded,
  primary: InputEngine,
  t: Transcribers,
  now: () => number = Date.now,
): Promise<Transcribed> {
  const attempts: { engine: InputEngine; message: string }[] = [];
  for (const engine of engineOrder(primary)) {
    const start = now();
    if (engine === "apple") {
      if (rec.text !== undefined) return { text: rec.text.trim(), engine, ms: 0 };
      continue;
    }
    const run = t[engine];
    if (!run) continue;
    try {
      return { text: (await run(rec.uri)).trim(), engine, ms: now() - start };
    } catch (e) {
      attempts.push({ engine, message: message(e) });
    }
  }
  throw new TranscribeError(attempts);
}

/** `stt.make` with the WAV file's bytes. `readBase64` reads the file. */
export function hostTranscriber(
  call: <T>(method: string, params: object, timeoutMs: number) => Promise<T>,
  readBase64: (uri: string) => Promise<string>,
): (uri: string) => Promise<string> {
  return async (uri) => {
    const audio_b64 = await readBase64(uri);
    const r = await call<SttText>("stt.make", { audio_b64, mime: "audio/wav" }, HOST_STT_TIMEOUT_MS);
    return typeof r?.text === "string" ? r.text : "";
  };
}

/** Appends dictated text to the prompt box text with one space between them. */
export function appendDictation(current: string, text: string): string {
  const t = text.trim();
  if (!t) return current;
  if (!current.trim()) return t;
  return /\s$/.test(current) ? `${current}${t}` : `${current} ${t}`;
}

/** "0:07", "1:05", "10:00". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
