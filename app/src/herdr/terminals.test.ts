import type { AgentInfo, PaneInfo, Snapshot } from "./snapshot";
import { boardTerminals, showsTerminal, terminalDetail, terminalPane, terminalPanes, terminalTitle } from "./terminals";

const pane = (id: string, extra: Partial<PaneInfo> = {}): PaneInfo => ({ pane_id: id, tab_id: `t-${id}`, workspace_id: "w1", label: null, ...extra });
const agent = (id: string, kind: string | null = "claude"): AgentInfo => ({
  pane_id: id,
  tab_id: `t-${id}`,
  workspace_id: "w1",
  agent: kind,
  agent_status: "idle",
  state_change_seq: 1,
});
const snap = (panes: PaneInfo[], agents: AgentInfo[]): Snapshot => ({ panes, agents, workspaces: [], tabs: [] });

describe("terminalPanes", () => {
  it("keeps the panes that host no agent", () => {
    const s = snap(
      [
        pane("p1", { agent: "claude" }),
        pane("p2"),
        // herdr lists an agent it has not detected yet (kind null): still an agent pane.
        pane("p3"),
        // The pane carries a kind, but the agent list lags behind.
        pane("p4", { agent: "codex" }),
        pane("p5", { agent: null }),
      ],
      [agent("p1"), agent("p3", null)],
    );
    expect(terminalPanes(s).map((p) => p.pane_id)).toEqual(["p2", "p5"]);
    expect(terminalPane(s, "p2")?.pane_id).toBe("p2");
    expect(terminalPane(s, "p1")).toBeUndefined();
    expect(terminalPane(s, "nope")).toBeUndefined();
    expect(terminalPane(undefined, "p2")).toBeUndefined();
  });
});

describe("showsTerminal", () => {
  const lagging = snap([pane("p1")], []);
  it("shows a pane with no agent and no mark as a terminal", () => {
    expect(showsTerminal(lagging, "p1")).toBe(true);
  });
  it("keeps the agent layout for a pane that expects an agent, while the snapshot lags", () => {
    expect(showsTerminal(lagging, "p1", "agent")).toBe(false);
    expect(showsTerminal(undefined, "p1", "agent")).toBe(false);
  });
  it("shows a new shell as a terminal before the snapshot shows its pane", () => {
    expect(showsTerminal(undefined, "p1", "shell")).toBe(true);
    expect(showsTerminal(snap([], []), "p1", "shell")).toBe(true);
    expect(showsTerminal(snap([], []), "p1")).toBe(false);
  });
  it("gives an agent in the pane the agent layout, whatever the mark", () => {
    const s = snap([pane("p1")], [agent("p1")]);
    expect(showsTerminal(s, "p1", "shell")).toBe(false);
    expect(showsTerminal(s, "p1")).toBe(false);
  });
});

describe("terminalTitle", () => {
  it("uses the pane label, then the terminal title, then the folder name", () => {
    expect(terminalTitle(pane("p", { label: "logs", terminal_title_stripped: "tail -f", cwd: "/home/sam/proj" }))).toBe("logs");
    expect(terminalTitle(pane("p", { label: " ", terminal_title_stripped: "tail -f", cwd: "/home/sam/proj" }))).toBe("tail -f");
    expect(terminalTitle(pane("p", { cwd: "/home/sam/proj/" }))).toBe("proj");
    expect(terminalTitle(pane("p", { foreground_cwd: "/srv/app" }))).toBe("app");
    expect(terminalTitle(pane("p"))).toBe("Terminal");
  });
});

describe("boardTerminals", () => {
  it("lists the terminals of every host in host order", () => {
    const list = boardTerminals([
      { hostId: "h1", hostName: "studio", agents: [agent("p1")], panes: [pane("p1"), pane("p2", { cwd: "/home/sam/api" })] },
      { hostId: "h2", hostName: "build", agents: [], panes: [pane("p1", { terminal_title_stripped: "make" })] },
    ]);
    expect(list).toEqual([
      { key: "h1:p2", hostId: "h1", hostName: "studio", paneId: "p2", title: "api", folder: "/home/sam/api" },
      { key: "h2:p1", hostId: "h2", hostName: "build", paneId: "p1", title: "make", folder: undefined },
    ]);
  });

  it("shows the host only with more than one host, and home as ~", () => {
    const t = { hostName: "studio", folder: "/home/sam/api" };
    expect(terminalDetail(t, false)).toBe("~/api");
    expect(terminalDetail(t, true)).toBe("studio · ~/api");
    expect(terminalDetail({ hostName: "studio", folder: "/srv/app" }, false)).toBe("/srv/app");
    expect(terminalDetail({ hostName: "studio" }, false)).toBeUndefined();
    expect(terminalDetail({ hostName: "studio" }, true)).toBe("studio");
  });
});

test("terminal_detail_of_a_herdr_2_terminal_ends_with_herdr_2", () => {
  expect(terminalDetail({ hostName: "studio", folder: "/home/sam/api", paneId: "hc:t3" }, false)).toBe("~/api · Herdr 2");
  expect(terminalDetail({ hostName: "studio", paneId: "hc:t3" }, true)).toBe("studio · Herdr 2");
  expect(terminalDetail({ hostName: "studio", folder: "/home/sam/api", paneId: "w1:p3" }, false)).toBe("~/api");
});
