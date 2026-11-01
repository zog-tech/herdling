import type {
  AgentBackground,
  AgentPreview,
  AgentStatus,
  FsDirs,
  RecentSession,
  SubagentPage,
  ThreadItem,
  ThreadPage,
  ThreadRef,
} from "@herdling/protocol";

import type { AgentInfo, HerdrEvent, PaneInfo, Snapshot, TabInfo, WorkspaceInfo } from "@/herdr/snapshot";
import { baseName } from "@/newSession/paths";
import type { FollowData } from "@/thread/followShared";

import { PausableClock } from "./clock";

/** A local notice the scenario asks for: an agent needs you, or an agent finished. */
/** `choices`: the option labels of the menu on a "needs you" notice, for the Yes and No buttons. */
export type DemoNotice = { kind: "needs_you" | "finished"; paneId: string; title: string; body: string; choices?: string[] };

/** An error with an RPC error code (the transport sends it as `{code, message}`). */
export class DemoError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DemoError";
  }
}

type Question = { prompt: string; choices: string[]; onAnswer: (index: number) => void };
type Step = { delay: number; run: () => void };

type Agent = {
  info: AgentInfo;
  log: string;
  session: string;
  items: ThreadItem[];
  /** While working: the latest step, such as "Editing LoginForm.tsx". */
  activity?: string;
  /** While blocked: the permission menu. */
  question?: Question;
  /** Background work that still runs after the turn ended. */
  background?: AgentBackground;
  /** Wall time (ms) when the current status began. */
  since: number;
  /** Text typed in the terminal view, sent on Enter. */
  input: string;
  queue: Step[];
  /** True while a step of `queue` waits for its timer. */
  waiting: boolean;
};

type Subagent = { log: string; parentPane: string; agentId: string; items: ThreadItem[]; running: boolean };

const HOME = "/home/demo";
const WEBAPP = `${HOME}/projects/webapp`;
const API = `${HOME}/projects/api-server`;

/** Folder tree for `fs.dirs`. A folder not in the map has no subfolders. */
const DIRS: Record<string, string[]> = {
  ["/"]: ["home", "opt", "tmp"],
  ["/home"]: ["demo"],
  [HOME]: [".cache", ".config", "Documents", "notes", "projects", "scratch"],
  [`${HOME}/projects`]: ["api-server", "design-system", "docs-site", "infra", "mobile-app", "webapp"],
  [WEBAPP]: [".github", "public", "src", "tests"],
  [`${WEBAPP}/src`]: ["components", "hooks", "pages", "styles"],
  [API]: ["docs", "migrations", "src", "tests"],
  [`${HOME}/projects/docs-site`]: ["content", "theme"],
  [`${HOME}/projects/mobile-app`]: ["android", "ios", "src"],
  [`${HOME}/.config`]: ["herdling", "nvim"],
};

/** Folders of the demo that are git repos. */
const GIT_REPOS = new Set([WEBAPP, API, `${HOME}/projects/docs-site`, `${HOME}/projects/mobile-app`, `${HOME}/projects/design-system`]);

/** Recent agent folders, newest first, as herdlingd reads them from the agent logs. */
const RECENT_CWDS = [WEBAPP, API, `${HOME}/projects/docs-site`, `${HOME}/projects/mobile-app`];

/** Earlier sessions per folder for `sessions.recent`: first prompt and age in hours. */
const PAST_SESSIONS: Record<string, [string, number][]> = {
  [WEBAPP]: [
    ["Add a loading state to the dashboard", 3],
    ["Fix the flaky date test", 26],
    ["Move the API client to its own file", 96],
  ],
  [API]: [
    ["Add rate limits to the login route", 5],
    ["Write a migration for the audit table", 50],
  ],
  [`${HOME}/projects/docs-site`]: [["Fix the broken links in the guide", 30]],
  [`${HOME}/projects/mobile-app`]: [["Make the settings screen work with large text", 72]],
};

/** Agent kinds with a chat thread, as a current herdlingd reports them (`thread_kinds`). */
export const CHAT_KINDS = ["claude", "codex", "pi", "opencode"];

const KIND_LABEL: Record<string, string> = { claude: "Claude", codex: "Codex", pi: "Pi", opencode: "OpenCode" };
const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** One line of plain text from markdown, for previews and the terminal. */
const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The living demo: herdr workspaces, tabs, panes and agents, their threads, terminal screens and
 * scripted steps. All state is in memory and starts again for each new scenario. Steps run on a
 * `PausableClock`, so nothing runs while the app is in the background, and `stop()` ends all of them.
 */
export class DemoScenario {
  readonly clock = new PausableClock();
  private agents = new Map<string, Agent>();
  private workspaces: WorkspaceInfo[] = [];
  private tabs: TabInfo[] = [];
  private panes: PaneInfo[] = [];
  private subagents = new Map<string, Subagent>();
  private herdrListeners = new Set<(e: HerdrEvent) => void>();
  private followers = new Map<string, Set<(d: FollowData) => void>>();
  private nextId = 1;
  private nextWs = 3;
  private nextTab = 6;
  private nextPane = 6;
  /** `state_change_seq` grows from the launch time, so an agent that finished is "Ready" again after a relaunch. */
  private seq: number;
  private stopped = false;
  private readonly onNotice?: (n: DemoNotice) => void;
  private readonly startedAt = Date.now();

  constructor(opts?: { onNotice?: (n: DemoNotice) => void; autoplay?: boolean }) {
    this.onNotice = opts?.onNotice;
    this.seq = Math.floor(Date.now() / 1000);
    this.seed();
    if (opts?.autoplay !== false) this.play();
  }

  // ---------- lifecycle ----------

  /** Starts the clock (the first time, also the scripts of the working agents). */
  resume(): void {
    this.clock.resume();
  }

  pause(): void {
    this.clock.pause();
  }

  stop(): void {
    this.stopped = true;
    this.clock.stop();
    this.herdrListeners.clear();
    this.followers.clear();
  }

  // ---------- reads ----------

  snapshot(): Snapshot {
    const agents = [...this.agents.values()].map((a) => ({ ...a.info }));
    const statusOf = (list: AgentInfo[]): AgentStatus => {
      for (const s of ["blocked", "working", "done", "idle"] as const) if (list.some((a) => a.agent_status === s)) return s;
      return "unknown";
    };
    return {
      agents,
      workspaces: this.workspaces.map((w) => ({
        ...w,
        agent_status: statusOf(agents.filter((a) => a.workspace_id === w.workspace_id)),
        tab_count: this.tabs.filter((t) => t.workspace_id === w.workspace_id).length,
      })),
      tabs: this.tabs.map((t) => ({ ...t, agent_status: statusOf(agents.filter((a) => a.tab_id === t.tab_id)) })),
      panes: this.panes.map((p) => ({ ...p })),
    };
  }

  agentStatus(paneId: string): AgentStatus | undefined {
    return this.agents.get(paneId)?.info.agent_status;
  }

  /** Thread items of an agent (exposed for tests). */
  items(paneId: string): ThreadItem[] {
    return this.agents.get(paneId)?.items ?? [];
  }

  workspaceExists(id: string): WorkspaceInfo {
    const ws = this.workspaces.find((w) => w.workspace_id === id);
    if (!ws) throw new DemoError("not_found", `workspace ${id} not found`);
    return ws;
  }

  resolve(paneId: string): ThreadRef {
    const a = this.agents.get(paneId);
    if (!a) {
      if (this.panes.some((p) => p.pane_id === paneId)) return { kind: "shell", session: null, log_path: null, cwd: null };
      throw new DemoError("not_found", `pane ${paneId} not found`);
    }
    // As herdlingd: only the kinds with chat support have a thread log; the app shows the terminal for the rest.
    if (!CHAT_KINDS.includes(a.info.agent)) return { kind: a.info.agent, session: null, log_path: null, cwd: a.info.cwd ?? null };
    return { kind: a.info.agent, session: a.session, log_path: a.log, cwd: a.info.cwd ?? null };
  }

  /** `thread.get`: the cursor is an item index; `end` is the item count. */
  page(logPath: string, before: number | undefined, limit: number): ThreadPage {
    const items = this.logItems(logPath);
    const end = before === undefined ? items.length : Math.min(Math.max(0, before), items.length);
    const start = Math.max(0, end - Math.max(1, limit));
    return { items: items.slice(start, end), cursor: start > 0 ? start : null, end: items.length };
  }

  subagentPage(parentLog: string, agentId: string, before: number | undefined, limit: number): SubagentPage {
    const sub = [...this.subagents.values()].find((s) => s.agentId === agentId && this.agentByLog(parentLog)?.info.pane_id === s.parentPane);
    if (!sub) throw new DemoError("not_found", `subagent ${agentId} not found`);
    return { ...this.page(sub.log, before, limit), log_path: sub.log, running: sub.running };
  }

  /** Follows a thread log. A log that does not exist sends `{error}` at once. */
  follow(logPath: string, cb: (d: FollowData) => void): () => void {
    if (!this.hasLog(logPath)) {
      cb({ error: "not found" });
      return () => {};
    }
    let set = this.followers.get(logPath);
    if (!set) this.followers.set(logPath, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  onHerdrEvent(cb: (e: HerdrEvent) => void): () => void {
    this.herdrListeners.add(cb);
    return () => this.herdrListeners.delete(cb);
  }

  previews(): AgentPreview[] {
    return [...this.agents.values()].map((a) => {
      const last = [...a.items].reverse().find((i) => i.kind === "assistant");
      const p: AgentPreview = {
        pane_id: a.info.pane_id,
        status_since: Math.floor(a.since / 1000),
        source: "log",
      };
      if (a.info.agent_status === "working") p.activity = a.activity ?? "Thinking";
      if (a.question) p.question = a.question.prompt;
      if (last && last.kind === "assistant") p.last_reply = short(plain(last.markdown), 140);
      if (a.background) p.background = a.background;
      return p;
    });
  }

  recentSessions(cwd: string | undefined, kind: string | undefined, limit: number): RecentSession[] {
    const now = Date.now();
    const base = (cwd ?? WEBAPP).replace(/\/+$/, "") || "/";
    const k = kind ?? "claude";
    // Each kind has its own history: a later kind in the list has its sessions a little older.
    const shift = Math.max(0, CHAT_KINDS.indexOf(k)) * 2;
    return (PAST_SESSIONS[base] ?? [])
      .map(([first_prompt, hours], i) => ({
        session: `${k}-${baseName(base)}-${i + 1}`,
        first_prompt,
        last_activity: now - (hours + shift) * 3600_000,
        cwd: base,
      }))
      .slice(0, Math.max(0, limit));
  }

  /**
   * `fs.dirs`: the demo folder tree. A path that is not in the tree gives `not_found`, as on a
   * real computer. Hidden folders show only with `hidden`.
   */
  dirs(path: string | undefined, o?: { hidden?: boolean; recent?: boolean }): FsDirs {
    const p = (path ?? HOME).replace(/^~(?=\/|$)/, HOME).replace(/\/+$/, "") || "/";
    const parent = p.replace(/\/[^/]+$/, "") || "/";
    const known = p in DIRS || (DIRS[parent] ?? []).includes(baseName(p));
    if (!known) throw new DemoError("not_found", `No such file or directory: ${p}`);
    const hidden = o?.hidden === true;
    const dirs = (DIRS[p] ?? []).filter((d) => hidden || !d.startsWith("."));
    return {
      path: p,
      dirs,
      git_dirs: dirs.filter((d) => GIT_REPOS.has(`${p === "/" ? "" : p}/${d}`)),
      hidden,
      recent_cwds: o?.recent === false ? [] : RECENT_CWDS,
    };
  }

  /** `pane.read`: a plausible terminal screen. `ansi` adds a few SGR colors. */
  screen(paneId: string, format: "text" | "ansi" = "text"): string {
    const a = this.agents.get(paneId);
    const c = (code: string, s: string) => (format === "ansi" ? `\x1b[${code}m${s}\x1b[0m` : s);
    if (!a) {
      if (!this.panes.some((p) => p.pane_id === paneId)) throw new DemoError("not_found", `pane ${paneId} not found`);
      return `${c("32", "demo@demo")}:${c("34", "~")}$ `;
    }
    const lines: string[] = [];
    const cwd = (a.info.cwd ?? HOME).replace(HOME, "~");
    lines.push(c("1", ` ${kindLabel(a.info.agent)}`) + c("2", ` · ${cwd}`), "");
    for (const item of a.items.slice(-14)) {
      switch (item.kind) {
        case "user":
          lines.push(c("1", `> ${short(item.text, 70)}`), "");
          break;
        case "assistant":
          for (const l of wrap(plain(item.markdown), 66).slice(0, 4)) lines.push(`● ${l}`);
          lines.push("");
          break;
        case "thinking":
          lines.push(c("2;3", `✻ ${short(item.text ?? "Thinking", 66)}`));
          break;
        case "tool":
          lines.push(`● ${item.name}(${short(item.input_summary, 50)})`);
          lines.push(c("2", `  ⎿  ${item.result ? short(item.result.text.split("\n")[0], 60) : "Running…"}`));
          break;
        case "subagent":
          lines.push(`● Task(${short(item.description, 50)})`);
          lines.push(c("2", `  ⎿  ${item.status === "running" ? (item.activity ?? "Running…") : "Done"}`));
          break;
        case "system":
          lines.push(c("2", `  ${item.text}`));
          break;
      }
    }
    if (a.question) {
      const width = 58;
      const row = (s: string) => `│ ${s.padEnd(width - 4)} │`;
      lines.push("", `╭${"─".repeat(width - 2)}╮`, row(short(a.question.prompt, width - 4)), row(""));
      a.question.choices.forEach((ch, i) => lines.push(row(`${i === 0 ? "❯" : " "} ${i + 1}. ${short(ch, width - 10)}`)));
      lines.push(`╰${"─".repeat(width - 2)}╯`);
      return lines.join("\n");
    }
    if (a.info.agent_status === "working") lines.push(c("33", `✻ ${a.activity ?? "Thinking"}… (esc to interrupt)`));
    lines.push(`╭${"─".repeat(56)}╮`, `│ > ${a.input.padEnd(52)} │`, `╰${"─".repeat(56)}╯`);
    return lines.join("\n");
  }

  // ---------- herdr writes ----------

  createWorkspace(cwd: string, label?: string): { workspace: WorkspaceInfo; tab: TabInfo; root_pane: PaneInfo } {
    const ws: WorkspaceInfo = {
      workspace_id: `w${this.nextWs++}`,
      label: label || cwd.split("/").filter(Boolean).pop() || "workspace",
      number: this.workspaces.length + 1,
      agent_status: "unknown",
    };
    this.workspaces.push(ws);
    this.emit({ event: "workspace_created", data: { workspace: ws } });
    const { tab, root_pane } = this.createTab(ws.workspace_id, cwd);
    return { workspace: ws, tab, root_pane };
  }

  createTab(workspaceId: string, _cwd?: string): { tab: TabInfo; root_pane: PaneInfo } {
    this.workspaceExists(workspaceId);
    const number = this.tabs.filter((t) => t.workspace_id === workspaceId).length + 1;
    const tab: TabInfo = { tab_id: `t${this.nextTab++}`, workspace_id: workspaceId, label: `tab ${number}`, number, agent_status: "unknown" };
    const pane: PaneInfo = { pane_id: `p${this.nextPane++}`, tab_id: tab.tab_id, workspace_id: workspaceId, label: null };
    this.tabs.push(tab);
    this.panes.push(pane);
    this.emit({ event: "tab_created", data: { tab } });
    return { tab, root_pane: pane };
  }

  /** `agent.start`: a new agent in an empty pane. With `args` (a resume), it gets an earlier thread. */
  startAgent(paneId: string, kind: string, name: string | undefined, args?: string[], cwd?: string): AgentInfo {
    const pane = this.panes.find((p) => p.pane_id === paneId);
    if (!pane) throw new DemoError("not_found", `pane ${paneId} not found`);
    if (this.agents.has(paneId)) throw new DemoError("bad_request", "the pane already runs an agent");
    const ws = this.workspaces.find((w) => w.workspace_id === pane.workspace_id);
    const folder = cwd ?? (ws?.label === "api-server" ? API : ws?.label === "webapp" ? WEBAPP : `${HOME}/projects/${ws?.label ?? "webapp"}`);
    const a = this.addAgent({
      pane,
      kind,
      name: name ?? null,
      cwd: folder,
      status: "idle",
      seq: this.bump(),
      items: args?.length ? this.resumedItems() : [],
    });
    this.emit({ event: "pane_agent_detected", data: { pane_id: paneId, agent: kind } });
    return a.info;
  }

  /** `agent.prompt`: the agent gets the text and answers with a short scripted reply. */
  prompt(paneId: string, text: string): void {
    const a = this.mustAgent(paneId);
    const t = text.trim();
    if (!t) throw new DemoError("bad_request", "empty prompt");
    if (a.question) {
      // A typed answer replaces the menu, as in a real agent.
      a.question = undefined;
      this.closeOpenTools(a, false, "Declined: you sent a message instead");
    }
    this.enqueue(a, this.replySteps(a, t));
  }

  /** `pane.send_keys`. A digit answers a permission menu; Enter sends the typed text; Escape stops the menu. */
  sendKeys(paneId: string, keys: string[]): void {
    const a = this.agents.get(paneId);
    if (!a) {
      if (!this.panes.some((p) => p.pane_id === paneId)) throw new DemoError("not_found", `pane ${paneId} not found`);
      return;
    }
    for (const k of keys) {
      if (a.question && /^[1-9]$/.test(k)) {
        const i = Number(k) - 1;
        if (i < a.question.choices.length) this.answer(a, i);
      } else if (a.question && (k === "Escape" || k === "C-c")) {
        this.answer(a, a.question.choices.length - 1);
      } else if (k === "Enter" && a.input.trim()) {
        const text = a.input;
        a.input = "";
        this.prompt(paneId, text);
      } else if (k === "BSpace" || k === "Backspace") {
        a.input = a.input.slice(0, -1);
      }
    }
  }

  /** `pane.send_text`: typed text. A trailing newline sends it. */
  sendText(paneId: string, text: string): void {
    const a = this.agents.get(paneId);
    if (!a) {
      if (!this.panes.some((p) => p.pane_id === paneId)) throw new DemoError("not_found", `pane ${paneId} not found`);
      return;
    }
    a.input += text.replace(/[\r\n]+$/, "");
    if (/[\r\n]$/.test(text)) this.sendKeys(paneId, ["Enter"]);
  }

  rename(kind: "agent" | "tab" | "workspace", id: string, value: string | null): void {
    if (kind === "agent") {
      this.mustAgent(id).info.name = value;
      this.emit({ event: "agent_renamed", data: { pane_id: id } });
    } else if (kind === "tab") {
      const t = this.tabs.find((x) => x.tab_id === id);
      if (!t) throw new DemoError("not_found", `tab ${id} not found`);
      t.label = value ?? t.label;
      this.emit({ event: "tab_renamed", data: { tab_id: id } });
    } else {
      const w = this.workspaceExists(id);
      w.label = value ?? w.label;
      this.emit({ event: "workspace_renamed", data: { workspace_id: id, label: w.label } });
    }
  }

  closePane(paneId: string): void {
    const pane = this.panes.find((p) => p.pane_id === paneId);
    if (!pane) throw new DemoError("not_found", `pane ${paneId} not found`);
    this.dropPanes((p) => p.pane_id === paneId);
    this.emit({ event: "pane_closed", data: { pane_id: paneId } });
    // herdr closes a tab with its last pane.
    if (!this.panes.some((p) => p.tab_id === pane.tab_id)) this.closeTab(pane.tab_id);
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.find((t) => t.tab_id === tabId);
    if (!tab) throw new DemoError("not_found", `tab ${tabId} not found`);
    this.dropPanes((p) => p.tab_id === tabId);
    this.tabs = this.tabs.filter((t) => t.tab_id !== tabId);
    this.emit({ event: "tab_closed", data: { tab_id: tabId } });
    if (!this.tabs.some((t) => t.workspace_id === tab.workspace_id)) this.closeWorkspace(tab.workspace_id);
  }

  closeWorkspace(workspaceId: string): void {
    this.workspaceExists(workspaceId);
    this.dropPanes((p) => p.workspace_id === workspaceId);
    this.tabs = this.tabs.filter((t) => t.workspace_id !== workspaceId);
    this.workspaces = this.workspaces.filter((w) => w.workspace_id !== workspaceId);
    this.emit({ event: "workspace_closed", data: { workspace_id: workspaceId } });
  }

  // ---------- internals ----------

  private id(): string {
    return `demo-${this.nextId++}`;
  }

  private bump(): number {
    return ++this.seq;
  }

  private emit(e: HerdrEvent): void {
    if (this.stopped) return;
    this.herdrListeners.forEach((cb) => cb(e));
  }

  private mustAgent(paneId: string): Agent {
    const a = this.agents.get(paneId);
    if (!a) throw new DemoError("not_found", `no agent in pane ${paneId}`);
    return a;
  }

  private agentByLog(log: string): Agent | undefined {
    for (const a of this.agents.values()) if (a.log === log) return a;
    return undefined;
  }

  private hasLog(log: string): boolean {
    return !!this.agentByLog(log) || [...this.subagents.values()].some((s) => s.log === log);
  }

  private logItems(log: string): ThreadItem[] {
    const a = this.agentByLog(log);
    if (a) return a.items;
    const s = [...this.subagents.values()].find((x) => x.log === log);
    if (s) return s.items;
    throw new DemoError("not_found", `no such log: ${log}`);
  }

  private dropPanes(drop: (p: PaneInfo) => boolean): void {
    for (const p of this.panes.filter(drop)) {
      const a = this.agents.get(p.pane_id);
      if (a) {
        a.queue = [];
        this.followers.get(a.log)?.forEach((cb) => cb({ error: "closed" }));
        this.followers.delete(a.log);
      }
      this.agents.delete(p.pane_id);
    }
    this.panes = this.panes.filter((p) => !drop(p));
  }

  /** Adds or replaces (same id) a thread item and sends it to the log's followers. */
  private put(log: string, items: ThreadItem[], item: ThreadItem, extra?: { agent_running?: boolean }): void {
    const at = items.findIndex((i) => i.id === item.id);
    if (at >= 0) items[at] = item;
    else items.push(item);
    const offset = items.length;
    this.followers.get(log)?.forEach((cb) => cb({ items: [item], offset, ...extra }));
  }

  private putItem(a: Agent, item: ThreadItem): void {
    this.put(a.log, a.items, item);
  }

  private setStatus(a: Agent, status: AgentStatus): void {
    if (a.info.agent_status === status) return;
    a.info.agent_status = status;
    a.info.state_change_seq = this.bump();
    a.since = Date.now();
    if (status !== "working") a.activity = undefined;
    this.emit({ event: "pane_agent_status_changed", data: { pane_id: a.info.pane_id, agent_status: status } });
    const where = this.workspaces.find((w) => w.workspace_id === a.info.workspace_id)?.label ?? "demo";
    if (status === "done") {
      const last = [...a.items].reverse().find((i) => i.kind === "assistant");
      this.onNotice?.({
        kind: "finished",
        paneId: a.info.pane_id,
        title: `${kindLabel(a.info.agent)} finished · ${where}`,
        body: last && last.kind === "assistant" ? short(plain(last.markdown), 120) : "The agent finished its turn.",
      });
    }
  }

  private enqueue(a: Agent, steps: Step[]): void {
    a.queue.push(...steps);
    this.pump(a);
  }

  private pump(a: Agent): void {
    if (a.waiting || a.queue.length === 0 || this.stopped) return;
    const step = a.queue.shift()!;
    a.waiting = true;
    this.clock.after(step.delay, () => {
      a.waiting = false;
      if (this.agents.get(a.info.pane_id) !== a) return;
      step.run();
      this.pump(a);
    });
  }

  private answer(a: Agent, index: number): void {
    const q = a.question;
    if (!q) return;
    a.question = undefined;
    q.onAnswer(index);
  }

  /** Gives every tool item without a result a result (for a declined or replaced permission menu). */
  private closeOpenTools(a: Agent, ok: boolean, text: string): void {
    for (const i of a.items) {
      if (i.kind === "tool" && !i.result) this.putItem(a, { ...i, result: { ok, text, truncated: false, ts: Date.now() } });
    }
  }

  /** Streams an assistant reply in a few parts (one item id, longer text each time). */
  private streamSteps(a: Agent, markdown: string, gap = 800): Step[] {
    const id = this.id();
    const ts = Date.now();
    const words = markdown.split(" ");
    const parts = 3;
    return Array.from({ length: parts }, (_, k) => ({
      delay: k === 0 ? 1_000 : gap,
      run: () => {
        const n = Math.ceil((words.length * (k + 1)) / parts);
        this.putItem(a, { kind: "assistant", id, ts, markdown: words.slice(0, n).join(" ") });
      },
    }));
  }

  private toolSteps(a: Agent, name: string, summary: string, input: unknown, result: string, activity: string, delay = 1_200): Step[] {
    const id = this.id();
    return [
      {
        delay,
        run: () => {
          a.activity = activity;
          this.putItem(a, { kind: "tool", id, ts: Date.now(), name, input_summary: summary, input });
        },
      },
      {
        delay: 1_000,
        run: () => {
          const cur = a.items.find((i) => i.id === id);
          if (cur?.kind === "tool") this.putItem(a, { ...cur, result: { ok: true, text: result, truncated: false, ts: Date.now() } });
        },
      },
    ];
  }

  private replySteps(a: Agent, text: string): Step[] {
    const userId = this.id();
    const reply = replyFor(text);
    return [
      {
        // After a short delay, as in a real log: the pending bubble first sees the log without it.
        delay: 600,
        run: () => {
          this.putItem(a, { kind: "user", id: userId, ts: Date.now(), text });
          a.activity = "Thinking";
          this.setStatus(a, "working");
        },
      },
      {
        delay: 1_000,
        run: () => this.putItem(a, { kind: "thinking", id: this.id(), ts: Date.now(), text: reply.thinking }),
      },
      ...this.toolSteps(a, reply.tool.name, reply.tool.summary, reply.tool.input, reply.tool.result, reply.tool.activity),
      ...this.streamSteps(a, reply.markdown),
      { delay: 600, run: () => this.setStatus(a, "done") },
    ];
  }

  private resumedItems(): ThreadItem[] {
    const ts = Date.now() - 3 * 3600_000;
    return [
      { kind: "user", id: this.id(), ts, text: "Add a loading state to the dashboard" },
      {
        kind: "assistant",
        id: this.id(),
        ts: ts + 60_000,
        markdown: "Added a loading skeleton to the dashboard cards. The cards show it until the first data arrives.",
      },
      { kind: "system", id: this.id(), ts: Date.now(), text: "Resumed an earlier session." },
    ];
  }

  private addAgent(o: {
    pane: PaneInfo;
    kind: string;
    name: string | null;
    cwd: string;
    status: AgentStatus;
    seq: number;
    items: ThreadItem[];
    title?: string;
  }): Agent {
    const session = `demo-session-${o.pane.pane_id}-${this.nextId++}`;
    const a: Agent = {
      info: {
        pane_id: o.pane.pane_id,
        tab_id: o.pane.tab_id,
        workspace_id: o.pane.workspace_id,
        agent: o.kind,
        agent_status: o.status,
        cwd: o.cwd,
        state_change_seq: o.seq,
        terminal_title_stripped: o.title,
        name: o.name,
      },
      log: `demo://${session}.jsonl`,
      session,
      items: o.items,
      since: Date.now(),
      input: "",
      queue: [],
      waiting: false,
    };
    this.agents.set(o.pane.pane_id, a);
    return a;
  }

  /** The starting state: 2 workspaces, 5 tabs, 5 agents. */
  private seed(): void {
    const now = Date.now();
    const min = 60_000;
    this.workspaces = [
      { workspace_id: "w1", label: "webapp", number: 1, agent_status: "unknown" },
      { workspace_id: "w2", label: "api-server", number: 2, agent_status: "unknown" },
    ];
    const tab = (tab_id: string, workspace_id: string, label: string, number: number): TabInfo => ({
      tab_id,
      workspace_id,
      label,
      number,
      agent_status: "unknown",
    });
    this.tabs = [
      tab("t1", "w1", "login form", 1),
      tab("t2", "w1", "tests", 2),
      tab("t3", "w1", "readme", 3),
      tab("t4", "w2", "validation", 1),
      tab("t5", "w2", "docs", 2),
    ];
    const pane = (n: number, tabId: string, ws: string): PaneInfo => ({ pane_id: `p${n}`, tab_id: tabId, workspace_id: ws, label: null });
    this.panes = [pane(1, "t1", "w1"), pane(2, "t4", "w2"), pane(3, "t2", "w1"), pane(4, "t5", "w2"), pane(5, "t3", "w1")];

    // 1. Claude, working: fixes the login form, with a running subagent.
    const p1 = this.addAgent({
      pane: this.panes[0],
      kind: "claude",
      name: null,
      cwd: WEBAPP,
      status: "working",
      seq: this.bump(),
      title: "Fix login form",
      items: [
        { kind: "user", id: this.id(), ts: now - 4 * min, text: "Fix the login form: the submit button stays disabled after I type a valid email." },
        {
          kind: "thinking",
          id: this.id(),
          ts: now - 4 * min + 5_000,
          text: "The button state comes from the email validator. I will read the form and the validator first.",
        },
        tool(this.id(), now - 3.8 * min, "Read", "src/components/LoginForm.tsx", { file_path: `${WEBAPP}/src/components/LoginForm.tsx` }, "84 lines"),
        tool(
          this.id(),
          now - 3.5 * min,
          "Grep",
          "validateEmail",
          { pattern: "validateEmail", path: "src" },
          "src/lib/validate.ts:12\nsrc/components/LoginForm.tsx:8\nsrc/components/SignupForm.tsx:10",
        ),
        {
          kind: "assistant",
          id: this.id(),
          ts: now - 3.2 * min,
          markdown:
            "The validator in `src/lib/validate.ts` rejects emails with a `+` sign, so the button stays disabled. I will fix the pattern and ask a subagent to check the other forms.",
        },
      ],
    });
    p1.activity = "Checking other forms";
    p1.since = now - 4 * min;
    const subId = "demo-sub-1";
    const subStart = now - 3 * min;
    const subItem: ThreadItem = {
      kind: "subagent",
      id: this.id(),
      ts: subStart,
      agent_id: subId,
      description: "Check other forms that use validateEmail",
      status: "running",
      started_at: subStart,
      activity: "Read SignupForm.tsx",
      tool_count: 3,
      model: "sonnet",
      agent_type: "Explore",
    };
    p1.items.push(subItem);
    const sub: Subagent = {
      log: `demo://${p1.session}/subagents/${subId}.jsonl`,
      parentPane: "p1",
      agentId: subId,
      running: true,
      items: [
        { kind: "user", id: this.id(), ts: subStart, text: "Find every form that calls validateEmail and check if the plus-sign fix changes it." },
        tool(this.id(), subStart + 4_000, "Grep", "validateEmail", { pattern: "validateEmail" }, "3 files"),
        tool(this.id(), subStart + 9_000, "Read", "src/components/SignupForm.tsx", { file_path: "src/components/SignupForm.tsx" }, "112 lines"),
      ],
    };
    this.subagents.set(sub.log, sub);

    // 2. Codex, blocked: asks to install a package.
    const p2Tool = tool(this.id(), now - 40_000, "Bash", "pnpm add zod", { command: "pnpm add zod" }, undefined);
    const p2 = this.addAgent({
      pane: this.panes[1],
      kind: "codex",
      name: null,
      cwd: API,
      status: "blocked",
      seq: this.bump(),
      items: [
        { kind: "user", id: this.id(), ts: now - 2 * min, text: "Add input validation to the POST /users endpoint." },
        {
          kind: "assistant",
          id: this.id(),
          ts: now - 90_000,
          markdown: "I will describe the request body with a **zod** schema. The package is not installed yet, so I need to add it first.",
        },
        p2Tool,
      ],
    });
    p2.since = now - 40_000;
    p2.question = {
      prompt: "Allow Codex to run `pnpm add zod`?",
      choices: ["Yes", "Yes, and don't ask again for pnpm add", "No, and tell Codex what to do differently"],
      onAnswer: (i) => this.onP2Answer(p2, p2Tool.id, i),
    };

    // 3. Pi, ready: finished the signup tests.
    const p3 = this.addAgent({
      pane: this.panes[2],
      kind: "pi",
      name: null,
      cwd: WEBAPP,
      status: "done",
      seq: this.bump(),
      items: [
        { kind: "user", id: this.id(), ts: now - 12 * min, text: "Add tests for the signup flow." },
        tool(this.id(), now - 10 * min, "Write", "tests/signup.test.ts", { file_path: "tests/signup.test.ts" }, "Wrote 146 lines"),
        tool(this.id(), now - 8 * min, "Bash", "pnpm test tests/signup.test.ts", { command: "pnpm test tests/signup.test.ts" }, "Tests  12 passed (12)"),
        {
          kind: "assistant",
          id: this.id(),
          ts: now - 7 * min,
          markdown:
            "Added **12 tests** for the signup flow in `tests/signup.test.ts`:\n\n- valid and invalid emails\n- a password that is too short\n- the error message when the email is already in use\n\nAll tests pass.",
        },
      ],
    });
    p3.since = now - 7 * min;

    // 4. OpenCode, idle (seq 0: never "Ready").
    const p4 = this.addAgent({
      pane: this.panes[3],
      kind: "opencode",
      name: null,
      cwd: API,
      status: "idle",
      seq: 0,
      items: [
        { kind: "user", id: this.id(), ts: now - 50 * min, text: "Write API docs for the auth routes." },
        { kind: "assistant", id: this.id(), ts: now - 46 * min, markdown: "Done. The docs for `/login`, `/logout` and `/refresh` are in `docs/auth.md`." },
      ],
    });
    p4.since = now - 46 * min;

    // 5. Claude, idle.
    const p5 = this.addAgent({
      pane: this.panes[4],
      kind: "claude",
      name: null,
      cwd: WEBAPP,
      status: "idle",
      seq: 0,
      items: [
        { kind: "user", id: this.id(), ts: now - 70 * min, text: "Update the README with the new setup steps." },
        { kind: "assistant", id: this.id(), ts: now - 66 * min, markdown: "Updated `README.md`: the setup now uses `pnpm install` and `pnpm dev`." },
      ],
    });
    p5.since = now - 66 * min;
    // The dev server still runs in the background: the Board shows this agent as "Background".
    p5.background = { count: 1, commands: ["pnpm dev"] };
  }

  /** The scripts that run without user input: the working agent advances, the blocked one asks. */
  private play(): void {
    const p1 = this.agents.get("p1")!;
    const p2 = this.agents.get("p2")!;
    const sub = [...this.subagents.values()][0];
    const subItemId = p1.items.find((i) => i.kind === "subagent")!.id;
    const updateSub = (patch: Partial<Extract<ThreadItem, { kind: "subagent" }>>) => {
      const cur = p1.items.find((i) => i.id === subItemId);
      if (cur?.kind === "subagent") this.putItem(p1, { ...cur, ...patch } as ThreadItem);
    };
    const subTool = (name: string, summary: string, result: string) =>
      this.put(sub.log, sub.items, tool(this.id(), Date.now(), name, summary, { summary }, result), { agent_running: sub.running });

    this.clock.after(3_000, () => {
      if (p2.question && this.agents.get("p2") === p2) {
        const q = p2.question;
        this.onNotice?.({ kind: "needs_you", paneId: "p2", title: "Codex needs you · api-server", body: q.prompt, choices: q.choices });
      }
    });

    this.enqueue(p1, [
      ...this.toolSteps(p1, "Edit", "src/lib/validate.ts", { file_path: "src/lib/validate.ts" }, "Updated 1 line", "Editing validate.ts", 2_500),
      {
        delay: 2_000,
        run: () => {
          subTool("Grep", "onBlur", "2 matches");
          updateSub({ activity: "Grep onBlur", tool_count: 5 });
        },
      },
      ...this.toolSteps(p1, "Bash", "pnpm test src/lib", { command: "pnpm test src/lib" }, "Tests  14 passed (14)", "Running pnpm test", 2_500),
      {
        delay: 2_500,
        run: () => {
          sub.running = false;
          this.put(
            sub.log,
            sub.items,
            {
              kind: "assistant",
              id: this.id(),
              ts: Date.now(),
              markdown: "SignupForm uses the same validator, so the same fix covers it. No other form calls `validateEmail`.",
            },
            { agent_running: false },
          );
          updateSub({
            status: "completed",
            activity: undefined,
            finished_at: Date.now(),
            tool_count: 6,
            result_summary: "SignupForm uses the same validator and gets the same fix. No other forms are affected.",
          });
        },
      },
      ...this.toolSteps(p1, "Edit", "src/components/LoginForm.tsx", { file_path: "src/components/LoginForm.tsx" }, "Updated 3 lines", "Editing LoginForm.tsx", 2_500),
      ...this.streamSteps(
        p1,
        "Fixed. The email pattern now accepts a `+` sign, and the submit button turns on as soon as the email is valid.\n\n- `src/lib/validate.ts`: new pattern\n- `src/components/LoginForm.tsx`: checks on each key press, not only on blur\n\nThe signup form uses the same validator, so it is fixed too. All 14 tests pass.",
      ),
      { delay: 600, run: () => this.setStatus(p1, "done") },
    ]);
  }

  private onP2Answer(p2: Agent, toolId: string, index: number): void {
    const cur = p2.items.find((i) => i.id === toolId);
    if (index >= 2) {
      if (cur?.kind === "tool") this.putItem(p2, { ...cur, result: { ok: false, text: "Declined by you", truncated: false, ts: Date.now() } });
      this.setStatus(p2, "working");
      this.enqueue(p2, [
        ...this.streamSteps(p2, "OK, I did not install zod. Tell me what to use instead, for example a small hand-written check.", 500),
        { delay: 500, run: () => this.setStatus(p2, "done") },
      ]);
      return;
    }
    p2.activity = "Running pnpm add zod";
    this.setStatus(p2, "working");
    this.enqueue(p2, [
      {
        delay: 2_000,
        run: () => {
          const t = p2.items.find((i) => i.id === toolId);
          if (t?.kind === "tool") this.putItem(p2, { ...t, result: { ok: true, text: "+ zod 3.23.8\nDone in 1.4s", truncated: false, ts: Date.now() } });
        },
      },
      ...this.toolSteps(p2, "Edit", "src/routes/users.ts", { file_path: "src/routes/users.ts" }, "Updated 18 lines", "Editing users.ts", 1_500),
      ...this.toolSteps(p2, "Bash", "pnpm test", { command: "pnpm test" }, "Tests  31 passed (31)", "Running pnpm test", 1_500),
      ...this.streamSteps(
        p2,
        "Added a zod schema for the `POST /users` body. A request with a missing name or a bad email now gets a **400** with a clear message. All 31 tests pass.",
      ),
      { delay: 600, run: () => this.setStatus(p2, "done") },
    ]);
  }
}

function tool(id: string, ts: number, name: string, summary: string, input: unknown, result: string | undefined): ThreadItem {
  return {
    kind: "tool",
    id,
    ts,
    name,
    input_summary: summary,
    input,
    ...(result !== undefined ? { result: { ok: true, text: result, truncated: false, ts: ts + 1_500 } } : {}),
  };
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

/** The scripted answer to a message. The text is generic: the demo changes no files. */
function replyFor(text: string): {
  thinking: string;
  markdown: string;
  tool: { name: string; summary: string; input: unknown; result: string; activity: string };
} {
  const quoted = short(text.replace(/\s+/g, " "), 80);
  if (/test/i.test(text)) {
    return {
      thinking: "I will run the test suite and look at the result.",
      markdown: `I ran the tests for your request ("${quoted}").\n\n- **38 tests** pass\n- no test fails\n\nThis is the demo, so nothing ran on a real computer.`,
      tool: { name: "Bash", summary: "pnpm test", input: { command: "pnpm test" }, result: "Tests  38 passed (38)", activity: "Running pnpm test" },
    };
  }
  return {
    thinking: "I will look at the project files that this request touches.",
    markdown: `Done: "${quoted}".\n\n- I read the files that the request touches\n- I made the change and checked it\n\nThis is the demo, so no files changed. With your own computer, the agent works in your project and reports back here.`,
    tool: { name: "Read", summary: "src/app.ts", input: { file_path: "src/app.ts" }, result: "120 lines", activity: "Reading app.ts" },
  };
}
