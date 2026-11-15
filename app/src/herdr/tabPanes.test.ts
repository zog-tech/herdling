import type { Snapshot } from "./snapshot";
import { pageTarget, tabPanes } from "./tabPanes";

const snap: Snapshot = {
  workspaces: [{ workspace_id: "w1", label: "api", number: 1, agent_status: "working" }],
  tabs: [
    { tab_id: "t1", workspace_id: "w1", label: "agents", number: 1, agent_status: "working" },
    { tab_id: "t2", workspace_id: "w1", label: "docs", number: 2, agent_status: "idle" },
  ],
  panes: [
    { pane_id: "p1", tab_id: "t1", workspace_id: "w1", agent: "claude" },
    { pane_id: "p2", tab_id: "t1", workspace_id: "w1", cwd: "/home/sam/proj", terminal_title_stripped: "zsh" },
    { pane_id: "p3", tab_id: "t2", workspace_id: "w1", agent: "codex" },
  ],
  agents: [
    { pane_id: "p1", tab_id: "t1", workspace_id: "w1", agent: "claude", agent_status: "blocked", name: "fix login" },
    { pane_id: "p3", tab_id: "t2", workspace_id: "w1", agent: "codex", agent_status: "idle" },
    // Not in the pane list yet.
    { pane_id: "p4", tab_id: "t1", workspace_id: "w1", agent: "pi", agent_status: "working" },
  ],
};

test("two_or_more_panes_in_order", () => {
  const t = tabPanes(snap, "p2")!;
  expect(t.tabId).toBe("t1");
  expect(t.tabLabel).toBe("agents");
  expect(t.panes.map((p) => p.pane_id)).toEqual(["p1", "p2", "p4"]);
  expect(t.index).toBe(1);
  expect(t.panes[0]).toMatchObject({ kind: "claude", status: "blocked", terminal: false });
  expect(t.panes[1]).toMatchObject({ terminal: true });
  expect(pageTarget(t, -1)).toBe("p1");
  expect(pageTarget(t, 1)).toBe("p4");
  expect(pageTarget(tabPanes(snap, "p4")!, 1)).toBeUndefined();
});

test("one_pane_or_unknown_pane_gives_null", () => {
  expect(tabPanes(snap, "p3")).toBeNull();
  expect(tabPanes(snap, "nope")).toBeNull();
  expect(tabPanes(undefined, "p1")).toBeNull();
});
