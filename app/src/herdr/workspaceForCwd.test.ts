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
  it("ignores a plain pane cwd: a shell can cd anywhere", () => {
    expect(workspaceForCwd(snap, "/home/sam/api")).toBeUndefined();
  });
  it("returns undefined when nothing matches", () => {
    expect(workspaceForCwd(snap, "/home/sam/other")).toBeUndefined();
    expect(workspaceForCwd(undefined, "/x")).toBeUndefined();
  });
});

describe("workspaceForCwd with Herdr 2 entries", () => {
  const coreAgent = {
    pane_id: "hc:t1",
    tab_id: "hc:tab:1",
    workspace_id: "hc:space:1",
    agent: "claude",
    agent_status: "idle" as const,
    cwd: "/home/sam/proj",
    backend: "core" as const,
  };
  const oneAgent = { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", agent: "claude", agent_status: "idle" as const, cwd: "/home/sam/proj" };
  const core = { workspaces: [{ ...ws("hc:space:1"), backend: "core" as const }, ws("w1")], tabs: [], panes: [], agents: [coreAgent, oneAgent] };

  it("never picks a Herdr 2 workspace for New session", () => {
    expect(workspaceForCwd(core, "/home/sam/proj")?.workspace_id).toBe("w1");
    expect(workspaceForCwd({ ...core, agents: [coreAgent] }, "/home/sam/proj")).toBeUndefined();
  });
});
