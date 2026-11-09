import { agentName, startSession, startShell } from "./startSession";

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
    // Longer than the companion's own 40 s limit, so its error wins the race.
    expect(rpc.calls[1].timeoutMs).toBe(45_000);
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

  it("starts_in_the_root_pane_of_a_fresh_workspace", async () => {
    const rpc = fakeRpc();
    const progress: string[] = [];
    const r = await startSession(rpc, {
      cwd: "/home/sam/proj/.worktrees/fix",
      kind: "claude",
      fresh: { workspaceId: "w7", paneId: "w7:p1" },
      onProgress: (l) => progress.push(l),
    });
    expect(r).toEqual({ paneId: "w7:p1" });
    // No second workspace and no new tab.
    expect(rpc.calls.map((c: any) => c.method)).toEqual(["agent.start"]);
    expect(rpc.calls[0].params).toEqual({ name: "fix-w7-p1", kind: "claude", pane_id: "w7:p1" });
    expect(progress).toEqual(["Starting claude…"]);
  });

  it("closes_the_fresh_workspace_when_agent_start_fails", async () => {
    const calls: { method: string; params: any }[] = [];
    const rpc = {
      call: async (_m: string, p: any) => {
        calls.push(p);
        if (p.method === "agent.start") throw new Error("boom");
        return {};
      },
    } as any;
    await expect(startSession(rpc, { cwd: "/a/b", kind: "claude", fresh: { workspaceId: "w7", paneId: "w7:p1" } })).rejects.toThrow("boom");
    expect(calls.at(-1)).toEqual({ method: "workspace.close", params: { workspace_id: "w7" } });
  });

  it("start_passes_args", async () => {
    const rpc = fakeRpc();
    await startSession(rpc, { cwd: "/home/sam/proj", kind: "claude", workspaceId: "w9", args: ["--resume", "abc"] });
    expect(rpc.calls[1].params).toEqual({ name: "proj-w1-p1", kind: "claude", pane_id: "w1:p1", args: ["--resume", "abc"] });
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

  it("returns_prompt_error_instead_of_throwing_once_the_agent_runs", async () => {
    const calls: string[] = [];
    const rpc = {
      call: async (_m: string, p: any) => {
        calls.push(p.method);
        if (p.method === "workspace.create") return { workspace: { workspace_id: "w7" }, root_pane: { pane_id: "w7:p1" } };
        if (p.method === "agent.prompt") throw new Error("agent_blocked");
        return {};
      },
    } as any;
    await expect(startSession(rpc, { cwd: "/a/proj", kind: "claude", prompt: "hi" })).resolves.toEqual({
      paneId: "w7:p1",
      promptError: "agent_blocked",
    });
    // The running agent and its workspace stay.
    expect(calls).not.toContain("workspace.close");
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

describe("startShell", () => {
  /** A herdr whose fresh shell takes `busy` polls of `pane.process_info` to reach the foreground. */
  function shellRpc(busy = 0, opts: { noProcessInfo?: boolean; sendFails?: boolean } = {}) {
    const calls: { method: string; params: any }[] = [];
    let polls = 0;
    return {
      calls,
      call: async (_m: string, p: any) => {
        calls.push(p);
        if (p.method === "workspace.create" || p.method === "tab.create") return { root_pane: { pane_id: "w1:p1" } };
        if (p.method === "pane.process_info") {
          if (opts.noProcessInfo) throw Object.assign(new Error("unknown variant"), { code: "invalid_request" });
          return polls++ < busy
            ? { process_info: { shell_pid: null } }
            : { process_info: { shell_pid: 41, foreground_process_group_id: 41 } };
        }
        if (p.method === "pane.send_input" && opts.sendFails) throw Object.assign(new Error("pane_not_found"), { code: "pane_not_found" });
        return { type: "ok" };
      },
    } as any;
  }

  it("creates_a_workspace_and_starts_no_agent", async () => {
    const rpc = shellRpc();
    const progress: string[] = [];
    await expect(startShell(rpc, { cwd: "/home/sam/proj", onProgress: (l) => progress.push(l) })).resolves.toEqual({ paneId: "w1:p1" });
    expect(rpc.calls.map((c: any) => c.method)).toEqual(["workspace.create"]);
    expect(rpc.calls[0].params).toEqual({ cwd: "/home/sam/proj", label: "proj", focus: false });
    expect(progress).toEqual(["Creating workspace…"]);
  });

  it("uses_the_root_pane_of_a_fresh_workspace", async () => {
    const rpc = shellRpc();
    await expect(startShell(rpc, { cwd: "/home/sam/proj", fresh: { workspaceId: "w7", paneId: "w7:p1" } })).resolves.toEqual({ paneId: "w7:p1" });
    expect(rpc.calls).toEqual([]);
  });

  it("adds_a_tab_to_an_existing_workspace", async () => {
    const rpc = shellRpc();
    await startShell(rpc, { cwd: "/home/sam/proj", workspaceId: "w9", command: "  " });
    expect(rpc.calls.map((c: any) => c.method)).toEqual(["tab.create"]);
    expect(rpc.calls[0].params).toEqual({ workspace_id: "w9", cwd: "/home/sam/proj", focus: false });
  });

  it("waits_for_the_shell_then_types_the_command_and_enter", async () => {
    jest.useFakeTimers();
    const rpc = shellRpc(2);
    const done = startShell(rpc, { cwd: "/home/sam/proj", command: " npm test \n" });
    await jest.advanceTimersByTimeAsync(2000);
    await expect(done).resolves.toEqual({ paneId: "w1:p1" });
    const methods = rpc.calls.map((c: any) => c.method);
    expect(methods).toEqual(["workspace.create", "pane.process_info", "pane.process_info", "pane.process_info", "pane.send_input"]);
    expect(rpc.calls.at(-1).params).toEqual({ pane_id: "w1:p1", text: "npm test", keys: ["enter"] });
    jest.useRealTimers();
  });

  it("sends_the_command_when_herdr_has_no_process_info", async () => {
    const rpc = shellRpc(0, { noProcessInfo: true });
    await expect(startShell(rpc, { cwd: "/a/b", command: "ls" })).resolves.toEqual({ paneId: "w1:p1" });
    expect(rpc.calls.at(-1)).toEqual({ method: "pane.send_input", params: { pane_id: "w1:p1", text: "ls", keys: ["enter"] } });
  });

  it("returns_command_error_and_keeps_the_pane", async () => {
    const rpc = shellRpc(0, { sendFails: true });
    await expect(startShell(rpc, { cwd: "/a/b", command: "ls" })).resolves.toEqual({ paneId: "w1:p1", commandError: "pane_not_found" });
    expect(rpc.calls.map((c: any) => c.method)).not.toContain("workspace.close");
  });

  it("fails_when_no_pane_returned", async () => {
    await expect(startShell({ call: async () => ({}) } as any, { cwd: "/a" })).rejects.toThrow("pane");
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
