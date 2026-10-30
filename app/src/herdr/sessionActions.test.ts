import { RpcError } from "@/rpc/RpcClient";

import { closeAgent, openResumedSession, renameAgent, restartAgent, resumeSession } from "./sessionActions";
import type { AgentInfo } from "./snapshot";

function fakeRpc(fail?: string, failWith?: Error) {
  const calls: { method: string; params: any }[] = [];
  return {
    calls,
    call: async (_m: string, p: any) => {
      calls.push({ method: p.method, params: p.params });
      if (p.method === fail) throw failWith ?? new Error(`${fail} failed`);
      if (p.method === "tab.create") return { tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p2" } };
      return {};
    },
  } as any;
}

const agent = (over: Partial<AgentInfo> = {}): AgentInfo => ({
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  agent: "codex",
  agent_status: "idle",
  cwd: "/home/sam/proj",
  state_change_seq: 1,
  ...over,
});

describe("sessionActions", () => {
  it("restart_starts_then_closes_old", async () => {
    const rpc = fakeRpc();
    await expect(restartAgent(rpc, agent())).resolves.toEqual({ paneId: "w1:p2" });
    expect(rpc.calls.map((c: any) => c.method)).toEqual(["tab.create", "agent.start", "pane.close"]);
    expect(rpc.calls[0].params).toEqual({ workspace_id: "w1", cwd: "/home/sam/proj", focus: false });
    expect(rpc.calls[1].params).toMatchObject({ kind: "codex", pane_id: "w1:p2" });
    expect(rpc.calls[2].params).toEqual({ pane_id: "w1:p1" });
  });

  it("restart_keeps_old_when_start_fails", async () => {
    const rpc = fakeRpc("agent.start");
    await expect(restartAgent(rpc, agent())).rejects.toThrow("agent.start failed");
    expect(rpc.calls.some((c: any) => c.method === "pane.close")).toBe(false);
  });

  it("restart_reports_failed_close", async () => {
    const rpc = fakeRpc("pane.close");
    await expect(restartAgent(rpc, agent())).resolves.toEqual({ paneId: "w1:p2", closeError: "pane.close failed" });
    expect(rpc.calls.map((c: any) => c.method)).toEqual(["tab.create", "agent.start", "pane.close"]);
  });

  it("restart_needs_a_cwd", async () => {
    const rpc = fakeRpc();
    await expect(restartAgent(rpc, agent({ cwd: undefined }))).rejects.toMatchObject({ code: "no_cwd" });
    expect(rpc.calls).toEqual([]);
  });

  it("resume_uses_resume_args", async () => {
    const rpc = fakeRpc();
    await expect(resumeSession(rpc, agent({ agent: "claude" }), "abc")).resolves.toEqual({ paneId: "w1:p2" });
    expect(rpc.calls.map((c: any) => c.method)).toEqual(["tab.create", "agent.start"]);
    expect(rpc.calls[1].params).toMatchObject({ kind: "claude", pane_id: "w1:p2", args: ["--resume", "abc"] });
  });

  it("rename_validates", async () => {
    const rpc = fakeRpc();
    await expect(renameAgent(rpc, "w1:p1", "My Agent")).rejects.toMatchObject({ code: "bad_name" });
    expect(rpc.calls).toEqual([]);
    await renameAgent(rpc, "w1:p1", "reviewer-2");
    expect(rpc.calls).toEqual([{ method: "agent.rename", params: { target: "w1:p1", name: "reviewer-2" } }]);
  });

  it("rename_maps_launch_pending", async () => {
    const rpc = fakeRpc("agent.rename", new RpcError("agent_launch_pending", "agent name cannot change while startup is pending"));
    await expect(renameAgent(rpc, "w1:p1", "reviewer")).rejects.toMatchObject({
      code: "agent_launch_pending",
      message: "Still starting — try again in a few seconds.",
    });
  });

  it("close_sends_pane_close", async () => {
    const rpc = fakeRpc();
    await closeAgent(rpc, "w1:p1");
    expect(rpc.calls).toEqual([{ method: "pane.close", params: { pane_id: "w1:p1" } }]);
  });
});

it("open_resumed_session_closes_the_modal_then_replaces_the_old_session", () => {
  const order: string[] = [];
  const router = { dismiss: jest.fn(() => order.push("dismiss")), replace: jest.fn((h: never) => order.push(`replace ${h}`)) };
  openResumedSession(router, "h_1", "w1:p9");
  expect(order).toEqual(["dismiss", "replace /session/h_1/w1:p9"]);
});
