import { neighborAgents } from "./neighbors";
import type { Snapshot } from "./snapshot";

const agent = (pane_id: string, tab_id: string, workspace_id: string) => ({
  pane_id, tab_id, workspace_id, agent: "claude", agent_status: "idle" as const, state_change_seq: 1,
});
const tab = (tab_id: string, workspace_id: string, number: number) => ({ tab_id, workspace_id, label: tab_id, number, agent_status: "idle" as const });
const pane = (pane_id: string, tab_id: string, workspace_id: string) => ({ pane_id, tab_id, workspace_id });

const snap: Snapshot = {
  workspaces: [],
  // Tab numbers run opposite to list order, so ordering must use `number`.
  tabs: [tab("t1", "w1", 2), tab("t2", "w1", 1), tab("t3", "w2", 1)],
  panes: [pane("p1", "t1", "w1"), pane("p2", "t2", "w1"), pane("p4", "t2", "w1"), pane("p3", "t3", "w2")],
  agents: [agent("p1", "t1", "w1"), agent("p4", "t2", "w1"), agent("p2", "t2", "w1"), agent("p3", "t3", "w2")],
};

describe("neighborAgents", () => {
  it("orders_by_tab_then_pane", () => {
    // Order: p2, p4 (tab 1, pane index 1 then 2), p1 (tab 2).
    expect(neighborAgents(snap, "p4")).toEqual({ prev: "p2", next: "p1" });
  });
  it("first_has_no_prev", () => {
    expect(neighborAgents(snap, "p2")).toEqual({ prev: undefined, next: "p4" });
    expect(neighborAgents(snap, "p1")).toEqual({ prev: "p4", next: undefined });
  });
  it("other_workspace_excluded", () => {
    expect(neighborAgents(snap, "p3")).toEqual({ prev: undefined, next: undefined });
  });
  it("unknown_pane_returns_empty", () => {
    expect(neighborAgents(snap, "nope")).toEqual({});
  });
});
