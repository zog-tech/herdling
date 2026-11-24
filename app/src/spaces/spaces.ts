/**
 * The Spaces tab model: the workspaces of one computer as the Herdr app shows them (spaces, or
 * fallback groups), each with its tabs and the panes of each tab. Pure: the tab, the space screen
 * and the tests use it. The snapshot has no pane layout, so the panes of a tab keep the snapshot order.
 */
import type { AgentStatus } from "@herdling/protocol";

import { isCore } from "@/herdr/backend";
import { agentTitle } from "@/herdr/names";
import type { Snapshot } from "@/herdr/snapshot";
import { terminalTitle } from "@/herdr/terminals";

/** One pane of a tab. `status` is "terminal" for a pane with no agent. */
export type SpacePane = { paneId: string; title: string; status: AgentStatus | "terminal" };
export type SpaceTab = { tabId: string; label: string; panes: SpacePane[]; attention: number; working: boolean };
export type Space = {
  workspaceId: string;
  label: string;
  /** A Herdr 2 space or group. */
  core: boolean;
  tabs: SpaceTab[];
  /** The count of agents that need the user. */
  attention: number;
  /** True when an agent works and none needs the user. */
  working: boolean;
  agents: number;
  /** The count of all panes (agents and terminals). */
  paneCount: number;
  /** The count of agents that work. */
  workingCount: number;
  /** The folder of the space: the cwd of its first agent or pane. */
  folder?: string;
};

const attentionOf = (panes: SpacePane[]) => panes.filter((p) => p.status === "blocked").length;
const workingOf = (panes: SpacePane[]) => panes.some((p) => p.status === "working");

/** The folder of a space: the cwd of its first agent, else of its first pane that has one. */
export function spaceFolder(s: Pick<Snapshot, "agents" | "panes">, workspaceId: string): string | undefined {
  const inSpace = (p: { workspace_id: string }) => p.workspace_id === workspaceId;
  const agent = s.agents.find((a) => inSpace(a) && a.cwd);
  const pane = s.panes.find((p) => inSpace(p) && (p.cwd || p.foreground_cwd));
  return agent?.cwd ?? pane?.cwd ?? pane?.foreground_cwd ?? undefined;
}

/** The longest folder text on a row, in characters. A longer path loses its middle. */
export const FOLDER_MAX = 32;

/**
 * A folder for a row: the home folder of a user becomes "~", a trailing slash goes away, and a
 * path over `max` characters keeps its start and its end with "…" between them.
 */
export function shortFolder(path: string, max = FOLDER_MAX): string {
  const clean = path.trim().replace(/\/+$/, "") || (path.trim() ? "/" : "");
  const shown = clean.replace(/^(?:\/Users|\/home)\/[^/]+(?=\/|$)/, "~");
  if (shown.length <= max) return shown;
  const keep = max - 1;
  const tail = Math.ceil(keep / 2);
  return `${shown.slice(0, keep - tail)}…${shown.slice(shown.length - tail)}`;
}

/** The detail line of a row: "~/dev/app · 3 panes · 1 working". The parts that do not apply go away. */
export function spaceDetail(s: Pick<Space, "folder" | "paneCount" | "workingCount">): string {
  const parts: string[] = [];
  if (s.folder) parts.push(shortFolder(s.folder));
  parts.push(`${s.paneCount} ${s.paneCount === 1 ? "pane" : "panes"}`);
  if (s.workingCount > 0) parts.push(`${s.workingCount} working`);
  return parts.join(" · ");
}

/** The spaces of one snapshot, in the order of their number; tabs in the order of their number. */
export function hostSpaces(s: Pick<Snapshot, "agents" | "workspaces" | "tabs" | "panes">): Space[] {
  const agentOf = new Map(s.agents.map((a) => [a.pane_id, a]));
  const panesOf = new Map<string, SpacePane[]>();
  for (const p of s.panes) {
    const a = agentOf.get(p.pane_id);
    const pane: SpacePane = a ? { paneId: p.pane_id, title: agentTitle(s, a), status: a.agent_status } : { paneId: p.pane_id, title: terminalTitle(p), status: "terminal" };
    panesOf.set(p.tab_id, [...(panesOf.get(p.tab_id) ?? []), pane]);
  }
  const byNumber = <T extends { number?: number }>(x: T, y: T) => (x.number ?? 0) - (y.number ?? 0);
  return [...s.workspaces].sort(byNumber).map((w) => {
    const tabs = s.tabs.filter((t) => t.workspace_id === w.workspace_id).sort(byNumber);
    const known = new Set(tabs.map((t) => t.tab_id));
    const list: SpaceTab[] = tabs.map((t) => {
      const panes = panesOf.get(t.tab_id) ?? [];
      return { tabId: t.tab_id, label: t.label, panes, attention: attentionOf(panes), working: workingOf(panes) };
    });
    // A pane whose tab the snapshot does not list (a lagging snapshot) still shows, in its own tab.
    for (const p of s.panes) {
      if (p.workspace_id !== w.workspace_id || known.has(p.tab_id)) continue;
      known.add(p.tab_id);
      const panes = panesOf.get(p.tab_id) ?? [];
      list.push({ tabId: p.tab_id, label: "", panes, attention: attentionOf(panes), working: workingOf(panes) });
    }
    const all = list.flatMap((t) => t.panes);
    const attention = attentionOf(all);
    return {
      folder: spaceFolder(s, w.workspace_id),
      paneCount: all.length,
      workingCount: all.filter((p) => p.status === "working").length,
      workspaceId: w.workspace_id,
      label: w.label,
      core: isCore(w),
      tabs: list,
      attention,
      working: attention === 0 && workingOf(all),
      agents: all.filter((p) => p.status !== "terminal").length,
    };
  });
}

/** The tab to show first on a space screen: the asked tab, else the first that needs the user, else the first. */
export function firstTab(space: Pick<Space, "tabs">, asked?: string): string | undefined {
  if (asked && space.tabs.some((t) => t.tabId === asked)) return asked;
  return (space.tabs.find((t) => t.attention > 0) ?? space.tabs[0])?.tabId;
}

/** The label of a tab chip: its name, else "Tab <n>". */
export const tabLabel = (t: Pick<SpaceTab, "label">, index: number) => t.label.trim() || `Tab ${index + 1}`;

/** The most thumbnails that poll at one time on a space screen. */
export const MAX_THUMBS = 6;

/**
 * The params of `workspace.close` for a space screen. For a Herdr 2 space they name every pane
 * that the screen showed (`pane_ids`), so herdlingd closes only those. A repo or folder group
 * follows the folder of each terminal, and a terminal that joined it later stays open.
 * herdr 1 does not know the field.
 */
export function closeSpaceParams(space: Pick<Space, "workspaceId" | "tabs">, core: boolean): { workspace_id: string; pane_ids?: string[] } {
  if (!core) return { workspace_id: space.workspaceId };
  return { workspace_id: space.workspaceId, pane_ids: space.tabs.flatMap((t) => t.panes.map((p) => p.paneId)) };
}
