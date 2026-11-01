import type { AgentInfo } from "@/herdr/snapshot";

import {
  bucketOf,
  countBuckets,
  filterBoard,
  folderTitles,
  groupBoard,
  mergeBoard,
  previewLine,
  sortBoard,
  toggleFilter,
  trackFirstSeen,
  type BoardHost,
  type BoardItem,
  type PreviewEntry,
} from "./buckets";

const agent = (pane_id: string, agent_status: AgentInfo["agent_status"], seq = 1, workspace_id = "w1"): AgentInfo => ({
  pane_id,
  tab_id: "t1",
  workspace_id,
  agent: "claude",
  agent_status,
  state_change_seq: seq,
});

const host = (hostId: string, agents: AgentInfo[]): BoardHost => ({
  hostId,
  hostName: hostId.toUpperCase(),
  agents,
  workspaces: [
    { workspace_id: "w1", label: "api" },
    { workspace_id: "w2", label: "web" },
  ],
});

test("bucket_of_each_status", () => {
  expect(bucketOf(agent("p", "blocked"), undefined)).toBe("needs_you");
  expect(bucketOf(agent("p", "working"), undefined)).toBe("working");
  expect(bucketOf(agent("p", "idle", 5), 4)).toBe("ready");
  expect(bucketOf(agent("p", "done", 5), undefined)).toBe("ready");
  expect(bucketOf(agent("p", "idle", 5), 5)).toBe("idle");
  expect(bucketOf(agent("p", "done", 5), 9)).toBe("idle");
  expect(bucketOf(agent("p", "unknown", 5), 0)).toBe("idle");
});

test("merge_sorts_by_bucket_then_newest_change", () => {
  const items = mergeBoard(
    [host("a", [agent("p1", "idle", 3), agent("p2", "working", 1), agent("p3", "blocked", 1)]), host("b", [agent("p4", "working", 1), agent("p5", "idle", 9)])],
    {},
    { "a:p1": 3, "b:p5": 2 },
    {
      "a:p2": { status: "working", at: 1_000 },
      "b:p4": { status: "working", at: 5_000 },
    },
  );
  expect(items.map((i) => [i.key, i.bucket])).toEqual([
    ["a:p3", "needs_you"],
    ["b:p5", "ready"],
    ["b:p4", "working"],
    ["a:p2", "working"],
    ["a:p1", "idle"],
  ]);
  expect(items.find((i) => i.key === "b:p4")!.workspace).toBe("api");
});

test("merge_with_seen_still_loading_marks_nothing_unread", () => {
  const items = mergeBoard([host("a", [agent("p1", "idle", 3)])], {}, null, {});
  expect(items[0].bucket).toBe("idle");
});

test("merge_uses_preview_line_and_companion_start", () => {
  const previews: Record<string, PreviewEntry> = {
    "a:p1": { pane_id: "p1", activity: "Running pnpm test", last_reply: "On it", status_since: 100, source: "log", status: "working" },
    "a:p2": { pane_id: "p2", question: "Allow git push?", status_since: null, source: "log", status: "blocked" },
    "a:p3": { pane_id: "p3", last_reply: "Done.", source: "log", status: "idle" },
  };
  const items = mergeBoard(
    [host("a", [agent("p1", "working"), agent("p2", "blocked"), agent("p3", "idle", 2)])],
    previews,
    {},
    { "a:p2": { status: "blocked", at: 42_000 } },
  );
  const by = (k: string) => items.find((i) => i.key === k)!;
  expect(by("a:p1")).toMatchObject({ line: "Running pnpm test", since: 100_000 });
  expect(by("a:p2")).toMatchObject({ line: "Allow git push?", since: 42_000 });
  expect(by("a:p3")).toMatchObject({ line: "Done.", bucket: "ready" });
});

test("merge_ignores_preview_fetched_under_another_status", () => {
  const previews: Record<string, PreviewEntry> = {
    "a:p1": { pane_id: "p1", activity: "Running pnpm test", status_since: 100, source: "log", status: "working" },
  };
  const firstSeen = { "a:p1": { status: "working" as const, at: 1 } };
  const [item] = mergeBoard([host("a", [agent("p1", "blocked")])], previews, {}, firstSeen);
  expect(item.line).toBeUndefined();
  expect(item.since).toBeUndefined();
});

test("preview_line_per_bucket_with_fallback", () => {
  const p = { pane_id: "p", activity: "Thinking", question: "Allow x?", last_reply: "Hi", source: "log" as const };
  expect(previewLine("working", p)).toBe("Thinking");
  expect(previewLine("needs_you", p)).toBe("Allow x?");
  expect(previewLine("ready", p)).toBe("Hi");
  expect(previewLine("idle", p)).toBe("Hi");
  expect(previewLine("working", { pane_id: "p", last_reply: "Hi", source: "screen" })).toBe("Hi");
  expect(previewLine("working", undefined)).toBeUndefined();
});

test("unknown_start_sorts_last_in_bucket", () => {
  const mk = (key: string, since?: number): BoardItem => ({
    key,
    hostId: "a",
    hostName: "A",
    workspace: "api",
    title: "api",
    subtitle: "A · claude",
    agent: agent(key, "working"),
    bucket: "working",
    since,
  });
  expect(sortBoard([mk("x"), mk("y", 10), mk("z", 20)]).map((i) => i.key)).toEqual(["z", "y", "x"]);
});

test("chips_count_and_filter", () => {
  const items = mergeBoard([host("a", [agent("p1", "blocked"), agent("p2", "working"), agent("p3", "working")])], {}, {}, {});
  expect(countBuckets(items)).toEqual({ needs_you: 1, ready: 0, working: 2, background: 0, idle: 0 });
  expect(filterBoard(items, "working").map((i) => i.key)).toEqual(expect.arrayContaining(["a:p2", "a:p3"]));
  expect(filterBoard(items, "working")).toHaveLength(2);
  expect(filterBoard(items, null)).toHaveLength(3);
  expect(toggleFilter(null, "ready")).toBe("ready");
  expect(toggleFilter("ready", "ready")).toBeNull();
  expect(toggleFilter("ready", "idle")).toBe("idle");
});

test("group_by_status_host_workspace", () => {
  const items = mergeBoard(
    [host("a", [agent("p1", "working", 1, "w1"), agent("p2", "blocked", 1, "w2")]), host("b", [agent("p3", "working")])],
    {},
    {},
    {},
  );
  expect(groupBoard(items, "status").map((s) => [s.title, s.data.length])).toEqual([
    ["Needs you", 1],
    ["Working", 2],
  ]);
  expect(groupBoard(items, "host").map((s) => s.title)).toEqual(["A", "B"]);
  expect(groupBoard(items, "workspace").map((s) => s.title)).toEqual(["A · web", "api"]);
});

test("workspace_sections_merge_equal_names_across_computers", () => {
  const items = mergeBoard(
    [host("a", [agent("p1", "working", 1, "w1"), agent("p2", "blocked", 1, "w2")]), host("b", [agent("p3", "working")]), host("c", [agent("p4", "idle")])],
    {},
    {},
    {},
  );
  const s = groupBoard(items, "workspace");
  const api = s.find((x) => x.key === "ws:api")!;
  expect(api.title).toBe("api");
  expect(api.subtitle).toBe("3 computers");
  expect(api.workspace).toBeUndefined();
  expect(api.data).toHaveLength(3);
  const web = s.find((x) => x.key === "ws:web")!;
  expect(web.title).toBe("A · web");
  expect(web.subtitle).toBeUndefined();
  expect(web.workspace).toEqual({ hostId: "a", workspaceId: "w2" });
  expect(groupBoard(items.filter((i) => i.hostId !== "c"), "workspace").find((x) => x.key === "ws:api")!.subtitle).toBe("A, B");
});

test("folder_titles_use_the_last_part_and_add_parts_for_equal_names", () => {
  const t = folderTitles(["/home/sam/apps/web", "/home/sam/old/web", "/home/sam/api", "/srv/x/web", "/home/sam"]);
  expect(t.get("/home/sam/apps/web")).toBe("apps/web");
  expect(t.get("/home/sam/old/web")).toBe("old/web");
  expect(t.get("/srv/x/web")).toBe("x/web");
  expect(t.get("/home/sam/api")).toBe("api");
  expect(t.get("/home/sam")).toBe("~");
  expect(folderTitles(["/home/sam/web", "/Users/jo/web"]).get("/home/sam/web")).toBe("~/web");
});

test("folder_sections_merge_computers_and_put_no_folder_last", () => {
  const withCwd = (a: AgentInfo, cwd?: string): AgentInfo => ({ ...a, cwd });
  const items = mergeBoard(
    [
      host("a", [withCwd(agent("p1", "working"), "/home/sam/projects/web"), agent("p2", "idle")]),
      host("b", [withCwd(agent("p3", "idle"), "/home/sam/projects/web/")]),
    ],
    {},
    {},
    {},
  );
  const s = groupBoard(items, "folder");
  expect(s.map((x) => [x.key, x.title, x.data.length])).toEqual([
    ["dir:/home/sam/projects/web", "web", 2],
    ["dir:", "No folder", 1],
  ]);
});

test("first_seen_starts_on_change_and_drops_gone_panes", () => {
  const a = trackFirstSeen({}, [{ key: "h:p1", status: "working" }], 10);
  expect(a).toEqual({ "h:p1": { status: "working", at: 10 } });
  expect(trackFirstSeen(a, [{ key: "h:p1", status: "working" }], 20)).toBe(a);
  expect(trackFirstSeen(a, [{ key: "h:p1", status: "idle" }], 30)).toEqual({ "h:p1": { status: "idle", at: 30 } });
  expect(trackFirstSeen(a, [], 40)).toEqual({});
});

test("cards_use_herdr_names", () => {
  const h: BoardHost = {
    hostId: "a",
    hostName: "studio",
    agents: [{ ...agent("p1", "working"), terminal_title_stripped: "Fix login" }, { ...agent("p2", "idle"), name: "reviewer", tab_id: "t2" }],
    workspaces: [{ workspace_id: "w1", label: "api", tab_count: 2 }],
    tabs: [
      { tab_id: "t1", workspace_id: "w1", label: "main", number: 1, agent_status: "working" },
      { tab_id: "t2", workspace_id: "w1", label: "review", number: 2, agent_status: "idle" },
    ],
  };
  const items = mergeBoard([h], {}, {}, {});
  const p1 = items.find((i) => i.agent.pane_id === "p1")!;
  expect([p1.title, p1.subtitle, p1.terminalTitle]).toEqual(["api · main", "studio · claude", "Fix login"]);
  expect(items.find((i) => i.agent.pane_id === "p2")!.title).toBe("reviewer");
});
