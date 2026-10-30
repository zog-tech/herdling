import { agentSubtitle, agentTitle, secondaryTitle } from "./names";
import type { Snapshot } from "./snapshot";

const agent = {
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  agent: "claude",
  agent_status: "working" as const,
  state_change_seq: 1,
  terminal_title_stripped: "Fix the login flow",
};
const snap = (tabs: number, over: Partial<Snapshot> = {}): Snapshot => ({
  agents: [agent],
  workspaces: [{ workspace_id: "w1", label: "api", number: 1, agent_status: "working", tab_count: tabs }],
  tabs: Array.from({ length: tabs }, (_, i) => ({
    tab_id: `w1:t${i + 1}`,
    workspace_id: "w1",
    label: `tab${i + 1}`,
    number: i + 1,
    agent_status: "working" as const,
  })),
  panes: [{ pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1" }],
  ...over,
});

test("agent_name_wins_over_everything", () => {
  expect(agentTitle(snap(2), { ...agent, name: "reviewer" })).toBe("reviewer");
});

test("pane_label_comes_after_the_agent_name", () => {
  const s = snap(1, { panes: [{ pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", label: "left" }] });
  expect(agentTitle(s, agent)).toBe("left");
});

test("workspace_label_alone_with_one_tab", () => {
  expect(agentTitle(snap(1), agent)).toBe("api");
});

test("workspace_and_tab_label_with_more_tabs", () => {
  expect(agentTitle(snap(2), { ...agent, name: null })).toBe("api · tab1");
  // No tab_count from an older herdr: count the tabs.
  const s = snap(2);
  s.workspaces[0].tab_count = undefined;
  expect(agentTitle(s, agent)).toBe("api · tab1");
});

test("terminal_title_kind_then_pane_id_without_a_workspace", () => {
  const empty = { workspaces: [], tabs: [], panes: [] };
  expect(agentTitle(empty, agent)).toBe("Fix the login flow");
  expect(agentTitle(empty, { ...agent, terminal_title_stripped: "" })).toBe("claude");
  expect(agentTitle(empty, { ...agent, terminal_title_stripped: "", agent: "" })).toBe("w1:p1");
});

test("subtitle_is_host_and_kind", () => {
  expect(agentSubtitle("studio", agent)).toBe("studio · claude");
  expect(agentSubtitle("buildbox", { agent: "codex", display_agent: "Codex CLI" })).toBe("buildbox · Codex CLI");
});

test("terminal_title_is_secondary_only_when_it_adds_something", () => {
  expect(secondaryTitle(snap(1), agent)).toBe("Fix the login flow");
  const empty = { workspaces: [], tabs: [], panes: [] };
  expect(secondaryTitle(empty, agent)).toBeUndefined();
});
