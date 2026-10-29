import type { ThreadItem } from "@zogssh/protocol";

import { mergeItems } from "./merge";

const user = (id: string, text: string): ThreadItem => ({ kind: "user", id, ts: 1, text });
const tool = (id: string, result?: string): ThreadItem => ({
  kind: "tool",
  id,
  ts: 2,
  name: "Bash",
  input_summary: "git status",
  input: { command: "git status" },
  ...(result === undefined ? {} : { result: { ok: true, text: result, truncated: false } }),
});

test("merge_replaces_by_id", () => {
  const existing = [user("u1", "hi"), tool("t1"), user("u2", "next")];
  const merged = mergeItems(existing, [tool("t1", "clean")]);
  expect(merged.map((i) => i.id)).toEqual(["u1", "t1", "u2"]);
  expect(merged[1]).toEqual(tool("t1", "clean"));
  expect(existing[1]).toEqual(tool("t1"));
});

test("merge_appends_new_in_order", () => {
  const existing = [user("u1", "hi")];
  const merged = mergeItems(existing, [user("u2", "a"), tool("t1", "ok"), user("u1", "hi again"), user("u3", "b")]);
  expect(merged.map((i) => i.id)).toEqual(["u1", "u2", "t1", "u3"]);
  expect(merged[0]).toEqual(user("u1", "hi again"));
});

test("merge with nothing new returns the same array", () => {
  const existing = [user("u1", "hi")];
  expect(mergeItems(existing, [])).toBe(existing);
});
