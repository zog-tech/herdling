/**
 * The pure rules of a permission menu on a terminal screen, with no React and no connection.
 * herdlingd has a Rust port (`companion/src/choices.rs`) that uses the same fixtures: keep both the same.
 * The display data (`parts`, `parseMenu`, `menuQuestion`, `choiceView`, `isFreeform`) is only in the app.
 */

/**
 * One numbered option of an agent's permission menu.
 * `parts`: the first line of the option and its continuation lines, for display only (from `parseMenu`).
 * `label` is all parts joined with a space; herdlingd matches answers on it.
 */
export type Choice = { key: string /* "1".."9" */; label: string; selected: boolean; parts?: string[] };

export const NONE: Choice[] = [];
const SCAN_LINES = 20;
const BOX_TAIL = /[\s│╭╮╰╯─]+$/;
const BOX_HEAD = /^[\s│╭╮╰╯─]*/;
const CHOICE_LINE = /^\s*(?:([❯›>])\s*)?(\d)\.\s+(.+?)\s*$/;
/** Most lines of question text that `menuQuestion` takes. */
const QUESTION_LINES = 3;

type Line = { indent: number; text: string };
/** A choice block on the screen: its choices (with parts) and the index of its first line in `lines`. */
type Scan = { lines: Line[]; block: Choice[]; start: number };

/** All screen lines with box edges stripped. The indent (box characters count as indent) is kept for wrap detection. */
function screenLines(screen: string): Line[] {
  return screen.split(/\r?\n/).map((raw) => {
    const l = raw.replace(BOX_TAIL, "");
    const indent = BOX_HEAD.exec(l)![0].length;
    return { indent, text: l.slice(indent) };
  });
}

/** The rules of `parseChoices`, plus the parts of each option and the place of the block. */
function scan(screen: string): Scan {
  const lines = screenLines(screen);
  const visible = lines
    .map((l, at) => ({ ...l, at }))
    .filter((l) => l.text.length > 0)
    .slice(-SCAN_LINES);

  let block: Choice[] = [];
  let start = -1;
  let current: Choice[] = [];
  let currentStart = -1;
  let digitCol = 0;
  for (const { indent, text, at } of visible) {
    const m = CHOICE_LINE.exec(text);
    if (m) {
      if (!current.length) currentStart = at;
      current.push({ key: m[2], label: m[3], selected: !!m[1], parts: [m[3]] });
      digitCol = indent + text.indexOf(m[2]);
    } else if (current.length && indent > digitCol) {
      const last = current[current.length - 1];
      last.label = `${last.label} ${text}`;
      last.parts!.push(text);
    } else if (current.length) {
      block = current;
      start = currentStart;
      current = [];
    }
  }
  if (current.length) {
    block = current;
    start = currentStart;
  }

  const valid =
    block.length >= 2 && block.every((c, i) => c.key === String(i + 1)) && block.filter((c) => c.selected).length === 1;
  return valid ? { lines, block, start } : { lines, block: NONE, start: -1 };
}

/**
 * Numbered choices of a permission menu on the visible screen, or `[]`.
 * Looks only at the last 20 non-empty lines and takes the last block of consecutive choice lines.
 * A line indented deeper than the digit of the choice above it is a wrapped part of that label and is joined onto it.
 * The block counts only when it runs 1..n (n ≥ 2) and exactly one line carries the selection marker.
 * The choices have no `parts`: they are the same as the choices of the Rust port.
 */
export function parseChoices(screen: string): Choice[] {
  const { block } = scan(screen);
  return block.length ? block.map(({ key, label, selected }) => ({ key, label, selected })) : NONE;
}

/** A menu for display: the choices of `parseChoices` with their `parts`, and the question above them. */
export type Menu = { choices: Choice[]; question?: string };

/** `parseChoices` and `menuQuestion` in one pass, for the buttons in the app. */
export function parseMenu(screen: string): Menu {
  const s = scan(screen);
  return s.block.length ? { choices: s.block, question: questionAbove(s) } : { choices: NONE };
}

/**
 * The question text directly above the menu, or undefined.
 * Blank lines just above the first choice are skipped. Then the lines up to the next blank line,
 * box line or choice line are taken (at most 3) and joined with a space.
 * A longer paragraph keeps its last 3 lines and starts with "…".
 */
export function menuQuestion(screen: string): string | undefined {
  return questionAbove(scan(screen));
}

function questionAbove({ lines, start }: Scan): string | undefined {
  if (start < 0) return undefined;
  let i = start - 1;
  while (i >= 0 && !lines[i].text) i--;
  const taken: string[] = [];
  for (; i >= 0 && lines[i].text && !CHOICE_LINE.test(lines[i].text); i--) {
    if (taken.length === QUESTION_LINES) {
      taken[0] = `…${taken[0]}`;
      break;
    }
    taken.unshift(lines[i].text.trim());
  }
  const question = taken.join(" ").replace(/\s+/g, " ").trim();
  // A line of only marks (a cursor, a rule) is no question.
  return /[\p{L}\p{N}]/u.test(question) ? question : undefined;
}

/** The display form of one option. */
export type ChoiceView = { title: string; detail?: string; recommended: boolean };

const RECOMMENDED = /\s*\(recommended\)\s*/gi;

/**
 * Title (the first line of the option) and detail (its continuation lines, joined with a space).
 * "(Recommended)" is removed from both and given as a flag. A wrapped long title shows its tail as detail.
 */
export function choiceView(choice: Choice): ChoiceView {
  const parts = choice.parts?.length ? choice.parts : [choice.label];
  const clean = (t: string) => t.replace(RECOMMENDED, " ").replace(/\s+/g, " ").trim();
  const title = clean(parts[0]) || clean(choice.label);
  const detail = clean(parts.slice(1).join(" "));
  return { title, detail: detail || undefined, recommended: /\(recommended\)/i.test(choice.label) };
}

/** True for the built-in free-text options of Claude Code: "Type something." and "Chat about this". */
export function isFreeform(choice: Choice): boolean {
  const label = choice.label.trim();
  return /^Type something\.?$/i.test(label) || /^Chat about this$/i.test(label);
}

/** Key of the last choice whose label starts with the word "No"; it gets the destructive style. */
export function destructiveKey(choices: Choice[]): string | undefined {
  for (let i = choices.length - 1; i >= 0; i--) {
    if (/^No\b/.test(choices[i].label)) return choices[i].key;
  }
  return undefined;
}

/** True when both lists have the same keys, labels, marker and parts. */
export function sameChoices(a: Choice[], b: Choice[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => c.key === b[i].key && c.label === b[i].label && c.selected === b[i].selected && sameParts(c.parts, b[i].parts))
  );
}

function sameParts(a: string[] | undefined, b: string[] | undefined): boolean {
  return a === b || (!!a && !!b && a.length === b.length && a.every((p, i) => p === b[i]));
}

/** Longest option label in a push (`short_label` in `companion/src/choices.rs`). */
export const MAX_LABEL = 60;

/** `label` cut to 60 characters (code points). A cut label ends with "…". */
export function shortLabel(label: string): string {
  const chars = Array.from(label);
  if (chars.length <= MAX_LABEL) return label;
  return `${chars.slice(0, MAX_LABEL - 1).join("").trimEnd()}…`;
}

/** True when the label on screen is `expected`, or its cut form (a push carries cut labels). */
export function labelMatches(onScreen: string, expected: string): boolean {
  return onScreen === expected || shortLabel(onScreen) === expected;
}

/** One option of a push's `data.choice`. */
export type ChoiceOption = { key: string; label: string };

/** The first option ("Yes…") and the last option ("No…"), with cut labels, or null for another menu. */
export function yesNo(choices: Choice[]): { yes: ChoiceOption; no: ChoiceOption } | null {
  if (choices.length < 2) return null;
  const first = choices[0];
  const last = choices[choices.length - 1];
  if (!/^Yes(?![\p{L}\p{N}_])/u.test(first.label) || !/^No(?![\p{L}\p{N}_])/u.test(last.label)) return null;
  return { yes: { key: first.key, label: shortLabel(first.label) }, no: { key: last.key, label: shortLabel(last.label) } };
}
