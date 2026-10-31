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
  it("has 5 agents in 2 workspaces with mixed kinds and states", () => {
    const s = make();
    const snap = s.snapshot();
    expect(snap.workspaces).toHaveLength(2);
    expect(snap.agents).toHaveLength(5);
    expect(new Set(snap.agents.map((a) => a.agent))).toEqual(new Set(["claude", "codex", "pi", "opencode"]));
    const status = Object.fromEntries(snap.agents.map((a) => [a.pane_id, a.agent_status]));
    expect(status).toEqual({ p1: "working", p2: "blocked", p3: "done", p4: "idle", p5: "idle" });
    // Idle agents have seq 0, so they never show as unread "Ready".
    expect(snap.agents.find((a) => a.pane_id === "p4")!.state_change_seq).toBe(0);
    expect(snap.agents.find((a) => a.pane_id === "p3")!.state_change_seq).toBeGreaterThan(0);
    s.stop();
  });

  it("the working Claude agent has a running subagent with its own log", () => {
    const s = make();
    const sub = s.items("p1").find((i) => i.kind === "subagent");
    expect(sub).toMatchObject({ kind: "subagent", status: "running" });
    const page = s.subagentPage(s.resolve("p1").log_path!, (sub as { agent_id: string }).agent_id, undefined, 40);
    expect(page.running).toBe(true);
    expect(page.items.length).toBeGreaterThan(0);
    s.stop();
  });

  it("does nothing while paused", () => {
    const s = new DemoScenario();
    const before = s.items("p1").length;
    jest.advanceTimersByTime(60_000);
    expect(s.items("p1").length).toBe(before);
    expect(s.agentStatus("p1")).toBe("working");
    s.stop();
  });
});

describe("DemoScenario scripts", () => {
  it("the working agent advances, its subagent finishes, then it is done", () => {
    const notices: DemoNotice[] = [];
    const s = make(notices);
    const start = s.items("p1").length;
    const events: string[] = [];
    s.onHerdrEvent((e) => events.push(`${e.event}:${String(e.data?.pane_id)}:${String(e.data?.agent_status)}`));
    jest.advanceTimersByTime(5_000);
    expect(s.items("p1").length).toBeGreaterThan(start);
    jest.advanceTimersByTime(60_000);
    expect(s.agentStatus("p1")).toBe("done");
    expect(s.items("p1").find((i) => i.kind === "subagent")).toMatchObject({ status: "completed" });
    expect(lastAssistant(s.items("p1"))).toMatchObject({ kind: "assistant" });
    expect(events).toContain("pane_agent_status_changed:p1:done");
    expect(notices.map((n) => n.kind)).toEqual(expect.arrayContaining(["needs_you", "finished"]));
    expect(notices.find((n) => n.kind === "needs_you")?.paneId).toBe("p2");
    s.stop();
  });

  it("needs you → answer Yes → working → done", () => {
    const s = make();
    const choices = parseChoices(s.screen("p2"));
    expect(choices.map((c) => c.key)).toEqual(["1", "2", "3"]);
    expect(choices[0]).toMatchObject({ label: "Yes", selected: true });
    expect(s.previews().find((p) => p.pane_id === "p2")?.question).toMatch(/pnpm add zod/);

    s.sendKeys("p2", ["1"]);
    expect(s.agentStatus("p2")).toBe("working");
    expect(parseChoices(s.screen("p2"))).toEqual([]);
    expect(s.previews().find((p) => p.pane_id === "p2")?.activity).toBeTruthy();
    jest.advanceTimersByTime(30_000);
    expect(s.agentStatus("p2")).toBe("done");
    const toolItem = s.items("p2").find((i) => i.kind === "tool" && i.input_summary === "pnpm add zod");
    expect(toolItem).toMatchObject({ result: { ok: true } });
    expect(lastAssistant(s.items("p2"))).toMatchObject({ markdown: expect.stringMatching(/zod schema/) });
    s.stop();
  });

  it("needs you → answer No → done without the install", () => {
    const s = make();
    s.sendKeys("p2", ["3"]);
    jest.advanceTimersByTime(10_000);
    expect(s.agentStatus("p2")).toBe("done");
    const toolItem = s.items("p2").find((i) => i.kind === "tool" && i.input_summary === "pnpm add zod");
    expect(toolItem).toMatchObject({ result: { ok: false } });
    s.stop();
  });

  it("send → user item → working → streamed reply → done", () => {
    const s = make();
    const follow: ThreadItem[][] = [];
    s.follow(s.resolve("p4").log_path!, (d) => {
      if ("items" in d) follow.push(d.items);
    });
    s.prompt("p4", "Add tests for the logout route");
    // The user item comes a little later than the send, as in a real log.
    expect(s.items("p4").some((i) => i.kind === "user" && i.text === "Add tests for the logout route")).toBe(false);
    jest.advanceTimersByTime(700);
    expect(s.items("p4").some((i) => i.kind === "user" && i.text === "Add tests for the logout route")).toBe(true);
    expect(s.agentStatus("p4")).toBe("working");
    jest.advanceTimersByTime(20_000);
    expect(s.agentStatus("p4")).toBe("done");
    const reply = lastAssistant(s.items("p4"));
    expect(reply).toMatchObject({ markdown: expect.stringMatching(/tests/) });
    // The reply streamed: the same item id arrived more than once, longer each time.
    const parts = follow.flat().filter((i) => i.id === reply!.id);
    expect(parts.length).toBeGreaterThan(1);
    s.stop();
  });

  it("typing in the terminal and Enter sends a prompt", () => {
    const s = make();
    s.sendText("p5", "hello");
    expect(s.screen("p5")).toContain("> hello");
    s.sendKeys("p5", ["Enter"]);
    jest.advanceTimersByTime(700);
    expect(s.items("p5").some((i) => i.kind === "user" && i.text === "hello")).toBe(true);
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
    s.prompt("p4", "x");
    s.stop();
    expect(jest.getTimerCount()).toBe(0);
  });
});
