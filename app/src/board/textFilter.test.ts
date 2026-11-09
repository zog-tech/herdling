import type { AgentInfo } from "@/herdr/snapshot";

import { groupItems, sortItems } from "./arrange";
import type { BoardItem, Bucket } from "./buckets";
import { filterByText, matchesQuery, queryWords } from "./textFilter";

const item = (key: string, bucket: Bucket, o: Partial<BoardItem> = {}, a: Partial<AgentInfo> = {}): BoardItem => ({
  key,
  hostId: "h1",
  hostName: "studio.local",
  workspace: "api",
  title: key,
  subtitle: "studio.local · claude",
  bucket,
  agent: { pane_id: key, tab_id: "t1", workspace_id: "w1", agent: "claude", agent_status: "idle", cwd: "/home/sam/proj", ...a },
  ...o,
});

const items = [
  item("api-server", "working", {}, { cwd: "/home/sam/api" }),
  item("docs", "needs_you", { hostName: "build.local" }, { agent: "codex", cwd: "/home/sam/docs" }),
  item("web", "ready", { terminalTitle: "vite dev server" }, { agent: "pi", terminal_title_stripped: "vite dev server" }),
  item("tests", "idle", {}, { agent: "gemini" }),
];

test("the query is split into lower case words", () => {
  expect(queryWords("  API  Server ")).toEqual(["api", "server"]);
  expect(queryWords("   ")).toEqual([]);
});

test("an empty query keeps every item and the same array", () => {
  expect(filterByText(items, "")).toBe(items);
  expect(filterByText(items, "  ")).toBe(items);
});

test("matches the name, the agent kind and its product name", () => {
  expect(filterByText(items, "SERVER").map((i) => i.key)).toEqual(["api-server", "web"]);
  expect(filterByText(items, "API-S").map((i) => i.key)).toEqual(["api-server"]);
  expect(filterByText(items, "codex").map((i) => i.key)).toEqual(["docs"]);
  expect(filterByText(items, "gemini cli").map((i) => i.key)).toEqual(["tests"]);
});

test("matches the terminal title, the computer and the folder", () => {
  expect(filterByText(items, "vite").map((i) => i.key)).toEqual(["web"]);
  expect(filterByText(items, "build.local").map((i) => i.key)).toEqual(["docs"]);
  expect(filterByText(items, "sam/docs").map((i) => i.key)).toEqual(["docs"]);
});

test("every word must match, in any field", () => {
  expect(matchesQuery(items[1], "codex build")).toBe(true);
  expect(matchesQuery(items[1], "codex studio")).toBe(false);
  expect(filterByText(items, "nothing-like-this")).toEqual([]);
});

test("an agent with no kind and no folder still filters by name", () => {
  const bare = item("fresh", "working", {}, { agent: null, cwd: null });
  expect(matchesQuery(bare, "fresh")).toBe(true);
  expect(matchesQuery(bare, "claude")).toBe(false);
});

test("the filtered items keep the bucket grouping", () => {
  const sections = groupItems(sortItems(filterByText(items, "sam"), "status"), "status");
  expect(sections.map((s) => s.title)).toEqual(["Needs you", "Ready", "Working", "Idle"]);
  const one = groupItems(sortItems(filterByText(items, "docs"), "status"), "status");
  expect(one.map((s) => [s.title, s.data.map((i) => i.key)])).toEqual([["Needs you", ["docs"]]]);
});
