import type { Snapshot } from "@/herdr/snapshot";

import { closeSpaceParams, firstTab, hostSpaces, shortFolder, spaceDetail, spaceFolder, tabLabel } from "./spaces";

const snap: Snapshot = {
  workspaces: [
    { workspace_id: "hc:space:2", label: "Docs", number: 2, agent_status: "idle", backend: "core" },
    { workspace_id: "hc:space:1", label: "Payments", number: 1, agent_status: "blocked", backend: "core" },
  ],
  tabs: [
    { tab_id: "hc:tab:b", workspace_id: "hc:space:1", label: "tests", number: 2, agent_status: "idle" },
    { tab_id: "hc:tab:a", workspace_id: "hc:space:1", label: "agents", number: 1, agent_status: "blocked" },
    { tab_id: "hc:tab:c", workspace_id: "hc:space:2", label: "", number: 1, agent_status: "idle" },
  ],
  panes: [
    { pane_id: "hc:t1", tab_id: "hc:tab:a", workspace_id: "hc:space:1" },
    { pane_id: "hc:t2", tab_id: "hc:tab:a", workspace_id: "hc:space:1" },
    { pane_id: "hc:t3", tab_id: "hc:tab:b", workspace_id: "hc:space:1", terminal_title_stripped: "zsh" },
    { pane_id: "hc:t4", tab_id: "hc:tab:c", workspace_id: "hc:space:2" },
    { pane_id: "hc:t5", tab_id: "hc:tab:late", workspace_id: "hc:space:2", label: "late" },
  ],
  agents: [
    { pane_id: "hc:t1", tab_id: "hc:tab:a", workspace_id: "hc:space:1", agent: "claude", agent_status: "blocked", name: "Flaky test" },
    { pane_id: "hc:t2", tab_id: "hc:tab:a", workspace_id: "hc:space:1", agent: "codex", agent_status: "working", name: "Retry jitter" },
    { pane_id: "hc:t4", tab_id: "hc:tab:c", workspace_id: "hc:space:2", agent: "pi", agent_status: "working", name: "Write docs" },
  ],
};

describe("hostSpaces", () => {
  const spaces = hostSpaces(snap);
  it("orders spaces and tabs by number, with the panes of each tab", () => {
    expect(spaces.map((s) => s.label)).toEqual(["Payments", "Docs"]);
    expect(spaces[0].tabs.map((t) => [t.label, t.panes.map((p) => [p.title, p.status])])).toEqual([
      ["agents", [["Flaky test", "blocked"], ["Retry jitter", "working"]]],
      ["tests", [["zsh", "terminal"]]],
    ]);
  });

  it("counts attention and work; attention wins over work", () => {
    expect(spaces[0]).toMatchObject({ attention: 1, working: false, agents: 2, core: true });
    expect(spaces[1]).toMatchObject({ attention: 0, working: true, agents: 1 });
    expect(spaces[0].tabs[0]).toMatchObject({ attention: 1, working: true });
  });

  it("keeps a pane whose tab the snapshot does not list", () => {
    expect(spaces[1].tabs.map((t) => [t.tabId, t.panes.map((p) => p.title)])).toEqual([
      ["hc:tab:c", ["Write docs"]],
      ["hc:tab:late", ["late"]],
    ]);
  });
});

test("firstTab and tabLabel", () => {
  const [pay, docs] = hostSpaces(snap);
  expect(firstTab(pay)).toBe("hc:tab:a");
  expect(firstTab(pay, "hc:tab:b")).toBe("hc:tab:b");
  expect(firstTab(pay, "hc:tab:gone")).toBe("hc:tab:a");
  expect(firstTab({ tabs: [] })).toBeUndefined();
  expect(tabLabel(docs.tabs[0], 0)).toBe("Tab 1");
  expect(tabLabel(pay.tabs[1], 1)).toBe("tests");
});

test("the close of a Herdr 2 space names the panes that the screen showed", () => {
  const space = hostSpaces(snap).find((s) => s.workspaceId === "hc:space:1")!;
  expect(closeSpaceParams(space, true)).toEqual({ workspace_id: "hc:space:1", pane_ids: ["hc:t1", "hc:t2", "hc:t3"] });
  // herdr 1 knows no `pane_ids`.
  expect(closeSpaceParams(space, false)).toEqual({ workspace_id: "hc:space:1" });
});

describe("row detail", () => {
  it("finds the folder of a space from its first agent, else its first pane", () => {
    const withCwd: Snapshot = {
      ...snap,
      agents: snap.agents.map((a) => (a.pane_id === "hc:t2" ? { ...a, cwd: "/Users/jane/dev/pay" } : a)),
      panes: snap.panes.map((p) => (p.pane_id === "hc:t4" ? { ...p, foreground_cwd: "/home/sam/docs" } : p)),
    };
    expect(spaceFolder(withCwd, "hc:space:1")).toBe("/Users/jane/dev/pay");
    expect(spaceFolder(withCwd, "hc:space:2")).toBe("/home/sam/docs");
    expect(spaceFolder(snap, "hc:space:1")).toBeUndefined();
  });

  it("shortens the home folder and cuts a long path in the middle", () => {
    expect(shortFolder("/Users/jane/dev/pay/")).toBe("~/dev/pay");
    expect(shortFolder("/home/sam")).toBe("~");
    expect(shortFolder("/srv/app")).toBe("/srv/app");
    const long = shortFolder("/Users/jane/dev/apps/very-long-project-name/packages/web", 24);
    expect(long).toHaveLength(24);
    expect(long.startsWith("~/dev")).toBe(true);
    expect(long).toContain("…");
    expect(long.endsWith("web")).toBe(true);
  });

  it("tells two spaces with one name apart by their folder", () => {
    const a = spaceDetail({ folder: "/Users/jane/a/sandbox", paneCount: 3, workingCount: 1 });
    const b = spaceDetail({ folder: "/Users/jane/b/sandbox", paneCount: 1, workingCount: 0 });
    expect(a).toBe("~/a/sandbox · 3 panes · 1 working");
    expect(b).toBe("~/b/sandbox · 1 pane");
    expect(spaceDetail({ paneCount: 0, workingCount: 0 })).toBe("0 panes");
  });

  it("fills the counts of a space", () => {
    const s = hostSpaces(snap);
    expect(s[0]).toMatchObject({ paneCount: 3, workingCount: 1 });
    expect(s[1]).toMatchObject({ paneCount: 2, workingCount: 1 });
  });
});
