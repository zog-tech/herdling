/**
 * The pure rules of a permission menu on a terminal screen, with no React and no connection.
 * herdlingd has a Rust port (`companion/src/choices.rs`) that uses the same fixtures: keep both the same.
 */

/** One numbered option of an agent's permission menu. */
export type Choice = { key: string /* "1".."9" */; label: string; selected: boolean };

export const NONE: Choice[] = [];
const SCAN_LINES = 20;
const BOX_TAIL = /[\s│╭╮╰╯─]+$/;
const BOX_HEAD = /^[\s│╭╮╰╯─]*/;
const CHOICE_LINE = /^\s*(?:([❯›>])\s*)?(\d)\.\s+(.+?)\s*$/;

/**
 * Numbered choices of a permission menu on the visible screen, or `[]`.
 * Looks only at the last 20 non-empty lines and takes the last block of consecutive choice lines.
 * A line indented deeper than the digit of the choice above it is a wrapped part of that label and is joined onto it.
 * The block counts only when it runs 1..n (n ≥ 2) and exactly one line carries the selection marker.
 */
export function parseChoices(screen: string): Choice[] {
  // Box edges are stripped, but the indent (box characters count as indent) is kept for wrap detection.
  const lines = screen
    .split(/\r?\n/)
    .map((raw) => {
      const l = raw.replace(BOX_TAIL, "");
      const indent = BOX_HEAD.exec(l)![0].length;
      return { indent, text: l.slice(indent) };
    })
    .filter((l) => l.text.length > 0)
    .slice(-SCAN_LINES);

  let block: Choice[] = [];
  let current: Choice[] = [];
  let digitCol = 0;
  for (const { indent, text } of lines) {
    const m = CHOICE_LINE.exec(text);
    if (m) {
      current.push({ key: m[2], label: m[3], selected: !!m[1] });
      digitCol = indent + text.indexOf(m[2]);
    } else if (current.length && indent > digitCol) {
      const last = current[current.length - 1];
      last.label = `${last.label} ${text}`;
    } else if (current.length) {
      block = current;
      current = [];
    }
  }
  if (current.length) block = current;

  if (block.length < 2) return NONE;
  if (!block.every((c, i) => c.key === String(i + 1))) return NONE;
  if (block.filter((c) => c.selected).length !== 1) return NONE;
  return block;
}

/** Key of the last choice whose label starts with the word "No"; it gets the destructive style. */
export function destructiveKey(choices: Choice[]): string | undefined {
  for (let i = choices.length - 1; i >= 0; i--) {
    if (/^No\b/.test(choices[i].label)) return choices[i].key;
  }
  return undefined;
}

/** True when both lists have the same keys, labels and marker. */
export function sameChoices(a: Choice[], b: Choice[]): boolean {
  return a.length === b.length && a.every((c, i) => c.key === b[i].key && c.label === b[i].label && c.selected === b[i].selected);
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
