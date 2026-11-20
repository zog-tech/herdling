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

/**
 * A menu for display: the choices of `parseChoices` with their `parts`, and the question above them.
 * `context`: the body of a Claude Code permission prompt above the question (the title, the command,
 * the description, a warning), as screen lines. Undefined for other menus.
 */
export type Menu = { choices: Choice[]; question?: string; context?: string };

/** `parseChoices`, `menuQuestion` and the prompt context in one pass, for the buttons in the app. */
export function parseMenu(screen: string): Menu {
  const s = scan(screen);
  if (!s.block.length) return { choices: NONE };
  const q = questionTop(s);
  const footer = s.lines.slice(-6).some((l) => PROMPT_FOOTER.test(l.text));
  const context = q.question && (PROMPT_QUESTION.test(q.question) || footer) ? contextAbove(s.lines, q.top) : undefined;
  return context ? { choices: s.block, question: q.question, context } : { choices: s.block, question: q.question };
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
 * prompt frame, to a line of the agent's output, or to the top of the screen (a long command pushes
 * the frame off the screen). Rule lines inside the prompt are left out. Box side bars and trailing
 * white space are removed; the indent of the command stays, less the indent that all lines share.
 */
function contextAbove(lines: Line[], top: number): string | undefined {
  const taken: string[] = [];
  for (let i = top - 1; i >= 0 && taken.length < CONTEXT_LINES; i--) {
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
