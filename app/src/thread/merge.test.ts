import type { ThreadItem } from "@zogssh/protocol";

import { mergeItems, prependOlder } from "./merge";

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

test("merge_keeps_identity_of_unchanged_items", () => {
  const existing = [user("u1", "hi"), tool("t1"), user("u2", "next")];
  // A reconnect sends equal copies of known items, plus one real change.
  const merged = mergeItems(existing, [user("u1", "hi"), tool("t1", "clean"), user("u2", "next")]);
  expect(merged).not.toBe(existing);
  expect(merged[0]).toBe(existing[0]);
  expect(merged[1]).not.toBe(existing[1]);
  expect(merged[2]).toBe(existing[2]);
});

test("merge_returns_existing_when_nothing_changed", () => {
  const existing = [user("u1", "hi"), tool("t1", "clean")];
  expect(mergeItems(existing, [tool("t1", "clean"), user("u1", "hi")])).toBe(existing);
  expect(mergeItems(existing, [])).toBe(existing);
});

test("merge_sees_nested_changes", () => {
  const a = tool("t1", "one");
  const b = tool("t1", "two");
  expect(mergeItems([a], [b])[0]).toBe(b);
  const withInput = { ...a, input: { command: "git log" } } as ThreadItem;
  expect(mergeItems([a], [withInput])[0]).toBe(withInput);
});

test("prepend_older_keeps_loaded_objects", () => {
  const loaded = [user("u2", "b"), tool("t1", "new")];
  const older = [user("u1", "a"), { ...loaded[0] }, tool("t1")];
  const merged = prependOlder(older, loaded);
  expect(merged.map((i) => i.id)).toEqual(["u1", "u2", "t1"]);
  expect(merged[1]).toBe(loaded[0]);
  expect(merged[2]).toBe(loaded[1]);
});
