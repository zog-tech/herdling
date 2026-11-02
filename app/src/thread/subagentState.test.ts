import type { ThreadItem } from "@herdling/protocol";

import { runningSubagents, shownSummary, subagentCount, subagentHref, subagentList } from "./subagentState";

/** The exact tool result Claude Code writes when it launches a background subagent. */
const LAUNCH =
  "Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)\nagentId: a1b2c3";

const sub = (id: string, status: string): ThreadItem => ({ kind: "subagent", id, ts: 1, agent_id: "", description: id, status });

test("launch_text_is_never_a_summary", () => {
  expect(shownSummary(LAUNCH)).toBeUndefined();
  expect(shownSummary(`  ${LAUNCH}`)).toBeUndefined();
  expect(shownSummary("  ")).toBeUndefined();
  expect(shownSummary(undefined)).toBeUndefined();
  expect(shownSummary("Found 12 tests.")).toBe("Found 12 tests.");
});

test("counts_only_running_subagents", () => {
  const items = [sub("a", "running"), sub("b", "async_launched"), sub("c", "completed"), sub("d", "running")];
  expect(runningSubagents(items)).toBe(2);
  expect(runningSubagents([])).toBe(0);
  expect(subagentCount(1)).toBe("1 subagent");
  expect(subagentCount(2)).toBe("2 subagents");
});

type Sub = Extract<ThreadItem, { kind: "subagent" }>;
const live = (id: string, status: string, startedAt: number): Sub => ({
  kind: "subagent",
  id,
  ts: startedAt,
  agent_id: `agent-${id}`,
  description: id,
  status,
  started_at: startedAt,
});
const user = (id: string, ts: number): ThreadItem => ({ kind: "user", id, ts, text: "Go on" });
const ids = (list: Sub[]) => list.map((s) => s.id);

test("subagent_list_puts_running_first_and_newest_first", () => {
  const items = [user("u1", 1), live("a", "running", 10), live("b", "completed", 20), live("c", "running", 30), live("d", "error", 40)];
  const list = subagentList(items);
  expect(ids(list.running)).toEqual(["c", "a"]);
  expect(ids(list.finished)).toEqual(["d", "b"]);
});

test("subagent_list_keeps_only_finished_subagents_of_the_current_turn", () => {
  // "a" finished in the turn before; "bg" started then and still runs in the background.
  const items = [user("u1", 1), live("a", "completed", 10), live("bg", "running", 11), user("u2", 50), live("b", "stopped", 60)];
  const list = subagentList(items);
  expect(ids(list.running)).toEqual(["bg"]);
  expect(ids(list.finished)).toEqual(["b"]);
  // A new prompt with no subagents yet: only the background subagent stays.
  const next = subagentList([...items, user("u3", 90)]);
  expect(ids(next.running)).toEqual(["bg"]);
  expect(next.finished).toEqual([]);
});

test("subagent_list_with_no_user_message_counts_every_item_as_the_current_turn", () => {
  const list = subagentList([live("a", "done", 10), live("b", "completed", 20)]);
  expect(ids(list.finished)).toEqual(["b", "a"]);
});

test("subagent_list_skips_old_host_launch_status_and_sorts_by_item_time_without_start", () => {
  const items: ThreadItem[] = [user("u1", 1), sub("old", "async_launched"), { ...sub("x", "completed"), ts: 5 }, { ...sub("y", "completed"), ts: 9 }];
  const list = subagentList(items);
  expect(list.running).toEqual([]);
  expect(ids(list.finished)).toEqual(["y", "x"]);
});

test("subagent_href_needs_the_log_and_the_agent_id", () => {
  const log = { hostId: "studio", logPath: "/home/sam/.claude/projects/p/s.jsonl" };
  expect(subagentHref(null, { agentId: "a1", description: "Fix" })).toBeUndefined();
  expect(subagentHref(log, { agentId: "", description: "Fix" })).toBeUndefined();
  expect(subagentHref(log, { agentId: "a1", description: "Fix", startedAt: 7 })).toEqual({
    pathname: "/subagent/[hostId]/[agentId]",
    params: { hostId: "studio", agentId: "a1", log: log.logPath, title: "Fix", since: "7" },
  });
  expect(subagentHref(log, { agentId: "a1", description: "Fix" })?.params).not.toHaveProperty("since");
});
