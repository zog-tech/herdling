import { workspaceForCwd } from "./workspaceForCwd";

const ws = (id: string) => ({ workspace_id: id, label: id, number: 1, agent_status: "idle" as const });
const snap = {
  workspaces: [ws("w1"), ws("w2")],
  tabs: [],
  panes: [{ pane_id: "w2:p1", tab_id: "w2:t1", workspace_id: "w2", cwd: "/home/sam/api" } as any],
  agents: [{ pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", agent: "claude", agent_status: "idle" as const, cwd: "/home/sam/proj", state_change_seq: 1 }],
};

describe("workspaceForCwd", () => {
  it("matches an agent cwd, ignoring a trailing slash", () => {
    expect(workspaceForCwd(snap, "/home/sam/proj/")?.workspace_id).toBe("w1");
  });
  it("matches a pane cwd", () => {
    expect(workspaceForCwd(snap, "/home/sam/api")?.workspace_id).toBe("w2");
  });
  it("returns undefined when nothing matches", () => {
    expect(workspaceForCwd(snap, "/home/sam/other")).toBeUndefined();
    expect(workspaceForCwd(undefined, "/x")).toBeUndefined();
  });
});
