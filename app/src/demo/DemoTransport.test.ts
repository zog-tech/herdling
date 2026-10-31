import type {
  AgentsInstalled,
  FsDirs,
  AgentPreview,
  Automation,
  AutomationRun,
  Boot,
  CommandList,
  FilePut,
  GitDiff,
  GitStatus,
  GitWorktree,
  Hello,
  MacOpenSettings,
  PaneAnswer,
  PortsList,
  PreviewClose,
  PreviewOpen,
  RecentSession,
  Stats,
  SubagentPage,
  ThreadItem,
  ThreadPage,
  ThreadRef,
  UpdateApply,
  UpdateCheck,
  Usage,
} from "@herdling/protocol";

import { parseDiff } from "@/changes/diff";
import { parseSnapshot, type HerdrEvent } from "@/herdr/snapshot";
import { APP_METHODS } from "@/hosts/methods";
import { RpcClient } from "@/rpc/RpcClient";
import type { FollowData } from "@/thread/followShared";

import { DEMO_METHODS, DemoTransport } from "./DemoTransport";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

let transport: DemoTransport;
let rpc: RpcClient;

beforeEach(() => {
  transport = new DemoTransport();
  rpc = new RpcClient(transport);
});
afterEach(() => rpc.close());

/** Calls a method and lets the transport's small reply delay pass. */
async function call<T>(method: string, params?: object): Promise<T> {
  const p = rpc.call<T>(method, params);
  await jest.advanceTimersByTimeAsync(100);
  return p;
}

async function callError(method: string, params?: object): Promise<{ code: string }> {
  const p = rpc.call(method, params).then(
    () => ({ code: "no error" }),
    (e: { code: string }) => e,
  );
  await jest.advanceTimersByTimeAsync(100);
  return p;
}

async function stream(method: string, params: object): Promise<() => void> {
  const p = rpc.stream(method, params, () => {});
  await jest.advanceTimersByTimeAsync(100);
  return p;
}

const herdr = <T>(method: string, params: object = {}) => call<T>("herdr.call", { method, params });

function isItem(i: ThreadItem): boolean {
  return typeof i.id === "string" && typeof i.ts === "number" && ["user", "assistant", "thinking", "tool", "subagent", "system"].includes(i.kind);
}

describe("DemoTransport", () => {
  it("hello advertises every method, kind list and herdr", async () => {
    const h = await call<Hello>("hello");
    expect(h).toMatchObject({ herdr_ok: true, os: "macos" });
    expect(h.methods).toEqual([...APP_METHODS]);
    expect(h.thread_kinds).toEqual(["claude", "codex", "pi", "opencode", "omp", "gemini"]);
    expect(h.command_kinds).toEqual(["claude", "codex", "pi", "opencode"]);
    expect(h.boot).toEqual({ starts_at: "boot", how: expect.any(String), reason: "auto_login_on" });
  });

  it("answers every advertised method with a valid shape (or a proper error)", async () => {
    const answered = new Set<string>();
    const ok = <T>(m: string) => (v: T) => {
      answered.add(m);
      return v;
    };

    expect(await call("ping").then(ok("ping"))).toEqual({});

    const snap = parseSnapshot(await herdr("session.snapshot").then(ok("herdr.call")));
    expect(snap.agents.length).toBeGreaterThanOrEqual(4);
    for (const a of snap.agents) expect(typeof a.state_change_seq).toBe("number");

    const ref = await call<ThreadRef>("thread.resolve", { pane_id: "p1" }).then(ok("thread.resolve"));
    expect(ref).toMatchObject({ kind: "claude", log_path: expect.any(String), session: expect.any(String) });

    const page = await call<ThreadPage>("thread.get", { log_path: ref.log_path, limit: 3 }).then(ok("thread.get"));
    expect(page.items).toHaveLength(3);
    expect(page.items.every(isItem)).toBe(true);
    expect(typeof page.end).toBe("number");
    expect(page.cursor).not.toBeNull();
    const older = await call<ThreadPage>("thread.get", { log_path: ref.log_path, before: page.cursor, limit: 40 });
    expect(older.cursor).toBeNull();

    const sub = (await call<ThreadPage>("thread.get", { log_path: ref.log_path, limit: 40 })).items.find((i) => i.kind === "subagent")!;
    const subPage = await call<SubagentPage>("thread.subagent", { log_path: ref.log_path, agent_id: (sub as { agent_id: string }).agent_id }).then(
      ok("thread.subagent"),
    );
    expect(subPage).toMatchObject({ log_path: expect.any(String), running: true });

    const unfollow = await stream("thread.follow", { log_path: ref.log_path, from: page.end }).then(ok("thread.follow"));
    unfollow();
    const unsub = await stream("herdr.subscribe", {}).then(ok("herdr.subscribe"));
    unsub();
    const unwatch = await stream("pane.watch", { pane_id: "p1", format: "ansi" }).then(ok("pane.watch"));
    unwatch();
    await jest.advanceTimersByTimeAsync(100);
    answered.add("rpc.cancel");

    const recent = await call<RecentSession[]>("sessions.recent", { cwd: "/home/demo/projects/webapp", kind: "claude", limit: 2 }).then(
      ok("sessions.recent"),
    );
    expect(recent).toHaveLength(2);
    for (const r of recent) expect(r).toEqual({ session: expect.any(String), first_prompt: expect.any(String), last_activity: expect.any(Number), cwd: expect.any(String) });

    // The demo is always up to date, so the app never offers an update for it.
    const check = await call<UpdateCheck>("update.check", {}).then(ok("update.check"));
    expect(check).toMatchObject({ update_available: false });
    expect(check.latest).toBe(check.current);
    expect(await call<UpdateApply>("update.apply", {}).then(ok("update.apply"))).toMatchObject({ status: "up_to_date" });

    const dirs = await call<{ path: string; dirs: string[]; recent_cwds: string[] }>("fs.dirs", {}).then(ok("fs.dirs"));
    expect(dirs.dirs).toContain("projects");
    expect((await call<{ dirs: string[] }>("fs.dirs", { path: `${dirs.path}/projects` })).dirs).toContain("webapp");
    // New session: git marks, hidden folders on request, and `not_found` for a wrong path.
    const projects = await call<FsDirs>("fs.dirs", { path: "~/projects", recent: false }).then(ok("fs.dirs"));
    expect(projects.git_dirs).toContain("webapp");
    expect(projects.recent_cwds).toEqual([]);
    expect(dirs.dirs).not.toContain(".config");
    expect((await call<FsDirs>("fs.dirs", { path: dirs.path, hidden: true })).dirs).toContain(".config");
    expect(await callError("fs.dirs", { path: "~/no-such-folder" })).toMatchObject({ code: "not_found" });

    const agents = await call<AgentsInstalled>("agents.installed").then(ok("agents.installed"));
    expect(agents.installed).toContain("claude");
    expect(agents.missing).not.toContain("claude");

    // A wrong label sends nothing (the full flow is in its own test, because it ends the p2 question).
    expect(await callError("pane.answer", { pane_id: "p2", key: "3", expect_label: "No" })).toMatchObject({ code: "stale" });
    answered.add("pane.answer");

    expect(await call("push.register", {}).then(ok("push.register"))).toEqual({});
    expect(await call("pair.revoke", {}).then(ok("pair.revoke"))).toEqual({});

    const stats = await call<Stats>("stats.get").then(ok("stats.get"));
    expect(stats.cpu_pct).toBeGreaterThan(0);
    expect(stats.mem_used).toBeLessThan(stats.mem_total);
    expect(stats.load).toHaveLength(3);

    const usage = await call<Usage>("usage.get").then(ok("usage.get"));
    expect(usage.providers.map((p) => p.provider)).toEqual(["claude", "codex"]);
    for (const p of usage.providers) for (const w of p.windows) expect(w.used_pct).toBeGreaterThanOrEqual(0);

    const { automations } = await call<{ automations: Automation[] }>("automations.list").then(ok("automations.list"));
    const pending = automations.find((a) => a.pending_approval)!;
    expect(pending.content_hash).toBeTruthy();
    const { runs } = await call<{ runs: AutomationRun[] }>("automations.runs", { limit: 20 }).then(ok("automations.runs"));
    expect(runs.length).toBeGreaterThan(0);
    await call("automations.approve", { id: pending.id, content_hash: pending.content_hash }).then(ok("automations.approve"));
    const after = await call<{ automations: Automation[] }>("automations.list");
    expect(after.automations.find((a) => a.id === pending.id)).toMatchObject({ pending_approval: false, enabled: true });

    const { previews } = await call<{ previews: AgentPreview[] }>("agents.preview").then(ok("agents.preview"));
    expect(previews.find((p) => p.pane_id === "p2")?.question).toBeTruthy();
    expect(previews.find((p) => p.pane_id === "p1")?.activity).toBeTruthy();

    for (const kind of [undefined, "codex", "pi", "opencode"]) {
      const list = await call<CommandList>("commands.list", { pane_id: "p1", ...(kind ? { kind } : {}) }).then(ok("commands.list"));
      expect(list.commands.length).toBeGreaterThan(0);
    }

    const put = await call<FilePut>("files.put", { name: "screen shot.png", data_b64: "AAAA" }).then(ok("files.put"));
    expect(put.path).toMatch(/^~\/\.cache\/herdling\/uploads\/.*screen_shot\.png$/);

    const status = await call<GitStatus>("git.status", { pane_id: "p1" }).then(ok("git.status"));
    expect(status).toMatchObject({ is_repo: true, branch: expect.any(String) });
    expect(status.files.length).toBeGreaterThan(2);
    const changed = status.files.find((f) => f.status === "M" && !f.binary)!;
    const diff = await call<GitDiff>("git.diff", { cwd: status.root, path: changed.path }).then(ok("git.diff"));
    const parsed = parseDiff(diff.diff);
    expect(parsed).toHaveLength(1);
    // The list and the diff agree on the counts.
    expect([parsed[0].added, parsed[0].deleted]).toEqual([changed.added, changed.deleted]);
    expect(parseDiff((await call<GitDiff>("git.diff", { cwd: status.root })).diff).length).toBe(status.files.length);
    expect((await call<GitStatus>("git.status", { cwd: "/home/demo/notes" })).is_repo).toBe(false);
    const wt = await call<GitWorktree>("git.worktree_add", { cwd: status.root, branch: "herdling/demo1" }).then(ok("git.worktree_add"));
    expect(wt.path).toBe(`${status.root}/.worktrees/herdling-demo1`);
    expect(await callError("git.worktree_add", { cwd: status.root, branch: "herdling/demo1" })).toMatchObject({ code: "already_exists" });
    expect(await callError("git.worktree_add", { cwd: status.root, branch: "bad name" })).toMatchObject({ code: "bad_request" });
    expect((await call<GitStatus>("git.status", { cwd: wt.path })).files).toEqual([]);

    // Host voice and summary are not there: a clear error, so the app uses the phone.
    for (const m of ["summary.make", "tts.make", "stt.make"]) {
      expect(await callError(m, { text: "hi" })).toMatchObject({ code: "not_installed" });
      answered.add(m);
    }
    // The demo Mac starts herdlingd at boot; it opens only an allow-listed settings page.
    const boot = await call<Boot>("boot.check").then(ok("boot.check"));
    expect(boot).toMatchObject({ starts_at: "boot", how: expect.any(String) });
    expect(await call<MacOpenSettings>("mac.open_settings", { pane: "users_groups" }).then(ok("mac.open_settings"))).toEqual({
      opened: "users_groups",
    });
    expect(await callError("mac.open_settings", { pane: "https://example.com" })).toMatchObject({ code: "bad_request" });
    answered.add("hello");

    // The browser preview: the pane's dev server first, a grant for a listed port only.
    const ports = await call<PortsList>("ports.list", { pane_id: "p1" }).then(ok("ports.list"));
    expect(ports.ports[0]).toMatchObject({ port: 5173, cmd: "vite", pane_id: "p1" });
    const open = await call<PreviewOpen>("preview.open", { port: 5173 }).then(ok("preview.open"));
    expect(open.grant).toMatch(/^[0-9a-f]{32}$/);
    expect(await callError("preview.open", { port: 4444 })).toMatchObject({ code: "port_not_listening" });
    expect(await callError("preview.open", { port: "5173" })).toMatchObject({ code: "bad_request" });
    expect(await call<PreviewClose>("preview.close", { grant: open.grant }).then(ok("preview.close"))).toEqual({ closed: true });
    expect(await callError("preview.close", { grant: "../x" })).toMatchObject({ code: "grant_invalid" });

    expect([...answered].sort()).toEqual([...DEMO_METHODS].sort());
  });

  it("pane.answer checks the menu like herdlingd, then answers", async () => {
    // The blocked Codex agent (p2) asks Yes / … / No. A changed label or a wrong key sends nothing.
    expect(await callError("pane.answer", { pane_id: "p2", key: "3", expect_label: "No" })).toMatchObject({ code: "stale" });
    expect(await callError("pane.answer", { pane_id: "p1", key: "1", expect_label: "Yes" })).toMatchObject({ code: "stale" });
    expect(await callError("pane.answer", { pane_id: "p2", key: "x", expect_label: "Yes" })).toMatchObject({ code: "bad_request" });
    expect(await callError("pane.answer", { pane_id: "nope", key: "1", expect_label: "Yes" })).toMatchObject({ code: "stale" });
    expect(await call<PaneAnswer>("pane.answer", { pane_id: "p2", key: "1", expect_label: "Yes" })).toEqual({
      answered: true,
    });
    // Answered: the menu is gone, so the same answer again is stale.
    expect(await callError("pane.answer", { pane_id: "p2", key: "1", expect_label: "Yes" })).toMatchObject({ code: "stale" });
  });

  it("pane.watch sends the screen at once, then only new screens", async () => {
    const events: { text?: string; error?: string }[] = [];
    const p = rpc.stream<{ text?: string }>("pane.watch", { pane_id: "p1", format: "text" }, (d) => events.push(d));
    await jest.advanceTimersByTimeAsync(100);
    const off = await p;
    expect(events).toHaveLength(1);
    expect(events[0].text).toContain("Claude");
    // Typed text shows in the agent's input box.
    await herdr("pane.send_input", { pane_id: "p1", text: "Add tests" });
    await jest.advanceTimersByTimeAsync(400);
    expect(events.length).toBeGreaterThan(1);
    expect(events.at(-1)?.text).toContain("Add tests");
    const n = events.length;
    off();
    await jest.advanceTimersByTimeAsync(5000);
    expect(events).toHaveLength(n);
    expect(await callError("pane.watch", { pane_id: "nope" })).toMatchObject({ code: "not_found" });
  });

  it("answers herdr methods used by the app", async () => {
    const read = await herdr<{ read: { text: string } }>("pane.read", { pane_id: "p2", source: "visible", format: "text" });
    expect(read.read.text).toContain("1. Yes");
    const ansi = await herdr<{ read: { text: string } }>("pane.read", { pane_id: "p1", source: "recent", format: "ansi", lines: 200 });
    expect(ansi.read.text).toContain("\x1b[");

    const created = await herdr<{ workspace: { workspace_id: string }; tab: { tab_id: string }; root_pane: { pane_id: string } }>("workspace.create", {
      cwd: "/home/demo/projects/docs-site",
      label: "docs-site",
      focus: false,
    });
    expect(await herdr("workspace.get", { workspace_id: created.workspace.workspace_id })).toBeTruthy();
    await herdr("agent.start", { name: "docs-site-p6", kind: "pi", pane_id: created.root_pane.pane_id });
    await herdr("agent.prompt", { target: created.root_pane.pane_id, text: "Fix the links" });
    await herdr("agent.rename", { target: created.root_pane.pane_id, name: "links" });
    await herdr("tab.rename", { tab_id: created.tab.tab_id, label: "links" });
    await herdr("workspace.rename", { workspace_id: created.workspace.workspace_id, label: "docs" });
    const tab = await herdr<{ root_pane: { pane_id: string } }>("tab.create", { workspace_id: created.workspace.workspace_id, cwd: "/home/demo" });
    await herdr("pane.send_text", { pane_id: tab.root_pane.pane_id, text: "ls" });
    await herdr("pane.send_keys", { pane_id: tab.root_pane.pane_id, keys: ["Enter"] });
    await herdr("pane.close", { pane_id: tab.root_pane.pane_id });
    await herdr("tab.close", { tab_id: created.tab.tab_id });
    expect(await callError("herdr.call", { method: "workspace.get", params: { workspace_id: created.workspace.workspace_id } })).toMatchObject({
      code: "not_found",
    });
  });

  it("unknown methods return an error and never hang", async () => {
    expect(await callError("nope.nothing")).toMatchObject({ code: "unknown_method" });
    expect(await callError("herdr.call", { method: "nope.nothing", params: {} })).toMatchObject({ code: "unknown_method" });
    expect(await callError("thread.get", {})).toMatchObject({ code: "bad_request" });
    expect(await callError("thread.get", { log_path: "demo://missing" })).toMatchObject({ code: "not_found" });
  });

  it("a bad JSON line gets an error with id null", async () => {
    const lines: string[] = [];
    transport.onLine((l) => lines.push(l));
    transport.send("{not json");
    await jest.advanceTimersByTimeAsync(100);
    expect(JSON.parse(lines[0])).toEqual({ id: null, error: { code: "bad_request", message: "invalid JSON" } });
  });

  it("streams herdr events and thread items; rpc.cancel stops them", async () => {
    const events: HerdrEvent[] = [];
    const items: ThreadItem[] = [];
    const unsub = await (async () => {
      const p = rpc.stream<HerdrEvent>("herdr.subscribe", {}, (e) => events.push(e));
      await jest.advanceTimersByTimeAsync(100);
      return p;
    })();
    const ref = await call<ThreadRef>("thread.resolve", { pane_id: "p2" });
    const page = await call<ThreadPage>("thread.get", { log_path: ref.log_path, limit: 40 });
    const p = rpc.stream<FollowData>("thread.follow", { log_path: ref.log_path, from: page.end }, (d) => {
      if ("items" in d) items.push(...d.items);
    });
    await jest.advanceTimersByTimeAsync(100);
    await p;

    // Answer the permission menu: status event, then streamed thread items.
    await herdr("pane.send_keys", { pane_id: "p2", keys: ["1"] });
    expect(events).toContainEqual({ event: "pane_agent_status_changed", data: { pane_id: "p2", agent_status: "working" } });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(events).toContainEqual({ event: "pane_agent_status_changed", data: { pane_id: "p2", agent_status: "done" } });
    expect(items.some((i) => i.kind === "assistant")).toBe(true);

    unsub();
    await jest.advanceTimersByTimeAsync(100);
    const count = events.length;
    await herdr("agent.prompt", { target: "p3", text: "again" });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(events.length).toBe(count);
  });

  it("pauses the scenario while inactive and stops all timers on close", async () => {
    transport.setActive(false);
    const before = (await call<ThreadPage>("thread.get", { log_path: (await call<ThreadRef>("thread.resolve", { pane_id: "p1" })).log_path, limit: 99 }))
      .items.length;
    await jest.advanceTimersByTimeAsync(60_000);
    const ref = await call<ThreadRef>("thread.resolve", { pane_id: "p1" });
    expect((await call<ThreadPage>("thread.get", { log_path: ref.log_path, limit: 99 })).items.length).toBe(before);
    transport.setActive(true);
    await jest.advanceTimersByTimeAsync(10_000);
    expect((await call<ThreadPage>("thread.get", { log_path: ref.log_path, limit: 99 })).items.length).toBeGreaterThan(before);

    const closed = jest.fn();
    transport.onClose(closed);
    rpc.close();
    expect(closed).toHaveBeenCalledWith("closed");
    expect(transport.isClosed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(() => transport.send("{}")).toThrow();
  });
});
