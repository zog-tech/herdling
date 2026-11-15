/**
 * "Jump to a terminal": one list of every agent and terminal on every online computer, grouped by
 * task with its helpers under it, and a word search over it. Pure: the jump sheet renders it.
 */
import type { AgentStatus } from "@herdling/protocol";

import { agentLabel } from "@/herdr/agentKinds";
import { agentKind, agentTitle } from "@/herdr/names";
import type { Snapshot } from "@/herdr/snapshot";
import { terminalFolder, terminalPanes, terminalTitle } from "@/herdr/terminals";

import { titleParts } from "./rowText";
import { groupOf, helperParents, type HelperInfo } from "./tasks";
import { queryWords } from "./textFilter";

/** One task of the jump list: an agent with its helpers, or a terminal with no agent. */
export type JumpTask = {
  key: string;
  hostId: string;
  hostName: string;
  paneId: string;
  title: string;
  /** The status of the agent; "terminal" for a pane with no agent. */
  status: AgentStatus | "terminal";
  /** The group: the Herdr 2 group, else the workspace name. */
  group?: string;
  repo?: string;
  branch?: string;
  folder?: string;
  /** The agent kind as the app names it ("Claude"). Empty for a terminal. */
  kind: string;
  helpers: HelperInfo[];
};

export type JumpHost = { hostId: string; hostName: string; snapshot: Pick<Snapshot, "agents" | "workspaces" | "tabs" | "panes"> };

const STATUS_RANK: Record<JumpTask["status"], number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4, terminal: 5 };

/**
 * The tasks of all hosts: host order, then the group name, then what needs the user first. A
 * helper (`helperParents`) is not a task: it is in the `helpers` of its task.
 */
export function jumpTasks(hosts: readonly JumpHost[]): JumpTask[] {
  const out: JumpTask[] = [];
  for (const { hostId, hostName, snapshot: s } of hosts) {
    const wsLabel = (id: string) => s.workspaces.find((w) => w.workspace_id === id)?.label;
    const parents = helperParents(s.agents);
    const helpers = new Map<string, HelperInfo[]>();
    for (const a of s.agents) {
      const top = parents.get(a.pane_id);
      if (top) helpers.set(top, [...(helpers.get(top) ?? []), { paneId: a.pane_id, title: agentTitle(s, a), status: a.agent_status }]);
    }
    const tasks: JumpTask[] = [];
    for (const a of s.agents) {
      if (parents.has(a.pane_id)) continue;
      const kind = agentKind(a);
      const group = groupOf(a) ?? wsLabel(a.workspace_id);
      tasks.push({
        key: `${hostId}:${a.pane_id}`,
        hostId,
        hostName,
        paneId: a.pane_id,
        // "webapp · login form" in the group "webapp" is the task "login form".
        title: titleParts({ group, title: agentTitle(s, a) }).task,
        status: a.agent_status,
        group,
        repo: a.repo ?? undefined,
        branch: a.branch ?? undefined,
        folder: a.cwd ?? undefined,
        kind: kind ? agentLabel(kind) : "",
        helpers: helpers.get(a.pane_id) ?? [],
      });
    }
    for (const p of terminalPanes(s)) {
      tasks.push({
        key: `${hostId}:${p.pane_id}`,
        hostId,
        hostName,
        paneId: p.pane_id,
        title: terminalTitle(p),
        status: "terminal",
        group: groupOf(p) ?? wsLabel(p.workspace_id),
        repo: p.repo ?? undefined,
        branch: p.branch ?? undefined,
        folder: terminalFolder(p),
        kind: "",
        helpers: [],
      });
    }
    tasks.sort(
      (x, y) => (x.group ?? "").localeCompare(y.group ?? "") || STATUS_RANK[x.status] - STATUS_RANK[y.status] || x.title.localeCompare(y.title),
    );
    out.push(...tasks);
  }
  return out;
}

/** The text that the search looks in, in lower case: the task, its place and its helpers. */
function jumpText(t: JumpTask): string {
  return [t.title, t.group, t.repo, t.branch, t.hostName, t.folder, t.kind, ...t.helpers.map((h) => h.title)]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

/** The tasks that have every word of the query. An empty query keeps all of them. */
export function filterJump(tasks: readonly JumpTask[], query: string): JumpTask[] {
  const words = queryWords(query);
  if (words.length === 0) return [...tasks];
  return tasks.filter((t) => {
    const text = jumpText(t);
    return words.every((w) => text.includes(w));
  });
}

/** The line under a jump task: "<kind> · <computer>" (the computer only with more than one host). */
export function jumpDetail(t: Pick<JumpTask, "kind" | "hostName" | "status">, multiHost: boolean): string {
  return [t.status === "terminal" ? "Terminal" : t.kind, multiHost ? t.hostName : undefined].filter(Boolean).join(" · ");
}
