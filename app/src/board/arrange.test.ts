import { collapseSections, collapsible, groupItems, sortItems, toggleKey } from "./arrange";
import type { BoardItem, Bucket } from "./buckets";

const item = (key: string, bucket: Bucket, patch: Partial<BoardItem> = {}): BoardItem => ({
  key,
  hostId: "h1",
  hostName: "studio.local",
  workspace: "api",
  title: key,
  subtitle: "studio.local · claude",
  agent: { pane_id: key, tab_id: "t1", workspace_id: "w1", agent: "claude", agent_status: "idle", state_change_seq: 1 },
  bucket,
  ...patch,
});
const keys = (l: { key: string }[]) => l.map((i) => i.key);

test("status_sort_keeps_the_board_order", () => {
  const l = [item("a", "needs_you"), item("b", "working"), item("c", "idle")];
  expect(sortItems(l, "status")).toEqual(l);
});

test("recent_sort_puts_the_newest_status_change_first_and_unknown_times_last", () => {
  const l = [
    item("old", "needs_you", { since: 1_000 }),
    item("none-low", "idle"),
    item("new", "idle", { since: 5_000 }),
    item("none-high", "idle", { agent: { ...item("x", "idle").agent, state_change_seq: 9 } }),
    item("tie-a", "working", { since: 3_000 }),
    item("tie-b", "ready", { since: 3_000 }),
  ];
  expect(keys(sortItems(l, "recent"))).toEqual(["new", "tie-a", "tie-b", "old", "none-high", "none-low"]);
});

test("name_sort_is_a_to_z_and_ignores_case_and_keeps_ties", () => {
  const l = [
    item("k1", "idle", { title: "web" }),
    item("k2", "idle", { title: "API" }),
    item("k3", "idle", { title: "api" }),
    item("k4", "idle", { title: "app 10" }),
    item("k5", "idle", { title: "app 9" }),
  ];
  expect(keys(sortItems(l, "name"))).toEqual(["k2", "k3", "k5", "k4", "k1"]);
});

test("longest_sort_puts_the_longest_working_agent_first_then_the_rest_in_board_order", () => {
  const l = [
    item("blocked", "needs_you", { since: 10 }),
    item("w-short", "working", { since: 9_000 }),
    item("w-unknown", "working"),
    item("w-long", "working", { since: 1_000 }),
    item("w-tie", "working", { since: 1_000 }),
    item("idle", "idle", { since: 1 }),
  ];
  expect(keys(sortItems(l, "longest"))).toEqual(["w-long", "w-tie", "w-short", "w-unknown", "blocked", "idle"]);
});

test("sorting_does_not_change_the_input", () => {
  const l = [item("b", "idle", { title: "b" }), item("a", "idle", { title: "a" })];
  sortItems(l, "name");
  expect(keys(l)).toEqual(["b", "a"]);
});

test("none_grouping_gives_one_flat_section_in_the_given_order", () => {
  const l = [item("z", "idle"), item("a", "needs_you", { hostId: "h2" })];
  const s = groupItems(l, "none");
  expect(s).toHaveLength(1);
  expect(s[0].title).toBe("");
  expect(keys(s[0].data)).toEqual(["z", "a"]);
  expect(groupItems([], "none")).toEqual([]);
});

test("status_grouping_keeps_the_bucket_order_and_the_sorted_order_inside", () => {
  const l = sortItems([item("i1", "idle", { title: "b" }), item("n1", "needs_you", { title: "c" }), item("i2", "idle", { title: "a" })], "name");
  const s = groupItems(l, "status");
  expect(s.map((x) => x.key)).toEqual(["needs_you", "idle"]);
  expect(keys(s[1].data)).toEqual(["i2", "i1"]);
});

test("collapsed_sections_keep_the_header_and_the_count", () => {
  const l = [item("a", "idle", { hostId: "h1" }), item("b", "idle", { hostId: "h2" }), item("c", "idle", { hostId: "h2" })];
  const s = collapseSections(groupItems(l, "host"), "host", ["h2"]);
  expect(s.map((x) => [x.key, x.count, x.collapsed, x.data.length])).toEqual([
    ["h1", 1, false, 1],
    ["h2", 2, true, 0],
  ]);
  // Status sections never collapse.
  expect(collapseSections(groupItems(l, "status"), "status", ["idle"])[0].data).toHaveLength(3);
  expect(collapsible("workspace")).toBe(true);
  expect(collapsible("none")).toBe(false);
});

test("toggle_key_adds_and_removes", () => {
  expect(toggleKey([], "a")).toEqual(["a"]);
  expect(toggleKey(["a", "b"], "a")).toEqual(["b"]);
});
