import { MAX_LINE_CHARS, parseDiff, type DiffLine } from "@/changes/diff";

/**
 * The shape of a tool call for the tool card: an edit diff, a new file, a command, a lookup, or
 * other. It reads the keys of the `input`, not only the tool name, because every host version and
 * every agent sends the same `input`, with its own tool names (`Edit`, `edit`, `replace`,
 * `apply_patch`). Pure: no React, no RPC.
 */

export type ToolDiffFile = { path: string; lines: DiffLine[]; added: number; deleted: number };
export type ToolShape =
  | { kind: "diff"; files: ToolDiffFile[] } // edit, multi-edit, patch
  | { kind: "write"; path: string; content: string; lineCount: number }
  | { kind: "shell"; command: string; description?: string }
  | { kind: "lookup" } // read, search, list, fetch
  | { kind: "other" };

/** Unchanged lines kept before and after each change. */
export const DIFF_CONTEXT = 3;
/** Above this LCS table size (old lines × new lines), the diff is all deletes, then all adds. */
export const LCS_MAX_CELLS = 2_000_000;

/** The row between two groups of changes that are far apart. */
const GAP: DiffLine = { kind: "hunk", text: "⋯" };

const LOOKUP_NAMES = new Set([
  "read",
  "grep",
  "glob",
  "ls",
  "list",
  "find",
  "search",
  "webfetch",
  "websearch",
  "read_file",
  "list_directory",
  "search_file_content",
]);

/** The old and new text keys of the agents: Claude, OpenCode, Pi. */
const PAIRS: [string, string][] = [
  ["old_string", "new_string"],
  ["oldString", "newString"],
  ["oldText", "newText"],
];

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (o: Obj, k: string): string | undefined => (typeof o[k] === "string" ? (o[k] as string) : undefined);

function cut(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}

/** The lines of a text: `\r\n` as `\n`, and no empty element for a final newline. "" has no lines. */
export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function pairOf(o: Obj): [string, string] | undefined {
  for (const [a, b] of PAIRS) {
    const oldText = str(o, a);
    const newText = str(o, b);
    if (oldText !== undefined && newText !== undefined) return [oldText, newText];
  }
  return undefined;
}

function pathOf(o: Obj): string {
  for (const k of ["file_path", "filePath", "path"]) {
    const v = str(o, k);
    if (v !== undefined) return v;
  }
  return "";
}

function counted(path: string, lines: DiffLine[]): ToolDiffFile {
  let added = 0;
  let deleted = 0;
  for (const l of lines) {
    if (l.kind === "add") added += 1;
    else if (l.kind === "del") deleted += 1;
  }
  return { path, lines, added, deleted };
}

/** The row kinds of a line diff in order, before the context cut. */
type Op = { kind: "add" | "del" | "ctx"; line: string };

function ops(a: string[], b: string[]): Op[] {
  // The common start and end need no LCS. This keeps the table small for a typical edit.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let post = 0;
  while (post < a.length - pre && post < b.length - pre && a[a.length - 1 - post] === b[b.length - 1 - post]) post++;
  const head: Op[] = a.slice(0, pre).map((line) => ({ kind: "ctx", line }));
  const tail: Op[] = a.slice(a.length - post).map((line) => ({ kind: "ctx", line }));
  const x = a.slice(pre, a.length - post);
  const y = b.slice(pre, b.length - post);
  const n = x.length;
  const m = y.length;
  const mid: Op[] = [];
  if (n * m > LCS_MAX_CELLS) {
    // A very large edit: an LCS would take too long and too much memory on a phone.
    for (const line of x) mid.push({ kind: "del", line });
    for (const line of y) mid.push({ kind: "add", line });
  } else if (n > 0 && m > 0) {
    // t[i][j] = LCS length of x[i..] and y[j..].
    const w = m + 1;
    const t = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) {
        mid.push({ kind: "ctx", line: x[i] });
        i++;
        j++;
      } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) {
        mid.push({ kind: "del", line: x[i++] });
      } else {
        mid.push({ kind: "add", line: y[j++] });
      }
    }
    while (i < n) mid.push({ kind: "del", line: x[i++] });
    while (j < m) mid.push({ kind: "add", line: y[j++] });
  } else {
    for (const line of x) mid.push({ kind: "del", line });
    for (const line of y) mid.push({ kind: "add", line });
  }
  return [...head, ...mid, ...tail];
}

const SIGN = { add: "+", del: "-", ctx: " " } as const;

/**
 * Rows of a line diff from old to new text, with `context` unchanged lines around each change.
 * Groups far apart get a "⋯" row between them. No line numbers: the offset in the file is unknown.
 */
export function lineDiff(oldText: string, newText: string, context = DIFF_CONTEXT): DiffLine[] {
  const all = ops(splitLines(oldText), splitLines(newText));
  // Keep a row when it is a change, or within `context` rows of a change.
  const keep = new Uint8Array(all.length);
  let last = -Infinity;
  for (let i = 0; i < all.length; i++) {
    if (all[i].kind !== "ctx") last = i;
    if (i - last <= context) keep[i] = 1;
  }
  last = Infinity;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].kind !== "ctx") last = i;
    if (last - i <= context) keep[i] = 1;
  }
  const out: DiffLine[] = [];
  let skipped = false;
  for (let i = 0; i < all.length; i++) {
    if (!keep[i]) {
      skipped = true;
      continue;
    }
    if (skipped && out.length > 0) out.push(GAP);
    skipped = false;
    const o = all[i];
    out.push({ kind: o.kind, text: cut(SIGN[o.kind] + o.line) });
  }
  return out;
}

const PATCH_FILE = /^\*\*\* (?:Update|Add|Delete) File: (.*)$/;

/** The files of a Codex `apply_patch` text (`*** Begin Patch` … `*** End Patch`). */
export function parsePatch(text: string): ToolDiffFile[] {
  const files: { path: string; lines: DiffLine[] }[] = [];
  let cur: { path: string; lines: DiffLine[] } | undefined;
  for (const raw of splitLines(text)) {
    if (raw.startsWith("*** End Patch")) break;
    const file = PATCH_FILE.exec(raw);
    if (file) {
      cur = { path: file[1].trim(), lines: [] };
      files.push(cur);
      continue;
    }
    if (!cur || raw.startsWith("*** Move to: ") || raw.startsWith("*** End of File")) continue;
    const c = raw[0];
    if (c === "+") cur.lines.push({ kind: "add", text: cut(raw) });
    else if (c === "-") cur.lines.push({ kind: "del", text: cut(raw) });
    else if (c === " ") cur.lines.push({ kind: "ctx", text: cut(raw) });
    else if (raw.startsWith("@@")) cur.lines.push({ kind: "hunk", text: cut(raw) });
    // Some writers drop the space of an empty context line.
    else if (raw === "") cur.lines.push({ kind: "ctx", text: " " });
  }
  return files.map((f) => counted(f.path, f.lines));
}

/** A unified diff (`--- a/x`, `diff --git`) as tool diff files. Header lines are dropped. */
function unifiedFiles(text: string): ToolDiffFile[] {
  // `parseDiff` starts a file at `diff --git`. A plain unified diff has none, so add one;
  // the `---` and `+++` lines then set the real path.
  const src = text.startsWith("diff --git") ? text : `diff --git a/? b/?\n${text}`;
  return parseDiff(src).map((f) => ({
    path: f.path,
    lines: f.lines.filter((l) => l.kind !== "meta"),
    added: f.added,
    deleted: f.deleted,
  }));
}

function patchShape(input: unknown): ToolShape | undefined {
  let text: string | undefined;
  if (typeof input === "string") text = input;
  else if (isObj(input)) text = str(input, "input") ?? str(input, "patch") ?? str(input, "diff");
  if (text === undefined) return undefined;
  let files: ToolDiffFile[] = [];
  if (text.includes("*** Begin Patch")) files = parsePatch(text);
  else if (text.startsWith("--- ") || text.startsWith("diff --git")) files = unifiedFiles(text);
  return files.length > 0 ? { kind: "diff", files } : undefined;
}

function multiEditShape(o: Obj): ToolShape | undefined {
  const edits = o.edits;
  if (!Array.isArray(edits) || edits.length === 0) return undefined;
  const pairs: [string, string][] = [];
  for (const e of edits) {
    const p = isObj(e) ? pairOf(e) : undefined;
    if (!p) return undefined;
    pairs.push(p);
  }
  const lines: DiffLine[] = [];
  pairs.forEach(([a, b], i) => {
    if (i > 0) lines.push(GAP);
    lines.push(...lineDiff(a, b));
  });
  return { kind: "diff", files: [counted(pathOf(o), lines)] };
}

function shellCommand(o: Obj): string | undefined {
  const c = str(o, "command") ?? str(o, "cmd");
  if (c !== undefined) return c;
  const argv = o.command;
  // An argv array (`["bash", "-lc", "pnpm test"]`): the last element is the command line.
  if (Array.isArray(argv) && argv.length > 0 && argv.every((s) => typeof s === "string")) return argv[argv.length - 1] as string;
  return undefined;
}

/** The shape of a tool call, from its name and input. Never throws; an unknown input is "other". */
export function classifyTool(name: string, input: unknown): ToolShape {
  const patch = patchShape(input);
  if (patch) return patch;
  if (isObj(input)) {
    const multi = multiEditShape(input);
    if (multi) return multi;
    const pair = pairOf(input);
    if (pair) return { kind: "diff", files: [counted(pathOf(input), lineDiff(pair[0], pair[1]))] };
    const content = str(input, "content") ?? str(input, "text");
    const hasPath = ["file_path", "filePath", "path"].some((k) => str(input, k) !== undefined);
    if (content !== undefined && hasPath) {
      return { kind: "write", path: pathOf(input), content, lineCount: splitLines(content).length };
    }
    const command = shellCommand(input);
    if (command !== undefined) {
      const description = str(input, "description");
      return description !== undefined ? { kind: "shell", command, description } : { kind: "shell", command };
    }
  }
  if (LOOKUP_NAMES.has(name.toLowerCase())) return { kind: "lookup" };
  return { kind: "other" };
}

/** The added and deleted line counts of a diff, for the card header. Null for other kinds. */
export function diffCounts(shape: ToolShape): { added: number; deleted: number } | null {
  if (shape.kind !== "diff") return null;
  let added = 0;
  let deleted = 0;
  for (const f of shape.files) {
    added += f.added;
    deleted += f.deleted;
  }
  return { added, deleted };
}
