import type { ThreadItem } from "@herdling/protocol";

// `parseChoices` lives next to a hook that reads the connection store; the native SSH module is not needed here.
jest.mock("@/hosts/connection", () => ({ useHostConn: () => ({ status: "offline", attempt: 0 }) }));

import { parseChoices } from "@/thread/choices";

import { PausableClock } from "./clock";
import { DemoScenario, type DemoNotice } from "./scenario";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function make(notices: DemoNotice[] = []) {
  const s = new DemoScenario({ onNotice: (n) => notices.push(n) });
  s.resume();
  return s;
}

const lastAssistant = (items: ThreadItem[]) => [...items].reverse().find((i) => i.kind === "assistant");

describe("PausableClock", () => {
  it("runs steps in order and keeps the time left while paused", () => {
    const c = new PausableClock();
    const log: string[] = [];
    c.after(1_000, () => log.push("a"));
    c.after(500, () => log.push("b"));
    c.resume();
    jest.advanceTimersByTime(600);
    expect(log).toEqual(["b"]);
    c.pause();
    jest.advanceTimersByTime(10_000);
    expect(log).toEqual(["b"]);
    c.resume();
    jest.advanceTimersByTime(399);
    expect(log).toEqual(["b"]);
    jest.advanceTimersByTime(1);
    expect(log).toEqual(["b", "a"]);
  });

  it("drops all steps on stop", () => {
    const c = new PausableClock();
    const fn = jest.fn();
    c.after(10, fn);
    c.resume();
    c.stop();
    jest.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("DemoScenario seed", () => {
  it("has a shell that runs pnpm dev until Ctrl-C", () => {
    const s = make();
    expect(s.processInfo("t6")).toMatchObject({ shell_pid: 4242, foreground_process_group_id: 4242 });
    expect(s.processInfo("t1")).toMatchObject({ shell_pid: 4242, foreground_process_group_id: 4242 });
    const run = s.processInfo("t7");
    expect(run.foreground_process_group_id).not.toBe(run.shell_pid);
    expect(run.foreground_processes[0]).toMatchObject({ pid: run.foreground_process_group_id, cmdline: "pnpm dev" });
    expect(s.screen("t7").split("\n").at(-1)).toBe("");
    s.sendKeys("t7", ["c-c"]);
    expect(s.processInfo("t7").foreground_process_group_id).toBe(4242);
    expect(s.screen("t7").split("\n").at(-1)).toBe("demo@demo:~/projects/api-server$ ");
    expect(() => s.processInfo("nope")).toThrow();
    s.stop();
  });

  it("has 5 agents in 4 spaces with mixed kinds and states", () => {
    const s = make();
    const all = s.snapshot();
    const snap = { ...all, workspaces: all.workspaces.filter((w) => /^space:\d$/.test(w.workspace_id)), agents: all.agents.filter((a) => /^t[1-5]$/.test(a.pane_id)) };
    expect(snap.workspaces).toHaveLength(4);
    expect(snap.agents).toHaveLength(5);
    expect(new Set(snap.agents.map((a) => a.agent))).toEqual(new Set(["claude", "codex", "pi", "opencode"]));
    const status = Object.fromEntries(snap.agents.map((a) => [a.pane_id, a.agent_status]));
    expect(status).toEqual({ t1: "working", t2: "blocked", t3: "done", t4: "idle", t5: "idle" });
    // Idle agents have seq 0, so they never show as unread "Ready".
    expect(snap.agents.find((a) => a.pane_id === "t4")!.state_change_seq).toBe(0);
    expect(snap.agents.find((a) => a.pane_id === "t3")!.state_change_seq).toBeGreaterThan(0);
    s.stop();
  });

  it("has a Herdr 2 space with a task, a helper and an agent in a repo group", () => {
    const s = make();
    const snap = s.snapshot();
    const core = snap.agents.filter((a) => /^t1\d$/.test(a.pane_id));
    expect(core.map((a) => [a.pane_id, a.agent, a.name, a.agent_status, a.workspace_id])).toEqual([
      ["t11", "claude", "Bundle size", "done", "space:r1"],
      ["t12", "codex", "Rate limits", "idle", "space:r1"],
      ["t13", "claude", "Check chart imports", "working", "space:r1"],
      ["t14", "codex", "Retry jitter", "idle", "g:api-server"],
    ]);
    expect(core[0]).toMatchObject({ group: "research", group_source: "space", repo: "webapp", branch: "main" });
    expect(core[2].parent_id).toBe("t11");
    expect(core[3]).toMatchObject({ group: "api-server", group_source: "repo", repo: "api-server" });
    expect(snap.workspaces.find((w) => w.workspace_id === "space:r1")).toMatchObject({ label: "research" });
    expect(snap.tabs.find((t) => t.tab_id === "tab:a1")).toMatchObject({ label: "agents" });
    expect(snap.panes.filter((p) => /^t1\d$/.test(p.pane_id)).map((p) => p.pane_id)).toEqual(["t11", "t12", "t13", "t14"]);
    // Every entry carries its group, also the first spaces of the demo.
    expect(snap.agents.find((a) => a.pane_id === "t1")).toMatchObject({ group: "webapp", group_source: "space", repo: "webapp" });
    // As a herdlingd with Herdr 2 transcripts: the agent has a chat log.
    expect(s.resolve("t11")).toMatchObject({ kind: "claude", log_path: expect.stringMatching(/^demo:/) });
    expect(s.screen("t11")).toContain("Claude");
    s.stop();
  });

  it("has a plain shell with no agent that answers typed commands", () => {
    const s = make();
    const snap = s.snapshot();
    const shells = snap.panes.filter((p) => !snap.agents.some((a) => a.pane_id === p.pane_id));
    expect(shells.map((p) => p.pane_id)).toEqual(["t6", "t7", "t8", "t9"]);
    expect(shells[0].cwd).toBe("/home/demo/projects/webapp");
    expect(s.resolve("t6").log_path).toBeNull();
    s.sendText("t6", "pwd");
    s.sendKeys("t6", ["enter"]);
    expect(s.screen("t6").split("\n").slice(-3)).toEqual(["demo@demo:~/projects/webapp$ pwd", "/home/demo/projects/webapp", "demo@demo:~/projects/webapp$ "]);
    s.stop();
  });

  it("keeps the folder of a new tab, so a new shell has its folder", () => {
    const s = make();
    const { root_pane } = s.createWorkspace("/home/demo/projects/api-server");
    expect(s.snapshot().panes.find((p) => p.pane_id === root_pane.pane_id)?.cwd).toBe("/home/demo/projects/api-server");
    s.stop();
  });

  it("the working Claude agent has a running subagent with its own log", () => {
    const s = make();
    const sub = s.items("t1").find((i) => i.kind === "subagent");
    expect(sub).toMatchObject({ kind: "subagent", status: "running" });
    const page = s.subagentPage(s.resolve("t1").log_path!, (sub as { agent_id: string }).agent_id, undefined, 40);
    expect(page.running).toBe(true);
    expect(page.items.length).toBeGreaterThan(0);
    s.stop();
  });

  it("does nothing while paused", () => {
    const s = new DemoScenario();
    const before = s.items("t1").length;
    jest.advanceTimersByTime(60_000);
    expect(s.items("t1").length).toBe(before);
    expect(s.agentStatus("t1")).toBe("working");
    s.stop();
  });
});

describe("DemoScenario scripts", () => {
  it("the working agent advances, its subagent finishes, then it is done", () => {
    const notices: DemoNotice[] = [];
    const s = make(notices);
    const start = s.items("t1").length;
    const events: string[] = [];
    s.onHerdrEvent((e) => events.push(`${e.event}:${String(e.data?.pane_id)}:${String(e.data?.agent_status)}`));
    jest.advanceTimersByTime(5_000);
    expect(s.items("t1").length).toBeGreaterThan(start);
    jest.advanceTimersByTime(60_000);
    expect(s.agentStatus("t1")).toBe("done");
    expect(s.items("t1").find((i) => i.kind === "subagent")).toMatchObject({ status: "completed" });
    expect(lastAssistant(s.items("t1"))).toMatchObject({ kind: "assistant" });
    expect(events).toContain("pane_agent_status_changed:t1:done");
    expect(notices.map((n) => n.kind)).toEqual(expect.arrayContaining(["needs_you", "finished"]));
    expect(notices.find((n) => n.kind === "needs_you")?.paneId).toBe("t2");
    s.stop();
  });

  it("needs you → answer Yes → working → done", () => {
    const s = make();
    const choices = parseChoices(s.screen("t2"));
    expect(choices.map((c) => c.key)).toEqual(["1", "2", "3"]);
    expect(choices[0]).toMatchObject({ label: "Yes", selected: true });
    expect(s.previews().find((p) => p.pane_id === "t2")?.question).toMatch(/pnpm add zod/);

    s.sendKeys("t2", ["1"]);
    expect(s.agentStatus("t2")).toBe("working");
    expect(parseChoices(s.screen("t2"))).toEqual([]);
    expect(s.previews().find((p) => p.pane_id === "t2")?.activity).toBeTruthy();
    jest.advanceTimersByTime(30_000);
    expect(s.agentStatus("t2")).toBe("done");
    const toolItem = s.items("t2").find((i) => i.kind === "tool" && i.input_summary === "pnpm add zod");
    expect(toolItem).toMatchObject({ result: { ok: true } });
    expect(lastAssistant(s.items("t2"))).toMatchObject({ markdown: expect.stringMatching(/zod schema/) });
    s.stop();
  });

  it("needs you → answer No → done without the install", () => {
    const s = make();
    s.sendKeys("t2", ["3"]);
    jest.advanceTimersByTime(10_000);
    expect(s.agentStatus("t2")).toBe("done");
    const toolItem = s.items("t2").find((i) => i.kind === "tool" && i.input_summary === "pnpm add zod");
    expect(toolItem).toMatchObject({ result: { ok: false } });
    s.stop();
  });

  it("send → user item → working → streamed reply → done", () => {
    const s = make();
    const follow: ThreadItem[][] = [];
    s.follow(s.resolve("t4").log_path!, (d) => {
      if ("items" in d) follow.push(d.items);
    });
    s.prompt("t4", "Add tests for the logout route");
    // The user item comes a little later than the send, as in a real log.
    expect(s.items("t4").some((i) => i.kind === "user" && i.text === "Add tests for the logout route")).toBe(false);
    jest.advanceTimersByTime(700);
    expect(s.items("t4").some((i) => i.kind === "user" && i.text === "Add tests for the logout route")).toBe(true);
    expect(s.agentStatus("t4")).toBe("working");
    jest.advanceTimersByTime(20_000);
    expect(s.agentStatus("t4")).toBe("done");
    const reply = lastAssistant(s.items("t4"));
    expect(reply).toMatchObject({ markdown: expect.stringMatching(/tests/) });
    // The reply streamed: the same item id arrived more than once, longer each time.
    const parts = follow.flat().filter((i) => i.id === reply!.id);
    expect(parts.length).toBeGreaterThan(1);
    s.stop();
  });

  it("typing in the terminal and Enter sends a prompt", () => {
    const s = make();
    s.sendText("t5", "hello");
    expect(s.screen("t5")).toContain("> hello");
    s.sendKeys("t5", ["Enter"]);
    jest.advanceTimersByTime(700);
    expect(s.items("t5").some((i) => i.kind === "user" && i.text === "hello")).toBe(true);
    s.stop();
  });

  it("new session: workspace, agent, prompt", () => {
    const s = make();
    const created = s.createWorkspace("/home/demo/projects/docs-site", "docs-site");
    const paneId = created.root_pane.pane_id;
    s.startAgent(paneId, "codex", "docs-site-p6");
    expect(s.snapshot().agents.find((a) => a.pane_id === paneId)).toMatchObject({ agent: "codex", agent_status: "idle" });
    s.prompt(paneId, "Fix the broken links");
    jest.advanceTimersByTime(20_000);
    expect(s.agentStatus(paneId)).toBe("done");
    s.closeWorkspace(created.workspace.workspace_id);
    expect(s.snapshot().agents.some((a) => a.pane_id === paneId)).toBe(false);
    s.stop();
  });

  it("stop ends all timers", () => {
    const s = make();
    s.prompt("t4", "x");
    s.stop();
    expect(jest.getTimerCount()).toBe(0);
  });
});
