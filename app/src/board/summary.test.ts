import { boardSummary } from "./summary";

const c = (needs_you: number, ready: number, working: number, idle: number) => ({ needs_you, ready, working, idle });

test("summary_leads_with_needs_you", () => {
  const s = boardSummary(c(2, 1, 3, 4));
  expect(s).toMatchObject({ value: 2, label: "need you", tone: "needs_you", detail: "1 ready · 3 working · 4 idle" });
  expect(s.spoken).toBe("2 agents need you. 1 ready, 3 working, 4 idle.");
});

test("summary_singular_needs_you", () => {
  const s = boardSummary(c(1, 0, 0, 0));
  expect(s).toMatchObject({ value: 1, label: "needs you", detail: "" });
  expect(s.spoken).toBe("1 agent needs you.");
});

test("summary_falls_back_to_working_then_ready", () => {
  expect(boardSummary(c(0, 1, 3, 0))).toMatchObject({ value: 3, label: "working", tone: "working", detail: "1 ready" });
  expect(boardSummary(c(0, 2, 0, 1))).toMatchObject({ value: 2, label: "ready", tone: "ready", detail: "1 idle" });
});

test("summary_all_quiet_counts_agents", () => {
  expect(boardSummary(c(0, 0, 0, 5))).toMatchObject({ value: 5, label: "agents, all quiet", tone: "quiet", detail: "" });
  expect(boardSummary(c(0, 0, 0, 1)).label).toBe("agent, all quiet");
  expect(boardSummary(c(0, 0, 0, 0))).toMatchObject({ value: 0, tone: "quiet", spoken: "0 agents, all quiet." });
});
