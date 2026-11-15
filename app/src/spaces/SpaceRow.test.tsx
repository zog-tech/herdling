import { spaceLabel } from "./SpaceRow";

test("space_label_reads_tabs_agents_and_attention", () => {
  const tab = { tabId: "t", label: "", panes: [], attention: 0, working: false };
  expect(spaceLabel({ label: "Payments", tabs: [tab, tab], agents: 3, attention: 1, working: true })).toBe("Payments, 2 tabs, 3 agents, 1 needs you");
  expect(spaceLabel({ label: "Docs", tabs: [tab], agents: 1, attention: 0, working: true })).toBe("Docs, 1 tab, 1 agent, working");
  expect(spaceLabel({ label: "Idle", tabs: [], agents: 0, attention: 0, working: false })).toBe("Idle, 0 tabs, 0 agents");
});
