/**
 * The crash log: the last JavaScript errors that closed the app or that an error screen caught.
 * It stays on the phone (in the keychain) and goes to no server. Settings shows it ("Crash log").
 *
 * A fatal error stops the app at once (the native side aborts after the JS handler returns), so
 * the write is synchronous: `SecureStore.setItem` finishes before the handler returns.
 */
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/** The keychain key of the log. */
export const CRASH_LOG_KEY = "herdling.crash_log";
/** The log keeps this many entries. */
export const CRASH_LOG_MAX = 5;
/** The largest stored value in bytes. A keychain value must stay small. */
export const CRASH_LOG_BYTES = 4096;
/** The stack keeps this many lines. */
const STACK_LINES = 40;
const MESSAGE_CHARS = 500;

/**
 * `fatal`: the error closed the app. `screen`: an error screen caught it and the app stayed open.
 * `native`: a native exception closed the app; the next launch read it from the native crash file.
 */
export type CrashKind = "fatal" | "screen" | "native";

export type CrashEntry = {
  /** Epoch ms. */
  time: number;
  kind: CrashKind;
  message: string;
  stack?: string;
  /** The route that showed, for example `/session/h1/w1:p2`. */
  route?: string;
  /** The over-the-air update that ran ("built-in" for the code of the build). */
  update?: string;
};

/** Where the app was when the error came. The root layout and expo-updates fill it in. */
export type CrashContext = { route?: string; update?: string };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One entry from any thrown value. Only the first lines of the stack stay. */
export function makeEntry(error: unknown, kind: CrashKind, context: CrashContext = {}, time = Date.now()): CrashEntry {
  const e = error instanceof Error ? error : undefined;
  const name = e && e.name && e.name !== "Error" ? `${e.name}: ` : "";
  const message = clip(e ? `${name}${e.message}` : String(error), MESSAGE_CHARS);
  const stack = typeof e?.stack === "string" ? e.stack.split("\n").slice(0, STACK_LINES).join("\n") : undefined;
  return { time, kind, message, ...(stack ? { stack } : {}), ...(context.route ? { route: context.route } : {}), ...(context.update ? { update: context.update } : {}) };
}

/** One entry from a saved native crash: the first line is the message, the next lines the stack. */
export function nativeEntry(at: number, text: string): CrashEntry {
  const [first = "", ...rest] = text.split("\n");
  const stack = rest.slice(0, STACK_LINES).join("\n").trimEnd();
  return { time: at, kind: "native", message: clip(first.trim() || "Native crash", MESSAGE_CHARS), ...(stack ? { stack } : {}) };
}

const isEntry =(x: unknown): x is CrashEntry =>
  !!x && typeof x === "object" && typeof (x as CrashEntry).time === "number" && typeof (x as CrashEntry).message === "string";

/** The entries in a stored value, oldest first. A missing or damaged value gives an empty log. */
export function parseLog(raw: string | null | undefined): CrashEntry[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/** UTF-8 length: the keychain limit counts bytes, and a message can hold any text. */
function bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * The value to store: the last `CRASH_LOG_MAX` entries in at most `CRASH_LOG_BYTES` bytes. Stacks
 * get shorter first (the newest entry keeps its stack the longest), then the oldest entries go.
 */
export function encodeLog(entries: readonly CrashEntry[], max = CRASH_LOG_BYTES): string {
  let list = entries.slice(-CRASH_LOG_MAX).map((e) => ({ ...e }));
  let text = JSON.stringify(list);
  // Halve the stacks, oldest entry first, until the value fits.
  for (let lines = STACK_LINES; bytes(text) > max && lines >= 1; lines = Math.floor(lines / 2)) {
    for (let i = 0; i < list.length && bytes(text) > max; i++) {
      const s = list[i].stack;
      if (!s) continue;
      const cut = lines > 1 ? s.split("\n").slice(0, lines).join("\n") : undefined;
      list[i] = { ...list[i], stack: cut };
      if (!cut) delete list[i].stack;
      text = JSON.stringify(list);
    }
  }
  while (bytes(text) > max && list.length > 1) {
    list = list.slice(1);
    text = JSON.stringify(list);
  }
  if (bytes(text) > max) text = JSON.stringify(list.map((e) => ({ ...e, message: clip(e.message, 200), route: undefined })));
  return text;
}

type CrashLogState = { entries: CrashEntry[] };

/** The log as the Crash log screen shows it, oldest first. `loadCrashLog` fills it from the keychain. */
export const useCrashLog = create<CrashLogState>()(() => ({ entries: [] }));

/** Reads the stored log into `useCrashLog`. A failed read (for example a locked keychain) shows an empty log. */
export function loadCrashLog(): CrashEntry[] {
  let entries: CrashEntry[] = [];
  try {
    entries = parseLog(SecureStore.getItem(CRASH_LOG_KEY));
  } catch {
    entries = [];
  }
  useCrashLog.setState({ entries });
  return entries;
}

/**
 * Adds one entry and writes the log synchronously. It never throws: it runs inside the global
 * error handler, and a second error there would hide the first.
 */
export function recordCrash(error: unknown, kind: CrashKind, context: CrashContext = {}): void {
  try {
    appendEntry(makeEntry(error, kind, context));
  } catch {
    // makeEntry failed on a strange thrown value: nothing to save.
  }
}

/**
 * Adds a ready entry and writes the log synchronously. The log stays in time order, so an older
 * native crash that the next launch reads goes before newer entries. It never throws.
 */
export function appendEntry(entry: CrashEntry): void {
  try {
    let stored: CrashEntry[] = [];
    try {
      stored = parseLog(SecureStore.getItem(CRASH_LOG_KEY));
    } catch {
      stored = useCrashLog.getState().entries;
    }
    const list = [...stored, entry].sort((a, b) => a.time - b.time);
    const value = encodeLog(list);
    useCrashLog.setState({ entries: parseLog(value) });
    SecureStore.setItem(CRASH_LOG_KEY, value);
  } catch {
    // No keychain (for example a locked phone): the entry stays in memory only.
  }
}

/** Deletes the log. */
export async function clearCrashLog(): Promise<void> {
  useCrashLog.setState({ entries: [] });
  await SecureStore.deleteItemAsync(CRASH_LOG_KEY).catch(() => {});
}

const two = (n: number) => String(n).padStart(2, "0");

/** Local date and time as YYYY-MM-DD HH:MM:SS. */
export function crashTime(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

const KIND_TEXT: Record<CrashKind, string> = { fatal: "Fatal", screen: "Caught", native: "Native" };
const KIND_LABEL: Record<CrashKind, string> = {
  fatal: "Closed the app",
  screen: "Caught by an error screen",
  native: "Native crash, closed the app",
};

/** The kind as the Crash log screen shows it. */
export function crashKindLabel(kind: CrashKind): string {
  return KIND_LABEL[kind] ?? KIND_LABEL.screen;
}

/** One entry as text: the heading line, then the stack. */
export function entryText(e: CrashEntry): string {
  const where = [e.route ? `route ${e.route}` : undefined, e.update ? `update ${e.update}` : undefined].filter(Boolean).join(", ");
  const head = `${crashTime(e.time)} ${KIND_TEXT[e.kind] ?? "Caught"}: ${e.message}${where ? ` (${where})` : ""}`;
  return e.stack ? `${head}\n${e.stack}` : head;
}

/** The whole log as text, newest first, for Copy. */
export function crashLogText(entries: readonly CrashEntry[]): string {
  return [...entries]
    .reverse()
    .map(entryText)
    .join("\n\n");
}
