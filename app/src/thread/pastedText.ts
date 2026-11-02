/**
 * Long pastes in the prompt box. React Native's TextInput has no paste event, so the composer
 * compares each `onChangeText` value with the text before it. When one change inserts a long
 * block, the block leaves the box and becomes a "Pasted text #n" chip. On send, each chip goes to
 * the agent as a `.txt` file through `files.put`, like an attached file.
 */

/** A paste with more lines than this becomes a chip. */
export const PASTE_MAX_LINES = 10;
/** A paste with more characters than this becomes a chip. */
export const PASTE_MAX_CHARS = 800;

/** A long paste that waits as a chip above the prompt box. */
export type PastedText = { kind: "text"; n: number; name: string; text: string };

/** The result of a paste check: the box text without the block, and the block. */
export type PasteCut = { text: string; pasted: string; at: number };

/** The number of lines in `s`. One line break at the end does not start a new line. */
export function lineCount(s: string): number {
  const t = s.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  return t.split("\n").length;
}

/** True when `block` is long enough to become a chip. */
export function isLongPaste(block: string): boolean {
  return block.length > PASTE_MAX_CHARS || lineCount(block) > PASTE_MAX_LINES;
}

/**
 * Finds the block that one change inserted: the part of `next` between the text it shares with
 * `prev` at the start and at the end. A paste over a selection replaces that selection.
 */
export function insertedBlock(prev: string, next: string): { at: number; block: string; removed: number } {
  const max = Math.min(prev.length, next.length);
  let start = 0;
  while (start < max && prev[start] === next[start]) start++;
  let end = 0;
  while (end < max - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++;
  return { at: start, block: next.slice(start, next.length - end), removed: prev.length - end - start };
}

/**
 * Checks one change of the prompt box. Returns the cut when the change inserts a long block,
 * else undefined. Typing adds a few characters per change, so it never passes the limits.
 */
export function detectPaste(prev: string, next: string): PasteCut | undefined {
  if (next.length <= prev.length) return undefined;
  const { at, block, removed } = insertedBlock(prev, next);
  if (!isLongPaste(block)) return undefined;
  // A change that mostly rewrites text in place (keyboard dictation, autocorrect) is not a paste.
  if (removed * 2 >= block.length) return undefined;
  return { text: next.slice(0, at) + next.slice(at + block.length), pasted: block, at };
}

/** `1234567` → `1,234,567`. Not locale based, so the label is the same on each phone. */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The size part of a chip label: "240 lines", or "1,200 chars" for one long line. */
export function pasteSize(text: string): string {
  const lines = lineCount(text);
  return lines > 1 ? `${grouped(lines)} lines` : `${grouped(text.length)} chars`;
}

/** "Pasted text #1 · 240 lines". */
export function pasteLabel(p: PastedText): string {
  return `Pasted text #${p.n} · ${pasteSize(p.text)}`;
}

/** Makes chip `n` for `text`. Its file name is `pasted-text-<n>.txt`. */
export function makePaste(n: number, text: string): PastedText {
  return { kind: "text", n, name: `pasted-text-${n}.txt`, text };
}

/** Puts `insert` into `text` at `at` (the end when `at` is undefined or out of range). */
export function insertAt(text: string, insert: string, at?: number): string {
  const i = at == null || at < 0 || at > text.length ? text.length : at;
  return text.slice(0, i) + insert + text.slice(i);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Encodes `s` as UTF-8, then as base64, for `files.put`. Pure JS: `btoa` takes only Latin-1,
 * and some runtimes do not have `TextEncoder` or `Buffer`.
 */
export function utf8Base64(s: string): string {
  const bytes: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    // A lone surrogate is not valid UTF-8: write U+FFFD in its place.
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : B64[c & 63];
  }
  return out;
}
