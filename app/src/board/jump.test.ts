import type { AgentInfo, PaneInfo, Snapshot } from "@/herdr/snapshot";

import { filterJump, jumpDetail, jumpTasks, type JumpHost } from "./jump";

const agent = (pane_id: string, status: AgentInfo["agent_status"], over: Partial<AgentInfo> = {}): AgentInfo => ({
  pane_id,
  tab_id: "hc:tab:1",
  workspace_id: "hc:space:1",
  agent: "claude",
  agent_status: status,
  cwd: "/home/sam/proj/api",
  ...over,
});
const pane = (pane_id: string, over: Partial<PaneInfo> = {}): PaneInfo => ({ pane_id, tab_id: "hc:tab:1", workspace_id: "hc:space:1", ...over });

function snap(agents: AgentInfo[], extraPanes: PaneInfo[] = []): Snapshot {
  return {
    agents,
    workspaces: [{ workspace_id: "hc:space:1", label: "Payments", number: 1, agent_status: "idle" }],
    tabs: [],
    panes: [...agents.map((a) => pane(a.pane_id, { agent: a.agent })), ...extraPanes],
  };
}

const hosts: JumpHost[] = [
  {
    hostId: "h1",
    hostName: "studio.local",
    snapshot: snap(
      [
        agent("hc:t1", "idle", { name: "Fix the login form", group: "Payments", repo: "api", branch: "fix-login" }),
        agent("hc:t2", "working", { name: "Read the tests", parent_id: "hc:t1" }),
        agent("hc:t3", "blocked", { name: "Flaky test", group: "Payments" }),
      ],
      [pane("hc:t9", { cwd: "/home/sam/proj/api", terminal_title_stripped: "zsh" })],
    ),
  },
  { hostId: "h2", hostName: "laptop", snapshot: snap([agent("p1", "working", { name: "Docs", workspace_id: "w1" })]) },
];

describe("jumpTasks", () => {
  it("lists tasks with their helpers and the terminals, needs-you first in a group", () => {
    const t = jumpTasks(hosts);
    expect(t.map((x) => [x.key, x.status, x.group])).toEqual([
      ["h1:hc:t3", "blocked", "Payments"],
      ["h1:hc:t1", "idle", "Payments"],
      ["h1:hc:t9", "terminal", "Payments"],
      ["h2:p1", "working", undefined],
    ]);
    expect(t[1].helpers).toEqual([{ paneId: "hc:t2", title: "Read the tests", status: "working" }]);
    expect(t[1]).toMatchObject({ repo: "api", branch: "fix-login", kind: "Claude Code" });
  });
});

describe("filterJump", () => {
  const all = jumpTasks(hosts);
  it("keeps tasks with every word, also from a helper, the branch or the computer", () => {
    expect(filterJump(all, "").length).toBe(4);
    expect(filterJump(all, "read tests").map((x) => x.paneId)).toEqual(["hc:t1"]);
    expect(filterJump(all, "FIX-LOGIN").map((x) => x.paneId)).toEqual(["hc:t1"]);
    expect(filterJump(all, "laptop").map((x) => x.paneId)).toEqual(["p1"]);
    expect(filterJump(all, "payments zsh").map((x) => x.paneId)).toEqual(["hc:t9"]);
    expect(filterJump(all, "nothing-like-this")).toEqual([]);
  });
});

test("jumpDetail", () => {
  expect(jumpDetail({ kind: "Claude Code", hostName: "studio.local", status: "idle" }, true)).toBe("Claude Code · studio.local");
  expect(jumpDetail({ kind: "", hostName: "studio.local", status: "terminal" }, false)).toBe("Terminal");
});
