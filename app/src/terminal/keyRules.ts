/**
 * The rules of the key bar in the terminal view: the one-shot modifiers Ctrl and Alt, how a key
 * or a typed character goes to the pane with a modifier, the drag pad for the arrow keys, and the
 * pages of the bar. Pure: `KeyBar` and `TerminalView` send the results.
 *
 * Key names: both herdr 1 and herdr-core take `esc`, `tab`, `enter`, `backspace`, the arrows and
 * `ctrl+<letter>`. Alt goes as Escape first (the same bytes a terminal sends for Alt), so it works
 * on both without a key name that herdr 1 may not know.
 */
import type { SendOp } from "./sendQueue";

export type Mod = "ctrl" | "alt";

/** No modifier, or one modifier that is armed for the next key (`locked`: for every key). */
export type ModState = { mod: null } | { mod: Mod; locked: boolean };

export const NO_MOD: ModState = { mod: null };

export type ModEvent = { type: "tap"; mod: Mod } | { type: "hold"; mod: Mod } | { type: "used" };

/**
 * - `tap`: arms the modifier for one key. A tap on the armed (or locked) modifier turns it off. A
 *   tap on the other modifier moves to it.
 * - `hold`: locks the modifier until the next tap.
 * - `used`: a key used the modifier. A one-shot modifier turns off; a locked one stays.
 */
export function modReducer(s: ModState, e: ModEvent): ModState {
  switch (e.type) {
    case "tap":
      return s.mod === e.mod ? NO_MOD : { mod: e.mod, locked: false };
    case "hold":
      return { mod: e.mod, locked: true };
    case "used":
      return s.mod !== null && !s.locked ? NO_MOD : s;
  }
}

/** A key of the bar or the keyboard: a named key, one typed character, or a text macro. */
export type BarInput = { kind: "key"; key: string } | { kind: "char"; ch: string } | { kind: "text"; text: string; enter: boolean };

const LETTER = /^[a-z]$/i;

/**
 * The send for `input` with the modifier of `s`, and the modifier after it.
 * - Ctrl + a letter (any case): `ctrl+<lower>`. Ctrl + a named key: `ctrl+<name>`. Ctrl + another
 *   character: the character alone.
 * - Alt + a character: the text Escape + character. Alt + a named key: the keys `esc`, `<name>`.
 * - A text macro ignores the modifier and turns a one-shot modifier off.
 */
export function encode(s: ModState, input: BarInput): { op: SendOp; state: ModState } {
  const used = modReducer(s, { type: "used" });
  if (input.kind === "text") return { op: input.enter ? { text: input.text, keys: ["enter"] } : { text: input.text }, state: used };
  if (s.mod === null) {
    return { op: input.kind === "key" ? { keys: [input.key] } : { text: input.ch }, state: s };
  }
  if (s.mod === "ctrl") {
    if (input.kind === "key") return { op: { keys: [`ctrl+${input.key}`] }, state: used };
    return { op: LETTER.test(input.ch) ? { keys: [`ctrl+${input.ch.toLowerCase()}`] } : { text: input.ch }, state: used };
  }
  if (input.kind === "key") return { op: { keys: ["esc", input.key] }, state: used };
  return { op: { text: `\x1b${input.ch}` }, state: used };
}

/** Points of drag per arrow key on the drag pad. */
export const PAD_STEP = 18;

/**
 * The drag pad. `acc` is the drag that did not make a key yet. `dx`, `dy` are the move since the
 * last call. Each full `step` on the axis with the larger move gives one arrow key; the rest stays.
 */
export function padStep(acc: { x: number; y: number }, dx: number, dy: number, step = PAD_STEP): { acc: { x: number; y: number }; keys: string[] } {
  let x = acc.x + dx;
  let y = acc.y + dy;
  const keys: string[] = [];
  const horizontal = Math.abs(x) >= Math.abs(y);
  const v = horizontal ? x : y;
  const n = Math.trunc(Math.abs(v) / step);
  if (n > 0) {
    const key = horizontal ? (v > 0 ? "right" : "left") : v > 0 ? "down" : "up";
    for (let i = 0; i < n; i++) keys.push(key);
    if (horizontal) {
      x -= Math.sign(v) * n * step;
      y = 0;
    } else {
      y -= Math.sign(v) * n * step;
      x = 0;
    }
  }
  return { acc: { x, y }, keys };
}

/** The number of pages of a paged row: 1 when the content fits. */
export function pageCount(content: number, view: number): number {
  if (view <= 0 || content <= view) return 1;
  return Math.ceil(content / view - 0.01);
}

/** The page that shows at `offset`. */
export function pageOf(offset: number, view: number): number {
  return view <= 0 ? 0 : Math.max(0, Math.round(offset / view));
}
