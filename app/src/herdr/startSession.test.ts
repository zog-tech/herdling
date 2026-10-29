import { agentName, startSession } from "./startSession";

function fakeRpc() {
  const calls: { method: string; params: any; timeoutMs?: number }[] = [];
  return {
    calls,
    call: async (_m: string, params: any, timeoutMs?: number) => {
      calls.push({ method: params.method, params: params.params, timeoutMs });
      if (params.method === "workspace.create" || params.method === "tab.create")
        return { root_pane: { pane_id: "w1:p1" } };
      return { type: "ok" };
    },
  } as any;
}

describe("startSession", () => {
  it("creates_workspace_then_starts_agent_then_prompts", async () => {
    const rpc = fakeRpc();
    const progress: string[] = [];
    const r = await startSession(rpc, { cwd: "/home/sam/proj", kind: "claude", prompt: "hi", onProgress: (l) => progress.push(l) });
    expect(r).toEqual({ paneId: "w1:p1" });
    expect(rpc.calls.map((c: any) => c.method)).toEqual(["workspace.create", "agent.start", "agent.prompt"]);
    expect(rpc.calls[0].params).toEqual({ cwd: "/home/sam/proj", label: "proj", focus: false });
    expect(rpc.calls[1].params).toEqual({ name: "proj-w1-p1", kind: "claude", pane_id: "w1:p1" });
    expect(rpc.calls[1].timeoutMs).toBeGreaterThan(30_000);
    expect(rpc.calls[2].params).toEqual({ target: "w1:p1", text: "hi" });
    expect(progress).toEqual(["Creating workspace…", "Starting claude…", "Sending prompt…"]);
  });

  it("uses_existing_workspace_with_tab_create", async () => {
    const rpc = fakeRpc();
    await startSession(rpc, { cwd: "/home/sam/proj/", kind: "codex", workspaceId: "w9" });
    expect(rpc.calls.map((c: any) => c.method)).toEqual(["tab.create", "agent.start"]);
    expect(rpc.calls[0].params).toEqual({ workspace_id: "w9", cwd: "/home/sam/proj/", focus: false });
    expect(rpc.calls[1].params).toEqual({ name: "proj-w1-p1", kind: "codex", pane_id: "w1:p1" });
  });

  it("skips_prompt_when_empty", async () => {
    const rpc = fakeRpc();
    await startSession(rpc, { cwd: "/home/sam/proj", kind: "claude", prompt: "  \n" });
    expect(rpc.calls.map((c: any) => c.method)).toEqual(["workspace.create", "agent.start"]);
  });

  it("fails_when_no_pane_returned", async () => {
    const rpc = { call: async () => ({}) } as any;
    await expect(startSession(rpc, { cwd: "/a", kind: "claude" })).rejects.toThrow("pane");
  });

  it("retries_agent_start_until_the_pane_is_a_shell", async () => {
    jest.useFakeTimers();
    let n = 0;
    const calls: string[] = [];
    const rpc = {
      call: async (_m: string, p: any) => {
        calls.push(p.method);
        if (p.method === "workspace.create") return { root_pane: { pane_id: "w1:p1" } };
        if (p.method === "agent.start" && n++ < 2) throw new Error("agent target pane w1:p1 is not an available shell");
        return {};
      },
    } as any;
    const done = startSession(rpc, { cwd: "/a/b", kind: "claude" });
    await jest.advanceTimersByTimeAsync(2000);
    await expect(done).resolves.toEqual({ paneId: "w1:p1" });
    expect(calls.filter((c) => c === "agent.start")).toHaveLength(3);
    jest.useRealTimers();
  });

  it("closes_the_new_workspace_when_agent_start_fails", async () => {
    const calls: { method: string; params: any }[] = [];
    const rpc = {
      call: async (_m: string, p: any) => {
        calls.push(p);
        if (p.method === "workspace.create") return { workspace: { workspace_id: "w7" }, root_pane: { pane_id: "w7:p1" } };
        if (p.method === "agent.start") throw new Error("boom");
        return {};
      },
    } as any;
    await expect(startSession(rpc, { cwd: "/a/b", kind: "claude" })).rejects.toThrow("boom");
    expect(calls.at(-1)).toEqual({ method: "workspace.close", params: { workspace_id: "w7" } });
  });

  it("retries_the_prompt_until_the_agent_is_ready", async () => {
    jest.useFakeTimers();
    let n = 0;
    const rpc = {
      call: async (_m: string, p: any) => {
        if (p.method === "workspace.create") return { root_pane: { pane_id: "w1:p1" } };
        if (p.method === "agent.prompt" && n++ < 3) throw new Error("agent proj is not an active named agent");
        return {};
      },
    } as any;
    const done = startSession(rpc, { cwd: "/a/proj", kind: "claude", prompt: "hi" });
    await jest.advanceTimersByTimeAsync(3000);
    await expect(done).resolves.toEqual({ paneId: "w1:p1" });
    expect(n).toBe(4);
    jest.useRealTimers();
  });

  it("same_basename_gets_distinct_names_and_prompts_by_pane_id", async () => {
    const starts: any[] = [];
    const prompts: any[] = [];
    let n = 0;
    const rpc = {
      call: async (_m: string, p: any) => {
        if (p.method === "workspace.create" || p.method === "tab.create") return { root_pane: { pane_id: `w1:p${++n}` } };
        if (p.method === "agent.start") starts.push(p.params);
        if (p.method === "agent.prompt") prompts.push(p.params);
        return {};
      },
    } as any;
    await startSession(rpc, { cwd: "/a/proj", kind: "claude", prompt: "one" });
    await startSession(rpc, { cwd: "/b/proj", kind: "claude", prompt: "two", workspaceId: "w1" });
    expect(starts[0].name).not.toBe(starts[1].name);
    expect(prompts.map((p) => p.target)).toEqual(["w1:p1", "w1:p2"]);
  });
});

describe("agentName", () => {
  it("produces names herdr accepts", () => {
    for (const cwd of ["/a/My App.v2", "/a/9lives", "/a/" + "x".repeat(60), "/"]) {
      const name = agentName(cwd, "w1A:p12");
      expect(name).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
      expect(name.endsWith("-w1a-p12")).toBe(true);
    }
  });
});
