import type { JumpHost } from "@/board/jump";
import type { AgentInfo, PaneInfo, Snapshot } from "@/herdr/snapshot";

import { initialTarget, shareTargets } from "./targets";

const agent = (pane_id: string, status: AgentInfo["agent_status"], over: Partial<AgentInfo> = {}): AgentInfo => ({
  pane_id,
  tab_id: "t1",
  workspace_id: "w1",
  agent: "claude",
  agent_status: status,
  cwd: "/home/sam/proj/api",
  ...over,
});
const pane = (pane_id: string, over: Partial<PaneInfo> = {}): PaneInfo => ({ pane_id, tab_id: "t1", workspace_id: "w1", ...over });
const snap = (agents: AgentInfo[], extra: PaneInfo[] = []): Snapshot => ({
  agents,
  workspaces: [{ workspace_id: "w1", label: "api", number: 1, agent_status: "idle" }],
  tabs: [],
  panes: [...agents.map((a) => pane(a.pane_id, { agent: a.agent })), ...extra],
});

const hosts: JumpHost[] = [
  {
    hostId: "h1",
    hostName: "studio.local",
    snapshot: snap(
      [agent("a1", "idle", { name: "Login form" }), agent("a2", "working", { name: "Helper", parent_id: "a1" })],
      [pane("t9", { terminal_title_stripped: "zsh" })],
    ),
  },
  { hostId: "h2", hostName: "laptop", snapshot: snap([agent("b1", "blocked", { name: "Docs" })]) },
];

describe("shareTargets", () => {
  it("lists the agents of every host without terminals and helpers", () => {
    expect(shareTargets(hosts).map((t) => t.key)).toEqual(["h1:a1", "h2:b1"]);
  });
  it("filters with the search of the jump list", () => {
    expect(shareTargets(hosts, "laptop").map((t) => t.key)).toEqual(["h2:b1"]);
    expect(shareTargets(hosts, "zsh")).toEqual([]);
  });
});

describe("initialTarget", () => {
  const all = shareTargets(hosts);
  it("selects the last agent when it is still there", () => {
    expect(initialTarget(all, { hostId: "h2", paneId: "b1" })?.key).toBe("h2:b1");
    expect(initialTarget(all, { hostId: "h2", paneId: "gone" })).toBeUndefined();
  });
  it("selects the only agent, else none", () => {
    expect(initialTarget(all.slice(0, 1))?.key).toBe("h1:a1");
    expect(initialTarget(all)).toBeUndefined();
    expect(initialTarget([])).toBeUndefined();
  });
});
