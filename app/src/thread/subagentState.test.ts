import type { ThreadItem } from "@herdling/protocol";

import { runningSubagents, shownSummary, subagentCount } from "./subagentState";

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
