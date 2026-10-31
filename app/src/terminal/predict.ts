/**
 * Typing prediction for "Type directly" mode, after mosh (Winstein and Balakrishnan, 2012;
 * thresholds from mosh `terminaloverlay.h`). herdr gives no cursor position, so a printable key
 * is predicted at the end of the last line with text. Enter, arrows, Tab, Esc and Ctrl keys end
 * the prediction "epoch": the next screen is the truth. Pure state functions, so they have tests.
 */

/** Show predictions above this smoothed RTT (ms); hide them again below `HIDE_BELOW`. */
export const SHOW_ABOVE = 30;
export const HIDE_BELOW = 20;
/** Underline unconfirmed predictions above this RTT (ms); stop below `UNFLAG_BELOW`. */
export const FLAG_ABOVE = 80;
export const UNFLAG_BELOW = 50;
/** A prediction not confirmed in this time is a glitch. */
export const GLITCH_MS = 1_000;
/** After a glitch, predictions stay hidden until this many characters are confirmed. */
export const GOOD_TO_RESUME = 10;

export type Prediction = {
  /** Characters typed in this epoch, after Backspace edits. */
  typed: string;
  /** Send time of each character of `typed`. */
  times: number[];
  /** How many characters of `typed` the screen shows. */
  confirmed: number;
  /** The last line with text when the epoch started; a screen with the same line confirms nothing. */
  base?: string;
  /** The last line with text of the latest screen. */
  lastLine: string;
  shown: boolean;
  flagged: boolean;
  /** Confirmed characters still needed after a glitch (0: no glitch). */
  glitch: number;
};

export const initialPrediction: Prediction = {
  typed: "",
  times: [],
  confirmed: 0,
  lastLine: "",
  shown: false,
  flagged: false,
  glitch: 0,
};

/** A new smoothed RTT: turns showing and underlining on and off, with hysteresis. */
export function onSrtt(p: Prediction, ms: number | undefined): Prediction {
  if (ms === undefined) return p;
  const shown = p.shown ? ms >= HIDE_BELOW : ms > SHOW_ABOVE;
  const flagged = p.flagged ? ms >= UNFLAG_BELOW : ms > FLAG_ABOVE;
  return shown === p.shown && flagged === p.flagged ? p : { ...p, shown, flagged };
}

/** Printable text was typed. */
export function onType(p: Prediction, text: string, now: number): Prediction {
  if (!text) return p;
  const base = p.typed === "" ? p.lastLine : p.base;
  return { ...p, base, typed: p.typed + text, times: [...p.times, ...Array.from(text, () => now)] };
}

/** Backspace removes the last predicted character. With nothing predicted, the epoch ends. */
export function onBackspace(p: Prediction): Prediction {
  if (p.typed.length <= p.confirmed) return endEpoch(p);
  const chars = Array.from(p.typed);
  chars.pop();
  return { ...p, typed: chars.join(""), times: p.times.slice(0, chars.length) };
}

/** Enter, an arrow, Tab, Esc or a Ctrl key: clear all predictions. */
export function endEpoch(p: Prediction): Prediction {
  if (p.typed === "" && p.confirmed === 0 && p.base === undefined) return p;
  return { ...p, typed: "", times: [], confirmed: 0, base: undefined };
}

/** How many leading characters of `typed` the end of `line` shows. */
export function confirmedCount(line: string, typed: string): number {
  const end = line.trimEnd();
  for (let k = typed.length; k > 0; k--) {
    const head = typed.slice(0, k).trimEnd();
    if (head && end.endsWith(head)) return k;
  }
  return 0;
}

/** A prediction older than `GLITCH_MS` without confirmation clears all and hides predictions. */
export function expire(p: Prediction, now: number): Prediction {
  const late = p.times.some((t, i) => i >= p.confirmed && now - t > GLITCH_MS);
  return late ? { ...endEpoch(p), glitch: GOOD_TO_RESUME } : p;
}

/** A new screen: confirm the predicted characters that the last line with text now shows. */
export function onScreen(p: Prediction, lastLine: string, now: number): Prediction {
  let next: Prediction = { ...p, lastLine };
  if (p.typed && lastLine !== p.base) {
    const confirmed = confirmedCount(lastLine, p.typed);
    const gained = Math.max(0, confirmed - p.confirmed);
    next = { ...next, confirmed, glitch: Math.max(0, p.glitch - gained) };
  }
  return expire(next, now);
}

/** The predicted characters to draw now, and whether to underline them. */
export function visiblePrediction(p: Prediction): { text: string; underline: boolean } {
  if (!p.shown || p.glitch > 0) return { text: "", underline: false };
  return { text: p.typed.slice(p.confirmed), underline: p.flagged };
}
