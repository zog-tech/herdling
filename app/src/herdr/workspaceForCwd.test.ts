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

  it("picks a Herdr 2 workspace too: startSession drops it when the host cannot add a tab", () => {
    expect(workspaceForCwd(core, "/home/sam/proj")?.workspace_id).toBe("hc:space:1");
    expect(workspaceForCwd({ ...core, agents: [oneAgent] }, "/home/sam/proj")?.workspace_id).toBe("w1");
  });

  it("picks a plain-id workspace of herdlingd 0.2.0", () => {
    const plain = { ...coreAgent, pane_id: "t1", tab_id: "tab:1", workspace_id: "space:1", backend: undefined };
    const snap2 = { workspaces: [ws("space:1")], tabs: [], panes: [], agents: [plain] };
    expect(workspaceForCwd(snap2, "/home/sam/proj")?.workspace_id).toBe("space:1");
  });
});
