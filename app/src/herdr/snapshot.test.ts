import { applyEvent, needsYou, type AgentInfo, type Snapshot } from "./snapshot";

function agent(over: Partial<AgentInfo> & { pane_id: string }): AgentInfo {
  return {
    agent: "claude",
    agent_status: "idle",
    cwd: "/home/sam/proj",
    state_change_seq: 1,
    tab_id: "w1:t1",
    terminal_title_stripped: "Task",
    workspace_id: "w1",
    ...over,
  };
}

function snap(agents: AgentInfo[]): Snapshot {
  return {
    agents,
    workspaces: [{ workspace_id: "w1", label: "proj", number: 1, agent_status: "idle" }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "1", number: 1, agent_status: "idle" }],
    panes: agents.map((a) => ({ pane_id: a.pane_id, tab_id: a.tab_id, workspace_id: a.workspace_id })),
  };
}

test("status_change_updates_agent", () => {
  const s = snap([agent({ pane_id: "w1:p1", agent_status: "working" })]);
  const next = applyEvent(s, {
    event: "pane_agent_status_changed",
    data: { type: "pane_agent_status_changed", pane_id: "w1:p1", workspace_id: "w1", agent_status: "blocked" },
  });
  expect(next.agents[0].agent_status).toBe("blocked");
  expect(s.agents[0].agent_status).toBe("working");
});

test("dotted event names work too", () => {
  const s = snap([agent({ pane_id: "w1:p1" })]);
  const next = applyEvent(s, { event: "pane.agent_status_changed", data: { pane_id: "w1:p1", agent_status: "working" } });
  expect(next.agents[0].agent_status).toBe("working");
});

test("pane_closed_removes_agent", () => {
  const s = snap([agent({ pane_id: "w1:p1" }), agent({ pane_id: "w1:p2" })]);
  const next = applyEvent(s, { event: "pane_closed", data: { pane_id: "w1:p1", workspace_id: "w1" } });
  expect(next.agents.map((a) => a.pane_id)).toEqual(["w1:p2"]);
  expect(next.panes.map((p) => p.pane_id)).toEqual(["w1:p2"]);
});

test("workspace_closed removes its agents, tabs and panes", () => {
  const s = snap([agent({ pane_id: "w1:p1" })]);
  const next = applyEvent(s, { event: "workspace_closed", data: { workspace_id: "w1", workspace: null } });
  expect(next.workspaces).toEqual([]);
  expect(next.tabs).toEqual([]);
  expect(next.agents).toEqual([]);
});

test("workspace_created and renamed", () => {
  let s = snap([]);
  s = applyEvent(s, {
    event: "workspace_created",
    data: { workspace: { workspace_id: "w2", label: "new", number: 2, agent_status: "unknown" } },
  });
  expect(s.workspaces.map((w) => w.label)).toEqual(["proj", "new"]);
  s = applyEvent(s, { event: "workspace_renamed", data: { workspace_id: "w2", label: "renamed" } });
  expect(s.workspaces[1].label).toBe("renamed");
});

test("tab_closed removes its panes and agents", () => {
  const s = snap([agent({ pane_id: "w1:p1" })]);
  const next = applyEvent(s, { event: "tab_closed", data: { tab_id: "w1:t1", workspace_id: "w1" } });
  expect(next.tabs).toEqual([]);
  expect(next.agents).toEqual([]);
});

test("unknown events set the stale flag", () => {
  const s = snap([]);
  expect(applyEvent(s, { event: "pane_updated", data: {} }).stale).toBe(true);
  expect(applyEvent(s, { event: "workspace_renamed", data: { workspace_id: "w1", label: "x" } }).stale).toBeFalsy();
});

test("close events set stale so an in-flight refetch is replaced", () => {
  const s = snap([agent({ pane_id: "w1:p1" })]);
  expect(applyEvent(s, { event: "pane_closed", data: { pane_id: "w1:p1" } }).stale).toBe(true);
  expect(applyEvent(s, { event: "tab_closed", data: { tab_id: "w1:t1" } }).stale).toBe(true);
  expect(applyEvent(s, { event: "workspace_closed", data: { workspace_id: "w1" } }).stale).toBe(true);
});

test("needs_you_orders_blocked_first", () => {
  const hosts = [
    {
      hostId: "a",
      snapshot: snap([
        agent({ pane_id: "p1", agent_status: "idle", state_change_seq: 50 }),
        agent({ pane_id: "p2", agent_status: "blocked", state_change_seq: 10 }),
        agent({ pane_id: "p3", agent_status: "working", state_change_seq: 99 }),
        agent({ pane_id: "p4", agent_status: "done", state_change_seq: 60 }),
      ]),
    },
  ];
  expect(needsYou(hosts, {}).map((n) => n.agent.pane_id)).toEqual(["p2", "p4", "p1"]);
});

test("needs_you_hides_seen", () => {
  const hosts = [
    {
      hostId: "a",
      snapshot: snap([
        agent({ pane_id: "p1", agent_status: "idle", state_change_seq: 50 }),
        agent({ pane_id: "p2", agent_status: "done", state_change_seq: 70 }),
        agent({ pane_id: "p3", agent_status: "blocked", state_change_seq: 5 }),
      ]),
    },
  ];
  const seen = { "a:p1": 50, "a:p2": 60, "a:p3": 5 };
  expect(needsYou(hosts, seen).map((n) => n.agent.pane_id)).toEqual(["p3", "p2"]);
});
