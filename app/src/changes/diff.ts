import type { GitChangedFile } from "@herdling/protocol";

/**
 * Unified diff text (`git.diff`) as rows for the diff view, and the labels of the Changes list.
 * Pure: no React, no RPC.
 */

export type DiffLineKind = "add" | "del" | "ctx" | "hunk" | "meta" | "binary" | "note";

export type DiffLine = {
  kind: DiffLineKind;
  /** The line as git printed it, sign included (cut at `MAX_LINE_CHARS`). */
  text: string;
  /** Line numbers in the old and the new file. Only on `add`, `del` and `ctx` lines. */
  oldNo?: number;
  newNo?: number;
};

export type DiffFile = {
  /** The new path (the old path for a deleted file), from the repo root. */
  path: string;
  /** The old path of a renamed file. */
  oldPath?: string;
  lines: DiffLine[];
  binary: boolean;
  added: number;
  deleted: number;
};

/** A longer line is cut, so one line cannot make the view very wide. */
export const MAX_LINE_CHARS = 400;
/** Rows the diff view shows at first and adds per "Show more". */
export const DIFF_PAGE_LINES = 1500;

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** `a/src/x.ts` → `src/x.ts`. A quoted path (`"a/x y"`) loses its quotes. */
function stripPrefix(p: string): string {
  let s = p.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s.replace(/^[ab]\//, "");
}

function cut(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}

/** Splits unified diff text into files and typed lines. Unknown lines before a file header are dropped. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: DiffFile | undefined;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (const raw of lines) {
    if (raw.startsWith("diff --git ")) {
      // `diff --git a/x b/x`: the b/ path, unless a later `+++` line says more.
      const m = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(raw);
      cur = { path: m?.[2] ?? raw.slice(11), lines: [{ kind: "meta", text: cut(raw) }], binary: false, added: 0, deleted: 0 };
      if (m && m[1] !== m[2]) cur.oldPath = m[1];
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      cur.lines.push({ kind: "hunk", text: cut(raw) });
      continue;
    }
    if (inHunk) {
      const c = raw[0];
      if (c === "+") {
        cur.added += 1;
        cur.lines.push({ kind: "add", text: cut(raw), newNo: newNo++ });
        continue;
      }
      if (c === "-") {
        cur.deleted += 1;
        cur.lines.push({ kind: "del", text: cut(raw), oldNo: oldNo++ });
        continue;
      }
      if (c === " " || raw === "") {
        cur.lines.push({ kind: "ctx", text: cut(raw), oldNo: oldNo++, newNo: newNo++ });
        continue;
      }
      if (c === "\\") {
        cur.lines.push({ kind: "note", text: cut(raw) });
        continue;
      }
      inHunk = false;
    }
    if (raw.startsWith("Binary files ") || raw === "GIT binary patch") {
      cur.binary = true;
      cur.lines.push({ kind: "binary", text: "Binary file. No text diff." });
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4);
      if (p !== "/dev/null") cur.path = stripPrefix(p);
    } else if (raw.startsWith("--- ")) {
      const p = raw.slice(4);
      // A deleted file keeps its old path.
      if (p !== "/dev/null" && !cur.oldPath) cur.path = stripPrefix(p);
    } else if (raw.startsWith("rename from ")) {
      cur.oldPath = raw.slice(12);
    } else if (raw.startsWith("rename to ")) {
      cur.path = raw.slice(10);
    }
    cur.lines.push({ kind: "meta", text: cut(raw) });
  }
  return files;
}

/** The longest line, in chars: the width of the diff content. */
export function widestLine(lines: readonly DiffLine[]): number {
  let n = 0;
  for (const l of lines) if (l.text.length > n) n = l.text.length;
  return n;
}

/** Spoken and shown names of a status letter of `git.status`. */
const STATUS_NAMES: Record<string, string> = {
  M: "Changed",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  U: "Conflict",
  "?": "New, not tracked",
};

export function statusName(letter: string): string {
  return STATUS_NAMES[letter] ?? "Changed";
}

/** `+12 −3`, `binary` or empty when the counts are unknown. Uses the real minus sign. */
export function countsText(f: Pick<GitChangedFile, "added" | "deleted" | "binary">): string {
  if (f.binary) return "binary";
  if (f.added == null || f.deleted == null) return "";
  return `+${f.added} −${f.deleted}`;
}

/** The label VoiceOver reads for a row of the Changes list. */
export function fileLabel(f: GitChangedFile): string {
  const parts = [f.path, statusName(f.status)];
  if (f.orig_path) parts.push(`from ${f.orig_path}`);
  if (f.binary) parts.push("binary");
  else if (f.added != null && f.deleted != null) parts.push(`${f.added} added, ${f.deleted} deleted lines`);
  if (f.staged && !f.unstaged) parts.push("staged");
  return parts.join(", ");
}

/** The file name and its folder, for a two-part row: `src/app/x.ts` → `["x.ts", "src/app"]`. */
export function splitPath(path: string): [name: string, dir: string] {
  const i = path.lastIndexOf("/");
  return i < 0 ? [path, ""] : [path.slice(i + 1), path.slice(0, i)];
}

/** "main · 2 ahead, 1 behind", "detached at abc1234", "main". */
export function branchLine(s: { branch: string | null; head: string | null; ahead: number; behind: number; upstream: string | null }): string {
  const name = s.branch ?? (s.head ? `detached at ${s.head}` : "no commits yet");
  const ab: string[] = [];
  if (s.ahead > 0) ab.push(`${s.ahead} ahead`);
  if (s.behind > 0) ab.push(`${s.behind} behind`);
  return ab.length > 0 ? `${name} · ${ab.join(", ")}` : name;
}
