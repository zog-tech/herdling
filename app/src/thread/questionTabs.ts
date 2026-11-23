/**
 * The question tabs of Claude Code's AskUserQuestion, when it asks more than one question at once.
 * The terminal shows a tab bar above the question:
 *
 *   ←  ☒ Share flow  ☐ Content  ☐ Release  ✔ Submit  →
 *
 * "☐" is an open question, "☒" an answered one, and the last tab ("✔ Submit") is the review
 * screen. The Left and Right arrow keys move between the tabs; they do not wrap. The arrows move
 * the tab only while the cursor is on a normal option: on the "Type something" row, the "Next" row
 * of a multi-select question and the "Chat about this" row they do nothing. A tab move puts the
 * cursor on the first option.
 *
 * The current tab has only a background color, so the plain text does not show it. The review
 * screen ("Review your answers") is always the last tab. For the other tabs, `currentTabFromAnsi`
 * finds it on an ANSI read of the screen.
 *
 * Pure rules only: no React and no connection.
 */

/** One tab of the bar. `submit`: the last tab, the review screen. */
export type QuestionTab = { title: string; answered: boolean; submit: boolean };
/** The tab bar. `current` is undefined when the screen text does not show it. */
export type QuestionTabs = { items: QuestionTab[]; current?: number };
/** A move to the tab at index `to`, or one tab to the left (-1) or right (1). */
export type TabMove = { to: number } | { by: -1 | 1 };

/** The marks of a tab: open, answered, and the mark of the "Submit" tab. */
const MARKS = /[☐☒✔]/g;
/** A tab bar: an arrow at each end and at least two marks between them. */
const TAB_BAR = /^\s*←\s.*→\s*$/;
/** The title of the review screen: the "Submit" tab is current. */
export const REVIEW_TITLE = /^\s*Review your answers\s*$/;
/** A checkbox at the start of a multi-select option: "[ ] Title", "[✔] Title". */
export const CHECKBOX = /^\[([ ✔✓xX×])\]\s+/;
/** The "Next" row under the options of a multi-select question, with the cursor on it. */
export const NEXT_CURSOR = /^(\s*)❯(\s+Next\s*)$/;
/** Any escape sequence: SGR, cursor moves, mode changes. */
const ESCAPE = /\x1b\[[0-9;:?<>=]*[A-Za-z]/g;

/** True when `line` (plain text) is a tab bar with at least two tabs. */
export function isTabBar(line: string): boolean {
  return TAB_BAR.test(line) && (line.match(MARKS)?.length ?? 0) >= 2;
}

/** The tabs of a tab bar line (plain text). A narrow terminal cuts the titles ("C…"). */
export function parseTabBar(line: string): QuestionTab[] {
  const body = line.replace(/^\s*←/, "").replace(/→\s*$/, "");
  const found = [...body.matchAll(/([☐☒✔])([^☐☒✔]*)/g)];
  return found.map((m, i) => {
    const submit = i === found.length - 1 && m[1] === "✔";
    return { title: m[2].trim(), answered: m[1] !== "☐" && !submit, submit };
  });
}

/**
 * The index of the tab bar in the screen `lines` (plain text), or -1. The bar must be the last one
 * on the screen and above the line `below` (the first option of the menu).
 */
export function tabBarLine(lines: string[], below: number): number {
  for (let i = Math.min(below, lines.length) - 1; i >= 0; i--) {
    if (isTabBar(lines[i])) return i;
  }
  return -1;
}

/**
 * The tab bar above the menu that starts at the line `below`, or undefined. `current` is the last
 * tab when the review screen shows ("Review your answers" between the bar and the menu).
 */
export function tabsAbove(lines: string[], below: number): { tabs: QuestionTabs; bar: number; review: number } | undefined {
  const bar = tabBarLine(lines, below);
  if (bar < 0) return undefined;
  const items = parseTabBar(lines[bar]);
  let review = -1;
  for (let i = bar + 1; i < below; i++) {
    if (REVIEW_TITLE.test(lines[i])) review = i;
  }
  const last = items.length - 1;
  const tabs: QuestionTabs = review >= 0 && items[last].submit ? { items, current: last } : { items };
  return { tabs, bar, review };
}

/**
 * The index of the current tab on an ANSI screen (`pane.read` with `format: "ansi"`), or undefined.
 * The current tab is the first mark in a run with a background color (or inverse video) on the
 * last tab bar line.
 */
export function currentTabFromAnsi(ansi: string): number | undefined {
  const rows = ansi.split(/\r?\n/);
  for (let r = rows.length - 1; r >= 0; r--) {
    if (!isTabBar(rows[r].replace(ESCAPE, ""))) continue;
    return litMark(rows[r]);
  }
  return undefined;
}

/** The index of the first mark with a background color on one ANSI line, or undefined. */
function litMark(row: string): number | undefined {
  let bg = false;
  let inverse = false;
  let mark = -1;
  let at = 0;
  const step = (text: string) => {
    for (const ch of text) {
      if (/[☐☒✔]/.test(ch)) mark++;
      if ((bg || inverse) && mark >= 0 && /[☐☒✔]/.test(ch)) return mark;
    }
    return undefined;
  };
  for (const m of row.matchAll(ESCAPE)) {
    const hit = step(row.slice(at, m.index));
    if (hit !== undefined) return hit;
    at = m.index! + m[0].length;
    if (!m[0].endsWith("m")) continue;
    const p = m[0].slice(2, -1).split(/[;:]/);
    for (let i = 0; i < p.length; i++) {
      const n = p[i] === "" ? 0 : Number(p[i]);
      if (n === 0) {
        bg = false;
        inverse = false;
      } else if (n === 7) inverse = true;
      else if (n === 27) inverse = false;
      else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) bg = true;
      else if (n === 49) bg = false;
      else if (n === 38 || n === 48) {
        // An extended color: "5;n" or "2;r;g;b" follow.
        if (n === 48) bg = true;
        i += p[i + 1] === "5" ? 2 : p[i + 1] === "2" ? 4 : 0;
      }
    }
  }
  return step(row.slice(at));
}

/** The plain-text lines of an ANSI screen. */
export function stripAnsi(ansi: string): string {
  return ansi.replace(ESCAPE, "");
}

/** True when both bars have the same tabs (titles, marks) and the same current tab. */
export function sameTabs(a: QuestionTabs | undefined, b: QuestionTabs | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.current === b.current &&
    a.items.length === b.items.length &&
    a.items.every((t, i) => t.title === b.items[i].title && t.answered === b.items[i].answered && t.submit === b.items[i].submit)
  );
}

/** True when both bars have the same titles: the same set of questions. */
export function sameTitles(a: QuestionTabs | undefined, b: QuestionTabs | undefined): boolean {
  return !!a && !!b && a.items.length === b.items.length && a.items.every((t, i) => t.title === b.items[i].title);
}

/** The rows of a question that the cursor can be on, as they are on the screen. */
type Row = { kind: "option" | "freeform" | "next" ; selected: boolean };

/**
 * The keys that move from the current tab to the tab of `move`.
 * First "up" moves the cursor off a row where the arrows do nothing (the "Type something" row, the
 * "Next" row, "Chat about this") onto the last normal option above it. Then:
 * - `{ by }`: one "left" or "right".
 * - `{ to }` with a known current tab: the arrows from the current tab to `to`.
 * - `{ to }` with no known current tab: "left" to the first tab (the arrows do not wrap), then
 *   "right" to `to`.
 * `rows`: the cursor rows of the question, from `cursorRows`.
 */
export function tabKeys(tabs: QuestionTabs, rows: Row[], move: TabMove): string[] {
  const n = tabs.items.length;
  let arrows: string[];
  if ("by" in move) {
    if (tabs.current !== undefined && (tabs.current + move.by < 0 || tabs.current + move.by >= n)) return [];
    arrows = [move.by > 0 ? "right" : "left"];
  } else {
    const to = Math.max(0, Math.min(n - 1, move.to));
    if (tabs.current === to) return [];
    if (tabs.current !== undefined) {
      const d = to - tabs.current;
      arrows = Array.from({ length: Math.abs(d) }, () => (d > 0 ? "right" : "left"));
    } else {
      arrows = [...Array.from({ length: n - 1 }, () => "left"), ...Array.from({ length: to }, () => "right")];
    }
  }
  return [...Array.from({ length: upsToOption(rows) }, () => "up"), ...arrows];
}

/** The number of "up" keys from the cursor to the last normal option above it (0 when the cursor is on one). */
export function upsToOption(rows: Row[]): number {
  const at = rows.findIndex((r) => r.selected);
  if (at < 0 || rows[at].kind === "option") return 0;
  for (let i = at - 1; i >= 0; i--) {
    if (rows[i].kind === "option") return at - i;
  }
  return 0;
}

/**
 * The cursor rows of a question in screen order: the options, with the "Next" row of a multi-select
 * question after its last checkbox option (before "Chat about this").
 */
export function cursorRows(
  choices: { selected: boolean; checked?: boolean; freeform: boolean }[],
  next?: { selected: boolean },
): Row[] {
  const rows: Row[] = choices.map((c) => ({ kind: c.freeform ? "freeform" : "option", selected: c.selected }));
  if (next) {
    let last = -1;
    choices.forEach((c, i) => {
      if (c.checked !== undefined) last = i;
    });
    rows.splice(last + 1, 0, { kind: "next", selected: next.selected });
  }
  return rows;
}
