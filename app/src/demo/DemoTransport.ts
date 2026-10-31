import type {
  Automation,
  AutomationRun,
  CommandInfo,
  CommandList,
  FilePut,
  Hello,
  Stats,
  UpdateApply,
  UpdateCheck,
  Usage,
} from "@herdling/protocol";

import { APP_METHODS } from "@/hosts/methods";
import type { LineTransport } from "@/rpc/transport";

import { demoGitDiff, demoGitStatus, demoWorktreeAdd } from "./demoGit";
import { DEMO_HOST_NAME } from "./demoHost";
import { CHAT_KINDS, DemoError, DemoScenario, type DemoNotice } from "./scenario";

/** Kinds with chat and command support, as a current herdlingd reports them. */
const KINDS = CHAT_KINDS;

/** Every method the demo answers. It is the same list as a current herdlingd (`METHODS` in `companion/src/rpc.rs`). */
export const DEMO_METHODS: readonly string[] = APP_METHODS;

/** A short delay for each answer, so the app sees the order of a real connection (never a sync reply). */
const LATENCY_MS = 40;
const GIB = 1024 ** 3;

type Params = Record<string, unknown>;

const str = (p: Params, k: string): string | undefined => (typeof p[k] === "string" ? (p[k] as string) : undefined);
const num = (p: Params, k: string): number | undefined => (typeof p[k] === "number" ? (p[k] as number) : undefined);
function need(p: Params, k: string, method: string): string {
  const v = str(p, k);
  if (v === undefined) throw new DemoError("bad_request", `${method} requires ${k}`);
  return v;
}

const COMMANDS: Record<string, CommandInfo[]> = {
  claude: [
    { name: "clear", description: "Clear the conversation", source: "builtin" },
    { name: "compact", description: "Compact the conversation", source: "builtin" },
    { name: "review", description: "Review the current changes", source: "builtin" },
    { name: "test-all", description: "Run every test suite", source: "project" },
  ],
  codex: [
    { name: "init", description: "Make an AGENTS.md file", source: "builtin" },
    { name: "review", description: "Review the current changes", source: "builtin" },
    { name: "lint-fix", trigger: "$", description: "Fix lint errors", source: "user" },
  ],
  pi: [
    { name: "model", description: "Change the model", source: "builtin" },
    { name: "session", description: "Show the session", source: "builtin" },
  ],
  opencode: [
    { name: "init", description: "Make an AGENTS.md file", source: "builtin" },
    { name: "docs", trigger: "@", description: "Write docs for a file", source: "project" },
  ],
};

/**
 * `LineTransport` for the demo host: answers the JSON-RPC lines of the app in process, with
 * the data of a `DemoScenario`. No network, no SSH. An unknown method gets an `unknown_method` error.
 * Streams (`herdr.subscribe`, `thread.follow`) send events until `rpc.cancel` or `close()`.
 */
export class DemoTransport implements LineTransport {
  readonly scenario: DemoScenario;
  private closed = false;
  private readonly lineCbs = new Set<(line: string) => void>();
  private readonly closeCbs = new Set<(reason: string) => void>();
  private readonly streams = new Map<string, () => void>();
  private nextStream = 1;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private automations: Automation[] = makeAutomations();
  private readonly runs: AutomationRun[] = makeRuns();
  private cpu = 18;

  constructor(opts?: { scenario?: DemoScenario; onNotice?: (n: DemoNotice) => void; active?: boolean }) {
    this.scenario = opts?.scenario ?? new DemoScenario({ onNotice: opts?.onNotice });
    if (opts?.active !== false) this.scenario.resume();
  }

  /** The app came to the foreground (true) or left it (false). The scripts stop while in the background. */
  setActive(active: boolean): void {
    if (this.closed) return;
    if (active) this.scenario.resume();
    else this.scenario.pause();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send(line: string): void {
    if (this.closed) throw new Error("channel closed");
    let req: { id?: unknown; method?: unknown; params?: unknown };
    try {
      req = JSON.parse(line);
    } catch {
      this.later(() => this.write({ id: null, error: { code: "bad_request", message: "invalid JSON" } }));
      return;
    }
    const id = typeof req.id === "number" ? req.id : null;
    const method = typeof req.method === "string" ? req.method : "";
    const params = (req.params && typeof req.params === "object" ? req.params : {}) as Params;
    this.later(() => {
      try {
        const result = this.dispatch(method, params);
        this.write({ id, result });
        if (result && typeof result === "object" && "stream" in result) this.startStream(method, params, (result as { stream: string }).stream);
      } catch (e) {
        const code = e instanceof DemoError ? e.code : "internal";
        this.write({ id, error: { code, message: e instanceof Error ? e.message : String(e) } });
      }
    });
  }

  onLine(cb: (line: string) => void): () => void {
    this.lineCbs.add(cb);
    return () => this.lineCbs.delete(cb);
  }

  onClose(cb: (reason: string) => void): () => void {
    this.closeCbs.add(cb);
    if (this.closed) queueMicrotask(() => this.closeCbs.has(cb) && cb("closed"));
    return () => this.closeCbs.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.streams.forEach((off) => off());
    this.streams.clear();
    this.scenario.stop();
    this.closeCbs.forEach((cb) => cb("closed"));
  }

  private later(fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.closed) fn();
    }, LATENCY_MS);
    this.timers.add(t);
  }

  private write(msg: object): void {
    if (this.closed) return;
    const line = JSON.stringify(msg);
    this.lineCbs.forEach((cb) => cb(line));
  }

  private event(stream: string, data: unknown): void {
    if (this.streams.has(stream)) this.write({ method: "event", params: { stream, data } });
  }

  private startStream(method: string, params: Params, id: string): void {
    // A placeholder first, so an event sent while the stream starts is not dropped.
    this.streams.set(id, () => {});
    const off =
      method === "herdr.subscribe"
        ? this.scenario.onHerdrEvent((e) => this.event(id, e))
        : this.scenario.follow(str(params, "log_path") ?? "", (d) => this.event(id, d));
    if (this.streams.has(id)) this.streams.set(id, off);
    else off();
  }

  private newStream(): { stream: string } {
    return { stream: `demo-stream-${this.nextStream++}` };
  }

  private dispatch(method: string, p: Params): unknown {
    const s = this.scenario;
    switch (method) {
      case "hello":
        return {
          host: DEMO_HOST_NAME,
          os: "macos",
          herdlingd: "demo",
          herdr_ok: true,
          herdr_version: "demo",
          herdr_protocol: 1,
          methods: [...DEMO_METHODS],
          // A current herdlingd also reads omp and Gemini CLI logs. The demo has no such agent.
          thread_kinds: [...KINDS, "omp", "gemini"],
          command_kinds: KINDS,
        } satisfies Hello;
      case "ping":
        return {};
      // The demo herdlingd is always up to date: it never offers an update.
      case "update.check":
        return { current: "demo", latest: "demo", update_available: false, notes: "", target: "demo" } satisfies UpdateCheck;
      case "update.apply":
        return { from: "demo", to: "demo", status: "up_to_date", service_restarted: false } satisfies UpdateApply;
      case "rpc.cancel": {
        const id = need(p, "stream", method);
        this.streams.get(id)?.();
        this.streams.delete(id);
        return {};
      }
      case "herdr.call":
        return this.herdr(need(p, "method", method), (p.params && typeof p.params === "object" ? p.params : {}) as Params);
      case "herdr.subscribe":
        return this.newStream();
      case "thread.resolve":
        return s.resolve(need(p, "pane_id", method));
      case "thread.get":
        return s.page(need(p, "log_path", method), num(p, "before"), num(p, "limit") ?? 40);
      case "thread.subagent":
        return s.subagentPage(need(p, "log_path", method), need(p, "agent_id", method), num(p, "before"), num(p, "limit") ?? 40);
      case "thread.follow":
        need(p, "log_path", method);
        return this.newStream();
      case "sessions.recent":
        return s.recentSessions(str(p, "cwd"), str(p, "kind"), num(p, "limit") ?? 20);
      case "fs.dirs":
        return s.dirs(str(p, "path"));
      case "push.register":
      case "pair.revoke":
        // Never sent for the demo host; accept it anyway, and send nothing anywhere.
        return {};
      case "stats.get":
        return this.stats();
      case "usage.get":
        return usage();
      case "automations.list":
        return { automations: this.automations };
      case "automations.runs":
        return { runs: this.runs.slice(0, num(p, "limit") ?? 20) };
      case "automations.approve": {
        const id = need(p, "id", method);
        const a = this.automations.find((x) => x.id === id);
        if (!a) throw new DemoError("not_found", `automation ${id} not found`);
        this.automations = this.automations.map((x) => (x.id === id ? { ...x, pending_approval: false, enabled: true } : x));
        return { ok: true };
      }
      case "agents.preview":
        return { previews: s.previews() };
      case "commands.list": {
        const kind = str(p, "kind") ?? "claude";
        return { commands: [...(COMMANDS[kind] ?? [])].sort((a, b) => a.name.localeCompare(b.name)) } satisfies CommandList;
      }
      case "files.put": {
        const name = (str(p, "name") ?? "upload").replace(/[^\w.-]+/g, "_");
        return { path: `~/.cache/herdling/uploads/${Date.now()}-${name}` } satisfies FilePut;
      }
      case "git.status":
        return demoGitStatus(this.gitCwd(p, method));
      case "git.diff":
        return demoGitDiff(this.gitCwd(p, method), str(p, "path"));
      case "git.worktree_add":
        return demoWorktreeAdd(this.gitCwd(p, method), need(p, "branch", method));
      case "summary.make":
        throw new DemoError("not_installed", "The demo computer has no summary command. The phone summary is used.");
      case "tts.make":
        throw new DemoError("not_installed", "The demo computer has no voice command. The phone voice is used.");
      case "stt.make":
        throw new DemoError("not_installed", "The demo computer has no speech-to-text command. The phone recognizer is used.");
      default:
        throw new DemoError("unknown_method", `unknown method: ${method}`);
    }
  }

  /** The folder of a git call: `cwd`, else the folder of the agent in `pane_id`. */
  private gitCwd(p: Params, method: string): string | null {
    const cwd = str(p, "cwd");
    if (cwd) return cwd;
    return this.scenario.resolve(need(p, "pane_id", method)).cwd;
  }

  /** The herdr methods the app calls, through `herdr.call`. */
  private herdr(method: string, p: Params): unknown {
    const s = this.scenario;
    const m = `herdr ${method}`;
    switch (method) {
      case "session.snapshot":
        return { snapshot: s.snapshot() };
      case "pane.read":
        return { read: { text: s.screen(need(p, "pane_id", m), str(p, "format") === "ansi" ? "ansi" : "text") } };
      case "pane.send_keys": {
        const keys = Array.isArray(p.keys) ? p.keys.filter((k): k is string => typeof k === "string") : [];
        s.sendKeys(need(p, "pane_id", m), keys);
        return {};
      }
      case "pane.send_text":
        s.sendText(need(p, "pane_id", m), need(p, "text", m));
        return {};
      case "agent.prompt":
        s.prompt(need(p, "target", m), need(p, "text", m));
        return {};
      case "agent.start": {
        const args = Array.isArray(p.args) ? p.args.filter((a): a is string => typeof a === "string") : undefined;
        return { agent: s.startAgent(need(p, "pane_id", m), str(p, "kind") ?? "claude", str(p, "name"), args) };
      }
      case "agent.rename":
        s.rename("agent", need(p, "target", m), str(p, "name") ?? null);
        return {};
      case "tab.rename":
        s.rename("tab", need(p, "tab_id", m), need(p, "label", m));
        return {};
      case "workspace.rename":
        s.rename("workspace", need(p, "workspace_id", m), need(p, "label", m));
        return {};
      case "workspace.create":
        return s.createWorkspace(str(p, "cwd") ?? "/home/demo", str(p, "label"));
      case "tab.create":
        return s.createTab(need(p, "workspace_id", m), str(p, "cwd"));
      case "workspace.get":
        return { workspace: s.workspaceExists(need(p, "workspace_id", m)) };
      case "pane.close":
        s.closePane(need(p, "pane_id", m));
        return {};
      case "tab.close":
        s.closeTab(need(p, "tab_id", m));
        return {};
      case "workspace.close":
        s.closeWorkspace(need(p, "workspace_id", m));
        return {};
      default:
        throw new DemoError("unknown_method", `unknown method: ${method}`);
    }
  }

  /** Host load with a small random walk, so the meters move a little. */
  private stats(): Stats {
    this.cpu = Math.min(48, Math.max(8, this.cpu + (Math.random() - 0.5) * 8));
    const cpu = Math.round(this.cpu);
    const load = Math.round(cpu * 8) / 100;
    return {
      cpu_pct: cpu,
      mem_used: Math.round((9.6 + cpu / 40) * GIB),
      mem_total: 16 * GIB,
      load: [load, Math.round(load * 90) / 100, Math.round(load * 80) / 100],
      uptime_s: 6 * 86400 + 4 * 3600,
    };
  }
}

function usage(): Usage {
  const now = Math.floor(Date.now() / 1000);
  return {
    providers: [
      {
        provider: "claude",
        status: "ok",
        windows: [
          { label: "5-hour", used_pct: 34, resets_at: now + 2 * 3600 + 12 * 60 },
          { label: "Weekly", used_pct: 58, resets_at: now + 3 * 86400 },
        ],
      },
      {
        provider: "codex",
        status: "ok",
        windows: [
          { label: "5-hour", used_pct: 12, resets_at: now + 4 * 3600 },
          { label: "Weekly", used_pct: 27, resets_at: now + 5 * 86400 },
        ],
      },
    ],
  };
}

function makeAutomations(): Automation[] {
  return [
    { id: "auto-deps", name: "Nightly dependency check", schedule: "Every day at 02:00", enabled: true, pending_approval: false },
    { id: "auto-report", name: "Weekly test report", schedule: "Mondays at 09:00", enabled: true, pending_approval: false },
    {
      id: "auto-branches",
      name: "Clean up merged branches",
      schedule: "Sundays at 20:00",
      enabled: false,
      pending_approval: true,
      plan: "List the local branches that are merged into main, then delete them. Never delete main or the current branch.",
      caps: ["shell: git branch", "shell: git branch -d"],
      content_hash: "demo-hash-1",
    },
  ];
}

function makeRuns(): AutomationRun[] {
  const now = Math.floor(Date.now() / 1000);
  const h = 3600;
  return [
    { id: "run-5", automation_id: "auto-deps", started_at: now - 9 * h, finished_at: now - 9 * h + 74, status: "ok", summary: "All packages are up to date." },
    { id: "run-4", automation_id: "auto-report", started_at: now - 2 * 86400, finished_at: now - 2 * 86400 + 210, status: "ok", summary: "212 tests, all pass." },
    { id: "run-3", automation_id: "auto-deps", started_at: now - 33 * h, finished_at: now - 33 * h + 40, status: "failed", summary: "The registry did not answer. The next run tries again." },
    { id: "run-2", automation_id: "auto-branches", started_at: now - 3 * 86400, finished_at: null, status: "pending_approval", summary: "Waits for your approval." },
  ];
}
