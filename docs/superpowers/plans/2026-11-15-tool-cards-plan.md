# Tool cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show edits as diffs, writes as new-file previews and commands as `$ command` with output, in the Thread tab tool cards and the full tool screen.

**Architecture:** A pure module classifies a tool call by the keys of its `input` and builds diff rows. One component draws each kind. `ToolCard` and `app/tool.tsx` use it. No host or protocol change.

**Tech Stack:** Expo app, TypeScript strict, React Native, Jest (`jest-expo`), lucide-react-native.

**Spec:** `docs/superpowers/specs/2026-11-15-tool-cards-design.md`

## Global Constraints

- JS-only. No new dependency. It ships as an OTA update to the 1.0.2 tester runtime.
- Tokens only (`app/src/theme/tokens.ts`). Diff rows use `colors.diff.add`, `colors.diff.addBg`, `colors.diff.del`, `colors.diff.delBg` and keep the "+" and "-" sign as the first character, so color is never the only cue.
- At most 400 diff rows on a card (`CARD_DIFF_ROWS = 400`). The full screen shows at most `DIFF_PAGE_LINES` (1500, from `changes/diff.ts`) rows, then a note line.
- The copy text (`toolCopyText`) and "Select text" keep the raw input.
- TypeScript `strict`, no `any`. Comments explain why. User-facing text in ASD-STE100 Simplified Technical English.
- Run Jest with `--maxWorkers=2`, from `app/`.

## Review Focus

- An edit with an empty `old_string` (a new block in an empty file): all rows are "add"; counts "+N −0".
- A very large edit (5000 lines each side): `lineDiff` must not hang. Above 2,000,000 cells in the LCS table, fall back to all "del" rows then all "add" rows.
- Text with Windows line ends (`\r\n`) and a missing final newline: no stray `\r` in rows, no extra blank row.
- A `command` sent as an argv array (`["bash", "-lc", "pnpm test"]`): show the last element.
- An input that is `null`, a string, or an object with wrong value types (`old_string: 5`): kind "other", no throw.

---

### Task 1: Classify tool calls and build diff rows

**Files:**
- Create: `app/src/thread/toolKinds.ts`
- Test: `app/src/thread/toolKinds.test.ts`

**Interfaces:**
- Consumes: `DiffLine` from `app/src/changes/diff.ts` (`kind: "add" | "del" | "ctx" | "hunk" | ...`, `text` with the sign as first char).
- Produces:

```ts
export type ToolDiffFile = { path: string; lines: DiffLine[]; added: number; deleted: number };
export type ToolShape =
  | { kind: "diff"; files: ToolDiffFile[] }            // edit, multi-edit, patch
  | { kind: "write"; path: string; content: string; lineCount: number }
  | { kind: "shell"; command: string; description?: string }
  | { kind: "lookup" }                                  // read, search, list, fetch
  | { kind: "other" };
export const DIFF_CONTEXT = 3;
export const LCS_MAX_CELLS = 2_000_000;
export function classifyTool(name: string, input: unknown): ToolShape;
export function lineDiff(oldText: string, newText: string, context?: number): DiffLine[];
export function parsePatch(text: string): ToolDiffFile[];
export function diffCounts(shape: ToolShape): { added: number; deleted: number } | null;
```

Rules for `classifyTool` (first match wins; keys checked only when their value is a string):
1. Patch: `input` is a string, or has a string `input`, `patch` or `diff` field, whose text has `*** Begin Patch` → `parsePatch`. A text that starts with `--- ` or `diff --git` → `parseDiff` from `changes/diff.ts` mapped to `ToolDiffFile`.
2. Multi-edit: `edits` is an array of objects with an old/new pair → one file; the rows of each edit joined with one `{kind:"hunk", text:"⋯"}` row between them.
3. Edit: an old/new pair: `old_string`/`new_string`, `oldString`/`newString` or `oldText`/`newText`.
4. Write: a string `content` (or `text`) and a path, no old/new pair → `lineCount` = number of lines (0 for "").
5. Shell: a string `command` or `cmd`, or a `command` array of strings (use the last element).
6. Lookup: the lower-case `name` is one of `read`, `grep`, `glob`, `ls`, `list`, `find`, `search`, `webfetch`, `websearch`, `read_file`, `list_directory`, `search_file_content`.
7. Else `other`.

The path is the first string of `file_path`, `filePath`, `path`; "" when none.

`lineDiff`: split on `\n` after `\r\n` → `\n`; drop one final empty element. LCS over lines. Rows: `"-"+line` del, `"+"+line` add, `" "+line` ctx. Keep `context` ctx rows around each change; join separated groups with a `{kind:"hunk", text:"⋯"}` row. No line numbers (the file offset is unknown). Above `LCS_MAX_CELLS` (old lines × new lines), all del rows then all add rows.

`parsePatch`: sections start at `*** Update File: `, `*** Add File: ` or `*** Delete File: `. In a section, lines starting `+`, `-`, ` ` become add, del, ctx rows; `@@` lines become hunk rows (text as is); `*** Move to: ` and `*** End of File` are skipped. `*** End Patch` ends the patch.

- [ ] **Step 1: Write the failing tests** in `toolKinds.test.ts`:

```ts
import { classifyTool, diffCounts, lineDiff, parsePatch, LCS_MAX_CELLS } from "./toolKinds";

const rows = (ls: { kind: string; text: string }[]) => ls.map((l) => `${l.kind}:${l.text}`);

test("claude_edit_is_a_diff_with_counts", () => {
  const s = classifyTool("Edit", { file_path: "/p/a.ts", old_string: "a\nb\nc", new_string: "a\nB\nc" });
  expect(s.kind).toBe("diff");
  if (s.kind !== "diff") return;
  expect(s.files[0].path).toBe("/p/a.ts");
  expect(rows(s.files[0].lines)).toEqual(["ctx: a", "del:-b", "add:+B", "ctx: c"]);
  expect(diffCounts(s)).toEqual({ added: 1, deleted: 1 });
});

test("other_agents_edit_keys", () => {
  expect(classifyTool("edit", { filePath: "x", oldString: "a", newString: "b" }).kind).toBe("diff");
  expect(classifyTool("edit", { path: "x", oldText: "a", newText: "b" }).kind).toBe("diff");
});

test("empty_old_string_is_all_adds", () => {
  const s = classifyTool("Edit", { file_path: "x", old_string: "", new_string: "a\nb" });
  expect(diffCounts(s)).toEqual({ added: 2, deleted: 0 });
});

test("crlf_and_missing_final_newline", () => {
  expect(rows(lineDiff("a\r\nb\r\n", "a\r\nc"))).toEqual(["ctx: a", "del:-b", "add:+c"]);
});

test("far_changes_get_a_gap_row", () => {
  const old = Array.from({ length: 20 }, (_, i) => `l${i}`);
  const neu = [...old];
  neu[1] = "X";
  neu[18] = "Y";
  const r = rows(lineDiff(old.join("\n"), neu.join("\n")));
  expect(r).toContain("hunk:⋯");
  expect(r.filter((x) => x.startsWith("ctx:")).length).toBe(3 + 3 + 1 + 1); // l0, l2..l4 / l15..l17, l19
});

test("huge_edit_falls_back_without_lcs", () => {
  const n = Math.ceil(Math.sqrt(LCS_MAX_CELLS)) + 10;
  const a = Array.from({ length: n }, (_, i) => `a${i}`).join("\n");
  const b = Array.from({ length: n }, (_, i) => `b${i}`).join("\n");
  const r = lineDiff(a, b);
  expect(r.length).toBe(2 * n);
  expect(r[0].kind).toBe("del");
  expect(r[n].kind).toBe("add");
});

test("multi_edit_joins_edits", () => {
  const s = classifyTool("MultiEdit", { file_path: "x", edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] });
  if (s.kind !== "diff") throw new Error(s.kind);
  expect(rows(s.files[0].lines)).toEqual(["del:-a", "add:+b", "hunk:⋯", "del:-c", "add:+d"]);
});

test("codex_patch", () => {
  const text = "*** Begin Patch\n*** Update File: src/a.rs\n@@ fn main\n-old\n+new\n ctx\n*** Add File: b.txt\n+hi\n*** End Patch";
  const s = classifyTool("apply_patch", { input: text });
  if (s.kind !== "diff") throw new Error(s.kind);
  expect(s.files.map((f) => f.path)).toEqual(["src/a.rs", "b.txt"]);
  expect(rows(s.files[0].lines)).toEqual(["hunk:@@ fn main", "del:-old", "add:+new", "ctx: ctx"]);
  expect(diffCounts(s)).toEqual({ added: 2, deleted: 1 });
  expect(parsePatch(text)[1].added).toBe(1);
});

test("write_shell_lookup_other", () => {
  expect(classifyTool("Write", { file_path: "x", content: "a\nb\n" })).toEqual({ kind: "write", path: "x", content: "a\nb\n", lineCount: 2 });
  expect(classifyTool("Bash", { command: "pnpm test", description: "Run tests" })).toEqual({ kind: "shell", command: "pnpm test", description: "Run tests" });
  expect(classifyTool("shell", { command: ["bash", "-lc", "ls -la"] })).toEqual({ kind: "shell", command: "ls -la" });
  expect(classifyTool("exec_command", { cmd: "git status" })).toEqual({ kind: "shell", command: "git status" });
  expect(classifyTool("Read", { file_path: "x" }).kind).toBe("lookup");
  expect(classifyTool("Grep", { pattern: "foo" }).kind).toBe("lookup");
  expect(classifyTool("Task", { prompt: "x" }).kind).toBe("other");
});

test("bad_inputs_are_other", () => {
  expect(classifyTool("Edit", null).kind).toBe("other");
  expect(classifyTool("Edit", "plain text").kind).toBe("other");
  expect(classifyTool("Edit", { file_path: "x", old_string: 5, new_string: "b" }).kind).toBe("other");
  expect(diffCounts({ kind: "other" })).toBeNull();
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing): `cd app && pnpm jest src/thread/toolKinds --maxWorkers=2`
- [ ] **Step 3: Implement `app/src/thread/toolKinds.ts`** per the rules above. Start the file with a doc comment that says why it classifies by input keys (every host version and agent).
- [ ] **Step 4: Run, expect PASS**, then `pnpm exec tsc --noEmit`.
- [ ] **Step 5: Commit** `thread: classify tool calls and build edit diffs`.

---

### Task 2: Draw the kinds on the tool card

**Files:**
- Create: `app/src/thread/items/ToolBody.tsx`
- Modify: `app/src/thread/items/ToolCard.tsx`
- Test: `app/src/thread/items/ToolCard.test.tsx` (add tests; keep the existing ones green)

**Interfaces:**
- Consumes: Task 1 (`classifyTool`, `diffCounts`, `ToolShape`, `ToolDiffFile`).
- Produces:

```ts
export const CARD_DIFF_ROWS = 400;
/** The body of an open tool card, or of the full tool screen ("full"). Null for kind "other". */
export function ToolBody(props: {
  shape: ToolShape;
  result?: ToolResult;
  variant: "card" | "full";
  /** Full screen font size; the card uses the caption size. */
  fontSize?: number;
}): React.ReactElement | null;
```

Drawing:
- `diff`: per file, a caption line with the file name (last path part, `splitPath` from `changes/diff.ts`) and the folder muted, then the rows on `colors.sunken` in mono, each row with its `colors.diff` background and text color (ctx: `colors.text`; hunk: `colors.textMuted`). Rows sit in an `HScrollView`. The card shows at most `CARD_DIFF_ROWS` rows over all files, then a muted line "N more lines. Tap Expand to see all." The full variant caps at `DIFF_PAGE_LINES`, then "N more lines are not shown.".
- `write`: the path line as for `diff`, a muted "New file · N lines", then the content as add rows (`"+"` + line), with the same caps.
- `shell`: a mono bold line `$ <command>` (wraps, selectable), the description muted under it when present. Output: the result text, last 30 lines on the card (`lastLines(text, LIVE_LINES)`), all of it on the full screen; danger color when `result.ok` is false.
- `lookup`: renders null (the card shows only the result block).

`ToolCard` changes:
- `const shape = useMemo(() => classifyTool(name, input), [name, input])`.
- Header: when `diffCounts(shape)` is non-null, show `+A` in `colors.diff.add` and `−D` in `colors.diff.del` (tabular nums, caption) before the time. Add to the accessibility label: `, A lines added, D removed`.
- Open body: kind `diff`/`write`/`shell` → `<ToolBody variant="card">` in place of the "Input" block. For `shell`, ToolBody draws the result, so the card does not draw the "Result"/"Error" block again; the running live output stays as today. Kind `lookup` → no "Input" block, only the result. Kind `other` → today's body.

- [ ] **Step 1: Write the failing tests** (in `ToolCard.test.tsx`, with the file's `texts`/`header` helpers):
  - `edit_card_shows_counts_and_diff_rows`: an `Edit` card with `{file_path:"/p/src/a.ts", old_string:"x", new_string:"y\nz"}` and an ok result. The header texts contain `"+2"` and `"−1"`; the label contains `"2 lines added, 1 removed"`. After a press on the header, the texts contain `"-x"`, `"+y"`, `"+z"` and `"a.ts"`, and do not contain `"old_string"`.
  - `bash_card_shows_command_and_output`: input `{command:"pnpm test", description:"Run tests"}`, result `{ok:false,text:"FAIL a.test.ts",truncated:false}`. Open: texts contain `"$ pnpm test"`, `"Run tests"`, `"FAIL a.test.ts"` once, and no `"Error"` label.
  - `read_card_shows_only_the_result`: `Read` with `{file_path:"x"}`, result text `"file body"`. Open: contains `"file body"`, does not contain `"Input"`.
  - `big_edit_is_capped_on_the_card`: an edit of 500 new lines. Open: at most 400 add rows and the text `"100 more lines. Tap Expand to see all."`.
- [ ] **Step 2: Run, expect FAIL:** `cd app && pnpm jest src/thread/items/ToolCard --maxWorkers=2`
- [ ] **Step 3: Implement `ToolBody.tsx` and the `ToolCard` changes.**
- [ ] **Step 4: Run, expect PASS**, then `pnpm exec tsc --noEmit`.
- [ ] **Step 5: Commit** `thread: draw edits, writes and commands on tool cards`.

---

### Task 3: The full tool screen, the demo and the docs

**Files:**
- Modify: `app/src/app/tool.tsx`
- Modify: `app/src/demo/scenario.ts` (only if its tool inputs lack the real keys; see below)
- Modify: `CHANGELOG.md` (`## [Unreleased app]`)
- Test: the existing tool screen test (`app/src/thread/toolScreen.test.tsx`), plus one new test there.

**Interfaces:**
- Consumes: Task 1 `classifyTool`; Task 2 `ToolBody` with `variant: "full"` and `fontSize`.

Changes:
- `app/tool.tsx`: for kind `diff`, `write`, `shell`, draw `<ToolBody variant="full" fontSize={font}>` in place of the "Input" section; `shell` replaces the output section too, except while running (keep "Live output"). Kind `lookup` drops the input section. Kind `other` is unchanged. The font buttons still change the size.
- Demo: check `app/src/demo/scenario.ts`. Where a demo `Edit` tool has no `old_string`/`new_string`, or a `Bash` tool has no `command`, add realistic values so the demo shows the new cards. Generic data only.
- `CHANGELOG.md`, under `## [Unreleased app]`: "Tool cards show edits as diffs, new files as previews and commands as `$ command` with the output."

- [ ] **Step 1: Write the failing test** `full_screen_shows_the_edit_diff` in `toolScreen.test.tsx`: open the view with an `Edit` tool (`old_string:"a"`, `new_string:"b"`). Texts contain `"-a"` and `"+b"`, and not `"old_string"`.
- [ ] **Step 2: Run, expect FAIL:** `cd app && pnpm jest src/thread/toolScreen --maxWorkers=2`
- [ ] **Step 3: Implement** the screen, demo and changelog changes.
- [ ] **Step 4: Run all checks:** `cd app && pnpm exec tsc --noEmit && pnpm test --maxWorkers=2`. Expected: all pass.
- [ ] **Step 5: Commit** `app: tool screen shows diffs and commands`.
