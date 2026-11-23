/**
 * The pure rules of a permission menu on a terminal screen, with no React and no connection.
 * herdlingd has a Rust port (`companion/src/choices.rs`) that uses the same fixtures: keep both the same.
 * The display data (`parts`, `parseMenu`, `menuQuestion`, `choiceView`, `isFreeform`) is only in the app.
 * The menus with no numbers (`scanUnnumbered`, `answerKeys`) are also only in the app: herdlingd
 * answers a push with a digit, so `parseChoices` keeps to numbered menus.
 */

import { CHECKBOX, NEXT_CURSOR, tabsAbove, type QuestionTabs } from "./questionTabs";

/**
 * One option of an agent's permission menu.
 * `parts`: the first line of the option and its continuation lines, for display only (from `parseMenu`).
 * `label` is all parts joined with a space; herdlingd matches answers on it.
 * `numbered: false`: an option of a menu with no numbers on the screen (only from `parseMenu`). Its
 * `key` is its place in the menu ("1".."n"), and the app answers with the arrow keys and Enter.
 * `checked`: an option of a multi-select question ("[✔] Title"), only from `parseMenu`. The digit
 * turns its checkbox on or off. The label and the parts have no checkbox.
 */
export type Choice = {
  key: string /* "1".."9" */;
  label: string;
  selected: boolean;
  parts?: string[];
  numbered?: false;
  checked?: boolean;
};

export const NONE: Choice[] = [];
const SCAN_LINES = 20;
const BOX_TAIL = /[\s│╭╮╰╯─]+$/;
const BOX_HEAD = /^[\s│╭╮╰╯─]*/;
const CHOICE_LINE = /^\s*(?:([❯›>])\s*)?(\d)\.\s+(.+?)\s*$/;
/** Most lines of question text that `menuQuestion` takes. */
const QUESTION_LINES = 3;
/** Most lines of prompt context that `parseMenu` keeps: the lines nearest to the question. */
export const CONTEXT_LINES = 60;
/** A rule line: only line characters and box corners (side bars removed first). */
const RULE = /^[╭╮╰╯┌┐└┘+─━═╌┄┈╍-]{3,}$/;
/** A solid rule of the prompt frame. A dashed rule (`╌`) is a separator inside the prompt. */
const SOLID_RULE = /^[╭╰┌└+]?[─━═-]{3,}[╮╯┐┘+]?$/;
/**
 * The question of a Claude Code permission prompt. Only these menus get a `context`.
 * Newer prompts ask "Allow this read outside the working directories?".
 */
const PROMPT_QUESTION = /^(?:…)?(?:(?:Do|Would) you (?:want|like) to|Allow)\b/i;
/** The footer of a Claude Code permission prompt, also for a question in other words. */
const PROMPT_FOOTER = /\bTab to amend\b/;
/** The cursor line of a menu with no numbers: "❯ Deny". A numbered line (`CHOICE_LINE`) is not one. */
const CURSOR_LINE = /^❯\s+(\S.*?)\s*$/;
/** A key hint line under a menu ("Esc to cancel", "Enter to select · ↑/↓ to navigate"). */
const MENU_FOOTER = /\b(?:Esc|Enter|Tab) to\b|↑\/↓/i;
/** Most options of a menu with no numbers. */
const MAX_OPTIONS = 9;
/** A line of the agent's own output (a message or the prompt line): the context never goes past it. */
const AGENT_LINE = /^\s*[⏺●❯›]\s/;

type Line = { indent: number; text: string; raw: string };
/** A choice block on the screen: its choices (with parts) and the index of its first line in `lines`. */
type Scan = { lines: Line[]; block: Choice[]; start: number };

/** All screen lines with box edges stripped. The indent (box characters count as indent) is kept for wrap detection. */
function screenLines(screen: string): Line[] {
  return screen.split(/\r?\n/).map((raw) => {
    const l = raw.replace(BOX_TAIL, "");
    const indent = BOX_HEAD.exec(l)![0].length;
    return { indent, text: l.slice(indent), raw };
  });
}

/**
 * The rules of `parseChoices`, plus the parts of each option and the place of the block.
 * `cursors`: the number of option lines with the `❯` marker (0 when the cursor is on the "Next"
 * row of a multi-select question).
 */
function scan(screen: string, cursors = 1): Scan {
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
    block.length >= 2 && block.every((c, i) => c.key === String(i + 1)) && block.filter((c) => c.selected).length === cursors;
  return valid ? { lines, block, start } : { lines, block: NONE, start: -1 };
}

/**
 * A menu with no numbers at the bottom of the screen ("❯ Deny" over "  Deliver this message").
 * The rules are strict, so that ordinary output never becomes a menu:
 * - Only blank lines and key hint lines (`MENU_FOOTER`) can follow the menu.
 * - Exactly one option line has the `❯` cursor. Each option line starts at the label column of the
 *   cursor line. A line indented deeper is a wrapped part of the option above it.
 * - The menu has 2 to 9 options.
 * - A blank line, a rule line or the top of the screen is directly above the menu.
 * The idle prompt ("❯ " in a box) is no menu: a rule line follows it, and an empty "❯" has no label.
 */
function scanUnnumbered(lines: Line[]): Scan {
  const none: Scan = { lines, block: NONE, start: -1 };
  let end = lines.length;
  while (end > 0 && (!lines[end - 1].text || MENU_FOOTER.test(lines[end - 1].text))) end--;
  // The block: the lines above `end` up to a blank line or a rule line.
  let top = end;
  while (top > 0 && lines[top - 1].text && !isRule(lines[top - 1].raw)) top--;
  const cursors: number[] = [];
  for (let i = top; i < end; i++) {
    if (CURSOR_LINE.test(lines[i].text) && !CHOICE_LINE.test(lines[i].text)) cursors.push(i);
  }
  if (cursors.length !== 1) return none;
  const at = cursors[0];
  const cursor = lines[at];
  const col = cursor.indent + cursor.text.indexOf(CURSOR_LINE.exec(cursor.text)![1]);
  // The first line of the block must be an option line: other text above the options is no menu.
  if (top !== at && lines[top].indent !== col) return none;

  const block: Choice[] = [];
  for (let i = top; i < end; i++) {
    const { indent, text } = lines[i];
    if (i === at || indent === col) {
      const label = i === at ? CURSOR_LINE.exec(text)![1] : text.trim();
      block.push({ key: String(block.length + 1), label, selected: i === at, parts: [label], numbered: false });
    } else if (indent > col && block.length) {
      const last = block[block.length - 1];
      last.label = `${last.label} ${text.trim()}`;
      last.parts!.push(text.trim());
    } else {
      return none;
    }
  }
  return block.length >= 2 && block.length <= MAX_OPTIONS ? { lines, block, start: top } : none;
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

/**
 * A menu for display: the choices of `parseChoices` with their `parts`, and the question above them.
 * `context`: the body of a Claude Code permission prompt above the question (the title, the command,
 * the description, a warning), as screen lines. Undefined for other menus.
 */
export type Menu = {
  choices: Choice[];
  question?: string;
  context?: string;
  /** The question tabs of an AskUserQuestion with more than one question (`questionTabs.ts`). */
  tabs?: QuestionTabs;
  /** The "Next" row of a multi-select question. `selected`: the cursor is on it. */
  next?: { selected: boolean };
};

/** A numbered option with a checkbox: the line above the "Next" row of a multi-select question. */
const CHECKBOX_LINE = /^\s*(?:[❯›>]\s*)?\d\.\s+\[[ ✔✓xX×]\]\s/;

/** `parseChoices`, `menuQuestion` and the prompt context in one pass, for the buttons in the app. */
export function parseMenu(screen: string): Menu {
  const raw = screen.split(/\r?\n/);
  // The cursor on the "Next" row of a multi-select question: no option line has the marker.
  const nextAt = nextCursorLine(raw);
  if (nextAt >= 0) raw[nextAt] = raw[nextAt].replace("❯", " ");
  const s = nextAt >= 0 ? scan(raw.join("\n"), 0) : scan(screen);
  if (!s.block.length) return unnumberedMenu(scanUnnumbered(s.lines));
  const q = questionTop(s);
  const footer = s.lines.slice(-6).some((l) => PROMPT_FOOTER.test(l.text));
  const context = q.question && (PROMPT_QUESTION.test(q.question) || footer) ? contextAbove(s.lines, q.top) : undefined;
  const menu: Menu = context ? { choices: s.block, question: q.question, context } : { choices: s.block, question: q.question };
  return questionParts(menu, s, nextAt >= 0);
}

/** The line of the "Next" row with the cursor on it, right under a checkbox option, or -1. */
function nextCursorLine(raw: string[]): number {
  for (let i = raw.length - 1; i > 0; i--) {
    if (!NEXT_CURSOR.test(raw[i])) continue;
    let j = i - 1;
    while (j >= 0 && !raw[j].trim()) j--;
    return j >= 0 && CHECKBOX_LINE.test(raw[j]) ? i : -1;
  }
  return -1;
}

/**
 * The parts of an AskUserQuestion menu: the checkboxes and the "Next" row of a multi-select
 * question, and the tab bar of a menu with more than one question. On the review screen (the
 * "Submit" tab) the question is "Review your answers" and the context is the list of answers.
 */
function questionParts(menu: Menu, s: Scan, nextSelected: boolean): Menu {
  let out = menu;
  if (menu.choices.some((c) => CHECKBOX.test(c.parts?.[0] ?? ""))) {
    const choices = menu.choices.map((c): Choice => {
      const m = CHECKBOX.exec(c.parts?.[0] ?? "");
      if (!m) return c;
      const parts = [c.parts![0].slice(m[0].length), ...c.parts!.slice(1)];
      return { ...c, label: parts.join(" "), parts, checked: m[1] !== " " };
    });
    let last = -1;
    choices.forEach((c, i) => {
      if (c.checked !== undefined) last = i;
    });
    // The "Next" row is indented deeper than the digit, so the scan takes it as a part of the last checkbox option.
    const parts = choices[last].parts!;
    if (parts.length > 1 && parts[parts.length - 1] === "Next") {
      const kept = parts.slice(0, -1);
      choices[last] = { ...choices[last], parts: kept, label: kept.join(" ") };
      out = { ...out, choices, next: { selected: nextSelected } };
    } else {
      out = { ...out, choices };
    }
  }
  const found = tabsAbove(
    s.lines.map((l) => l.raw),
    s.start,
  );
  if (!found) return out;
  out = { ...out, tabs: found.tabs };
  if (found.review >= 0) {
    const review = reviewContext(s.lines.slice(found.review + 1, s.start).map((l) => l.raw));
    out = { ...out, question: s.lines[found.review].raw.trim(), context: review };
  }
  return out;
}

/** The answers on the review screen, less the indent that all lines share, or undefined. */
function reviewContext(raw: string[]): string | undefined {
  const body = raw.map((l) => l.trimEnd());
  const filled = body.filter((l) => l.trim());
  if (!filled.length) return undefined;
  const shared = Math.min(...filled.map((l) => /^ */.exec(l)![0].length));
  return body
    .map((l) => (l.trim() ? l.slice(shared) : ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/**
 * A menu with no numbers, for display. The question is the text directly above the options, as for
 * a numbered menu. When a box or a rule line is directly above the options (a "Held message"
 * prompt), the question is the title of the prompt: the first line under its solid rule. The
 * lines between the title and the options (the sender, the message body) are the `context`.
 */
function unnumberedMenu(s: Scan): Menu {
  if (!s.block.length) return { choices: NONE };
  const q = questionTop(s);
  if (q.question) {
    const footer = s.lines.slice(-6).some((l) => PROMPT_FOOTER.test(l.text));
    const context = PROMPT_QUESTION.test(q.question) || footer ? contextAbove(s.lines, q.top) : undefined;
    return context ? { choices: s.block, question: q.question, context } : { choices: s.block, question: q.question };
  }
  const title = promptTitle(s.lines, s.start);
  if (title < 0) return { choices: s.block };
  const question = s.lines[title].text.trim();
  const context = contextAbove(s.lines, s.start, title);
  return context ? { choices: s.block, question, context } : { choices: s.block, question };
}

/**
 * The index of the prompt title above the line `start`: the first text line under the nearest solid
 * rule. -1 when a line of the agent's output or the top of the screen comes first.
 */
function promptTitle(lines: Line[], start: number): number {
  for (let i = start - 1; i >= 0; i--) {
    const raw = lines[i].raw;
    if (AGENT_LINE.test(raw)) return -1;
    if (!SOLID_RULE.test(raw.trim())) continue;
    for (let j = i + 1; j < start; j++) {
      if (!isRule(lines[j].raw) && /[\p{L}\p{N}]/u.test(lines[j].text)) return j;
    }
    return -1;
  }
  return -1;
}

/**
 * The question text directly above the menu, or undefined.
 * Blank lines just above the first choice are skipped. Then the lines up to the next blank line,
 * box line or choice line are taken (at most 3) and joined with a space.
 * A longer paragraph keeps its last 3 lines and starts with "…".
 */
export function menuQuestion(screen: string): string | undefined {
  return questionTop(scan(screen)).question;
}

/** True for a horizontal rule line, also inside a box (`│ ╰───╯ │`). */
function isRule(raw: string): boolean {
  return RULE.test(raw.replace(/[│\s]/g, ""));
}

/** The question above the menu and the index of its first line (the menu start when there is none). */
function questionTop({ lines, start }: Scan): { question?: string; top: number } {
  if (start < 0) return { top: -1 };
  let i = start - 1;
  while (i >= 0 && !lines[i].text) i--;
  const taken: string[] = [];
  let top = start;
  // A rule line ends the question: Claude Code can draw one right above it.
  for (; i >= 0 && lines[i].text && !CHOICE_LINE.test(lines[i].text) && !isRule(lines[i].raw); i--) {
    if (taken.length === QUESTION_LINES) {
      taken[0] = `…${taken[0]}`;
      break;
    }
    taken.unshift(lines[i].text.trim());
    top = i;
  }
  const question = taken.join(" ").replace(/\s+/g, " ").trim();
  // A line of only marks (a cursor, a rule) is no question.
  return /[\p{L}\p{N}]/u.test(question) ? { question, top } : { top };
}

/**
 * The prompt body above the question line `top`, or undefined. It goes up to the solid rule of the
 * prompt frame, to a line of the agent's output, to the line `floor` (not included), or to the top of
 * the screen (a long command pushes the frame off the screen). Rule lines inside the prompt are left
 * out. Box side bars and trailing white space are removed; the indent of the command stays, less the
 * indent that all lines share.
 */
function contextAbove(lines: Line[], top: number, floor = -1): string | undefined {
  const taken: string[] = [];
  for (let i = top - 1; i > floor && taken.length < CONTEXT_LINES; i--) {
    const raw = lines[i].raw;
    const bare = raw.trim();
    if (SOLID_RULE.test(bare)) break;
    if (isRule(raw)) continue;
    if (AGENT_LINE.test(raw)) break;
    // Blank lines right above the question do not count toward the cap.
    if (!taken.length && !bare) continue;
    taken.unshift(raw);
  }
  let body = taken.map((l) => l.replace(/^(\s*│)+/, "").replace(/[\s│]+$/, ""));
  // A box of "|" side bars: strip them only when every line has one, so a "| grep" line stays.
  const filled = body.filter((l) => l.trim());
  if (filled.length && filled.every((l) => /^\s*\|/.test(l))) body = body.map((l) => l.replace(/^\s*\|/, "").trimEnd());
  const shared = Math.min(...body.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  body = body.map((l) => (l.trim() ? l.slice(shared) : ""));
  // No blank lines at the ends, and at most one blank line in a row.
  const text = body
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
  return /[\p{L}\p{N}]/u.test(text) ? text : undefined;
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

/** True for the "Type something" option of Claude Code: a text field on the screen. */
function isTypeRow(choice: Choice): boolean {
  return /^Type something\.?$/i.test(choice.label.trim());
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

/**
 * The keys that answer `choice` with `pane.send_keys`, on the menu `now` (the screen as it is now).
 * A numbered menu: the bare digit (Claude's selector confirms on it, so no Enter).
 * A menu with no numbers: "down" or "up" from the `❯` option to `choice`, then "enter".
 * With the cursor on the "Type something" row, a digit goes into its text field. So the keys
 * start with "up" (off the row), and a pick of that row itself sends no key.
 */
export function answerKeys(now: Choice[], choice: Choice): string[] {
  if (choice.numbered !== false) {
    const at = now.find((c) => c.selected);
    if (!at || !isTypeRow(at)) return [choice.key];
    return at.key === choice.key ? [] : ["up", choice.key];
  }
  const from = Math.max(0, now.findIndex((c) => c.selected));
  const to = Number(choice.key) - 1;
  const steps = Array.from({ length: Math.abs(to - from) }, () => (to > from ? "down" : "up"));
  return [...steps, "enter"];
}

/** True when both lists have the same keys, labels, marker, numbering, checkbox and parts. */
export function sameChoices(a: Choice[], b: Choice[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (c, i) =>
        c.key === b[i].key &&
        c.label === b[i].label &&
        c.selected === b[i].selected &&
        c.numbered === b[i].numbered &&
        c.checked === b[i].checked &&
        sameParts(c.parts, b[i].parts),
    )
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
