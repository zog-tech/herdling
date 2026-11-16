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
