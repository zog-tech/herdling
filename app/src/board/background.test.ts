import type { AgentInfo } from "@/herdr/snapshot";

import { cardLabel } from "./a11y";
import { bucketChanges } from "./announce";
import { backgroundLine, backgroundText, hasBackground } from "./background";
import { BUCKETS, countBuckets, filterBoard, groupBoard, mergeBoard, previewLine, withBackground, type BoardHost, type Bucket, type PreviewEntry } from "./buckets";
import { boardSummary } from "./summary";

jest.mock("@/ui/haptics", () => ({ status: jest.fn() }));

const agent = (pane_id: string, agent_status: AgentInfo["agent_status"], seq = 1): AgentInfo => ({
  pane_id,
  tab_id: "t1",
  workspace_id: "w1",
  agent: "claude",
  agent_status,
  state_change_seq: seq,
});

const host = (agents: AgentInfo[]): BoardHost => ({ hostId: "h", hostName: "studio", agents, workspaces: [{ workspace_id: "w1", label: "api" }] });

const shell = { count: 1, commands: ["npm run dev"] };

const preview = (pane_id: string, status: AgentInfo["agent_status"], over: Partial<PreviewEntry> = {}): PreviewEntry => ({
  pane_id,
  status,
  source: "log",
  last_reply: "Started the dev server.",
  ...over,
});

test("background_text_counts_shells_and_subagents", () => {
  expect(backgroundText(undefined)).toBeUndefined();
  expect(backgroundText({ count: 0 })).toBeUndefined();
  expect(backgroundText({ count: 1 })).toBe("1 shell running");
  expect(backgroundText({ count: 2 })).toBe("2 shells running");
  expect(backgroundText({ count: 0, agents: 1 })).toBe("1 subagent running");
  expect(backgroundText({ count: 1, agents: 2 })).toBe("1 shell and 2 subagents running");
  expect(hasBackground({ count: 0, agents: 0 })).toBe(false);
});

test("background_line_adds_the_commands", () => {
  expect(backgroundLine(shell)).toBe("1 shell running: npm run dev");
  expect(backgroundLine({ count: 2, commands: ["npm run dev", "sleep 30"] })).toBe("2 shells running: npm run dev, sleep 30");
  expect(backgroundLine({ count: 1, commands: [" "] })).toBe("1 shell running");
});

test("background_comes_after_working_and_before_idle", () => {
  expect(BUCKETS).toEqual(["needs_you", "ready", "working", "background", "idle"]);
});

test("only_an_idle_agent_moves_to_background", () => {
  const p = preview("p", "idle", { background: shell });
  expect(withBackground("idle", p)).toBe("background");
  for (const b of ["needs_you", "ready", "working"] as Bucket[]) expect(withBackground(b, p)).toBe(b);
  expect(withBackground("idle", preview("p", "idle"))).toBe("idle");
  expect(withBackground("idle", undefined)).toBe("idle");
});

test("merge_puts_background_agents_in_their_bucket_with_the_shell_line", () => {
  const items = mergeBoard(
    [host([agent("p1", "idle", 3), agent("p2", "working"), agent("p3", "done", 7), agent("p4", "idle", 2), agent("p5", "blocked")])],
    {
      "h:p1": preview("p1", "idle", { background: shell }),
      "h:p2": preview("p2", "working", { activity: "Running pnpm test", background: shell }),
      // Unread: "Ready" wins over the background work.
      "h:p3": preview("p3", "done", { background: shell }),
      // A preview fetched under another status does not count.
      "h:p4": preview("p4", "working", { background: shell }),
      "h:p5": preview("p5", "blocked", { question: "Allow git push?", background: shell }),
    },
    { "h:p1": 3, "h:p3": 1, "h:p4": 2 },
    {},
  );
  expect(items.map((i) => [i.key, i.bucket])).toEqual([
    ["h:p5", "needs_you"],
    ["h:p3", "ready"],
    ["h:p2", "working"],
    ["h:p1", "background"],
    ["h:p4", "idle"],
  ]);
  const bg = items.find((i) => i.key === "h:p1")!;
  expect(bg.line).toBe("1 shell running: npm run dev");
  expect(items.find((i) => i.key === "h:p2")!.line).toBe("Running pnpm test");

  const counts = countBuckets(items);
  expect(counts).toEqual({ needs_you: 1, ready: 1, working: 1, background: 1, idle: 1 });
  expect(filterBoard(items, "background").map((i) => i.key)).toEqual(["h:p1"]);
  expect(groupBoard(items, "status").map((s) => s.title)).toEqual(["Needs you", "Ready", "Working", "Background", "Idle"]);
});

test("preview_line_of_background_falls_back_to_the_last_reply", () => {
  expect(previewLine("background", { pane_id: "p", source: "log", last_reply: "Done.", background: { count: 0, agents: 1 } })).toBe("1 subagent running");
  expect(previewLine("background", { pane_id: "p", source: "log", last_reply: "Done." })).toBe("Done.");
});

test("summary_counts_background", () => {
  const c = (needs_you: number, ready: number, working: number, background: number, idle: number) => ({ needs_you, ready, working, background, idle });
  expect(boardSummary(c(0, 0, 2, 1, 1))).toMatchObject({ value: 2, tone: "working", detail: "1 in background · 1 idle" });
  // All quiet: the number of agents, and the detail names the background work.
  const quiet = boardSummary(c(0, 0, 0, 2, 3));
  expect(quiet).toMatchObject({ value: 5, label: "agents, all quiet", tone: "quiet", detail: "2 in background" });
  expect(quiet.spoken).toBe("5 agents, all quiet. 2 in background.");
});

test("card_label_reads_the_background_status_and_line", () => {
  const [item] = mergeBoard([host([agent("p1", "idle", 3)])], { "h:p1": preview("p1", "idle", { background: shell }) }, { "h:p1": 3 }, {});
  expect(cardLabel(item)).toBe("api, background, studio · claude, 1 shell running: npm run dev");
});

test("background_start_and_end_are_not_announced", () => {
  const items = mergeBoard([host([agent("a", "idle", 1), agent("b", "idle", 1)])], { "h:a": preview("a", "idle", { background: shell }) }, { "h:a": 1, "h:b": 1 }, {});
  expect(bucketChanges({ "h:a": "idle", "h:b": "background" }, items)).toEqual([]);
  expect(bucketChanges({ "h:a": "ready" }, items)).toEqual([]);
  expect(bucketChanges({ "h:a": "working" }, items).map((c) => c.to)).toEqual(["background"]);
});
