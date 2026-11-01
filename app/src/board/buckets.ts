import type { AgentPreview, AgentStatus } from "@herdling/protocol";

import { agentSubtitle, agentTitle, secondaryTitle } from "@/herdr/names";
import type { AgentInfo, PaneInfo, TabInfo, WorkspaceInfo } from "@/herdr/snapshot";

import { backgroundLine, hasBackground } from "./background";

/** Where an agent sits on the Board. */
export type Bucket = "needs_you" | "ready" | "working" | "background" | "idle";

/** Board order: what needs the user first, quiet agents last. */
export const BUCKETS: readonly Bucket[] = ["needs_you", "ready", "working", "background", "idle"];

export const BUCKET_LABEL: Record<Bucket, string> = {
  needs_you: "Needs you",
  ready: "Ready",
  working: "Working",
  background: "Background",
  idle: "Idle",
};

/**
 * Bucket of one agent. `seenSeq` is the last `state_change_seq` the user saw for the pane.
 * blocked → needs_you; working → working; idle/done finished after the last look → ready;
 * everything else (seen idle/done, unknown) → idle.
 */
export function bucketOf(agent: Pick<AgentInfo, "agent_status" | "state_change_seq">, seenSeq: number | undefined): Bucket {
  switch (agent.agent_status) {
    case "blocked":
      return "needs_you";
    case "working":
      return "working";
    case "idle":
    case "done":
      return agent.state_change_seq > (seenSeq ?? 0) ? "ready" : "idle";
    default:
      return "idle";
  }
}

/**
 * An idle agent whose preview reports background work (shells, subagents) moves to "background".
 * Every other bucket wins over it.
 */
export function withBackground(bucket: Bucket, p: AgentPreview | undefined): Bucket {
  return bucket === "idle" && hasBackground(p?.background) ? "background" : bucket;
}

/** A preview from the companion and the herdr status the agent had when it was fetched. */
export type PreviewEntry = AgentPreview & { status: AgentStatus };

/** One card of the Board. */
export type BoardItem = {
  key: string;
  hostId: string;
  hostName: string;
  workspace: string;
  /** Name as herdr shows it: agent name, else workspace [· tab] (see `agentTitle`). */
  title: string;
  /** "<host> · <agent kind>". */
  subtitle: string;
  /** The terminal title, when it adds to the title. Shown only when there is no preview line. */
  terminalTitle?: string;
  agent: AgentInfo;
  bucket: Bucket;
  /** Epoch ms when the current status began, if known. */
  since?: number;
  /** True when `since` comes from the host. False: it is the app's own first sighting of the status. */
  sinceKnown?: boolean;
  /** The line under the title: activity, question or last reply. */
  line?: string;
};

/**
 * The preview field that fits the bucket: activity while working, the question when blocked, the
 * background work in "background", else the last reply.
 */
export function previewLine(bucket: Bucket, p: AgentPreview | undefined): string | undefined {
  if (!p) return undefined;
  switch (bucket) {
    case "working":
      return p.activity ?? p.last_reply;
    case "needs_you":
      return p.question ?? p.last_reply;
    case "background":
      return backgroundLine(p.background) ?? p.last_reply;
    default:
      return p.last_reply;
  }
}

export type BoardHost = {
  hostId: string;
  hostName: string;
  agents: AgentInfo[];
  workspaces: (Pick<WorkspaceInfo, "workspace_id" | "label"> & Partial<WorkspaceInfo>)[];
  tabs?: TabInfo[];
  panes?: PaneInfo[];
};

/**
 * Cards from the live snapshots plus the latest previews. A preview fetched while the agent
 * had another status is ignored (it describes the old state). `firstSeen` holds the app's own
 * start time per pane (epoch ms) for when the companion does not know `status_since`.
 */
export function mergeBoard(
  hosts: BoardHost[],
  previews: Record<string, PreviewEntry>,
  /** Last-seen seq per pane key; null while it loads (nothing counts as unread then). */
  seen: Record<string, number> | null,
  firstSeen: Record<string, { status: AgentStatus; at: number }>,
): BoardItem[] {
  const out: BoardItem[] = [];
  for (const h of hosts) {
    for (const agent of h.agents) {
      const key = `${h.hostId}:${agent.pane_id}`;
      const raw = previews[key];
      const p = raw && raw.status === agent.agent_status ? raw : undefined;
      const bucket = withBackground(bucketOf(agent, seen ? seen[key] : Number.POSITIVE_INFINITY), p);
      const local = firstSeen[key]?.status === agent.agent_status ? firstSeen[key].at : undefined;
      const names = { workspaces: h.workspaces as WorkspaceInfo[], tabs: h.tabs ?? [], panes: h.panes ?? [] };
      out.push({
        key,
        hostId: h.hostId,
        hostName: h.hostName,
        workspace: h.workspaces.find((w) => w.workspace_id === agent.workspace_id)?.label ?? agent.workspace_id,
        title: agentTitle(names, agent),
        subtitle: agentSubtitle(h.hostName, agent),
        terminalTitle: secondaryTitle(names, agent),
        agent,
        bucket,
        since: p?.status_since != null ? p.status_since * 1000 : local,
        sinceKnown: p?.status_since != null,
        line: previewLine(bucket, p),
      });
    }
  }
  return sortBoard(out);
}

/** Bucket order, then the newest status change first. Unknown start times go last in their bucket. */
export function sortBoard(items: BoardItem[]): BoardItem[] {
  const rank = (b: Bucket) => BUCKETS.indexOf(b);
  return [...items].sort(
    (a, b) =>
      rank(a.bucket) - rank(b.bucket) ||
      (b.since ?? -1) - (a.since ?? -1) ||
      b.agent.state_change_seq - a.agent.state_change_seq ||
      a.key.localeCompare(b.key),
  );
}

export type Counts = Record<Bucket, number>;

export function countBuckets(items: BoardItem[]): Counts {
  const c: Counts = { needs_you: 0, ready: 0, working: 0, background: 0, idle: 0 };
  for (const i of items) c[i.bucket]++;
  return c;
}

/** Items of one bucket, or all with no filter. */
export function filterBoard(items: BoardItem[], filter: Bucket | null): BoardItem[] {
  return filter ? items.filter((i) => i.bucket === filter) : items;
}

/** Tapping the active chip clears the filter; tapping another chip selects it. */
export function toggleFilter(current: Bucket | null, tapped: Bucket): Bucket | null {
  return current === tapped ? null : tapped;
}

export type GroupBy = "status" | "host" | "workspace" | "folder";
export type BoardSection = {
  key: string;
  title: string;
  /** A second line for the header: the computers of a workspace that spans more than one. */
  subtitle?: string;
  bucket?: Bucket;
  /** Set when grouped by workspace and the section has one workspace on one computer. */
  workspace?: { hostId: string; workspaceId: string };
  data: BoardItem[];
};

/** Key of the section for agents with no folder. */
export const NO_FOLDER_KEY = "dir:";

/** The workspace name as a key: trimmed and lower case, so "API " and "api" are one workspace. */
export const workspaceKey = (name: string) => `ws:${name.trim().toLowerCase()}`;

/** The folder as a key: trimmed, with no trailing slash. An empty result means no folder. */
export const folderPath = (cwd: string | null | undefined) => {
  const t = (cwd ?? "").trim();
  return t.length > 1 ? t.replace(/\/+$/, "") || "/" : t;
};

/** The parts of a folder path for display. The home folder of a user becomes "~". */
function folderParts(path: string): string[] {
  const home = /^(?:\/Users|\/home)\/[^/]+(?=\/|$)/.exec(path);
  const rest = home ? path.slice(home[0].length) : path;
  const parts = rest.split("/").filter(Boolean);
  return home ? ["~", ...parts] : parts;
}

/**
 * Titles for folder paths: the last part of the path. When two paths share the last part, each one
 * gets more parts from the end until the titles differ. A path never shows its full home folder.
 */
export function folderTitles(paths: readonly string[]): Map<string, string> {
  const parts = new Map(paths.map((p) => [p, folderParts(p)] as const));
  const depth = new Map<string, number>(paths.map((p) => [p, 1]));
  const title = (p: string) => {
    const ps = parts.get(p)!;
    const n = Math.min(depth.get(p)!, ps.length);
    return ps.length === 0 ? "/" : ps.slice(ps.length - n).join("/");
  };
  for (let round = 0; round < 64; round++) {
    const byTitle = new Map<string, string[]>();
    for (const p of paths) byTitle.set(title(p), [...(byTitle.get(title(p)) ?? []), p]);
    let grew = false;
    for (const group of byTitle.values()) {
      if (group.length < 2) continue;
      for (const p of group) {
        if (depth.get(p)! < parts.get(p)!.length) {
          depth.set(p, depth.get(p)! + 1);
          grew = true;
        }
      }
    }
    if (!grew) break;
  }
  return new Map(paths.map((p) => [p, title(p)] as const));
}

/** Sections in display order. Items keep their sorted order inside a section. */
export function groupBoard(items: BoardItem[], by: GroupBy): BoardSection[] {
  if (by === "status") {
    return BUCKETS.map((b) => ({ key: b, title: BUCKET_LABEL[b], bucket: b, data: items.filter((i) => i.bucket === b) })).filter(
      (s) => s.data.length > 0,
    );
  }
  if (by === "folder") return groupByFolder(items);
  if (by === "workspace") return groupByWorkspace(items);
  const sections = new Map<string, BoardSection>();
  for (const i of items) {
    const s = sections.get(i.hostId) ?? { key: i.hostId, title: i.hostName, data: [] };
    s.data.push(i);
    sections.set(i.hostId, s);
  }
  return [...sections.values()];
}

/** One section per folder across all computers. Agents with no folder go last. */
function groupByFolder(items: BoardItem[]): BoardSection[] {
  const byPath = new Map<string, BoardItem[]>();
  const none: BoardItem[] = [];
  for (const i of items) {
    const path = folderPath(i.agent.cwd);
    if (!path) none.push(i);
    else byPath.set(path, [...(byPath.get(path) ?? []), i]);
  }
  const titles = folderTitles([...byPath.keys()]);
  const out: BoardSection[] = [...byPath].map(([path, data]) => ({ key: `dir:${path}`, title: titles.get(path)!, data }));
  if (none.length > 0) out.push({ key: NO_FOLDER_KEY, title: "No folder", data: none });
  return out;
}

/**
 * One section per workspace name across all computers (trimmed, case-insensitive). A name on one
 * computer keeps the "<computer> · <workspace>" title and its menu. A name on more computers shows
 * the workspace name with the computers as the subtitle.
 */
function groupByWorkspace(items: BoardItem[]): BoardSection[] {
  type Group = { label: string; hosts: Map<string, string>; ids: Set<string>; data: BoardItem[] };
  const groups = new Map<string, Group>();
  for (const i of items) {
    const key = workspaceKey(i.workspace);
    const g: Group = groups.get(key) ?? { label: i.workspace.trim() || i.workspace, hosts: new Map(), ids: new Set(), data: [] };
    g.hosts.set(i.hostId, i.hostName);
    g.ids.add(i.agent.workspace_id);
    g.data.push(i);
    groups.set(key, g);
  }
  return [...groups].map(([key, g]) => {
    const names = [...g.hosts.values()];
    if (g.hosts.size === 1 && g.ids.size === 1) {
      const [hostId] = g.hosts.keys();
      return { key, title: `${names[0]} · ${g.label}`, workspace: { hostId, workspaceId: [...g.ids][0] }, data: g.data };
    }
    const subtitle = names.length <= 2 ? names.join(", ") : `${names.length} computers`;
    return { key, title: g.label, subtitle, data: g.data };
  });
}

/**
 * Updates the app's own status start times: a pane whose status changed (or is new) starts now.
 * Panes that are gone are dropped. Returns `prev` itself when nothing changed.
 */
export function trackFirstSeen(
  prev: Record<string, { status: AgentStatus; at: number }>,
  current: { key: string; status: AgentStatus }[],
  now: number,
): Record<string, { status: AgentStatus; at: number }> {
  let changed = Object.keys(prev).length !== current.length;
  const next: Record<string, { status: AgentStatus; at: number }> = {};
  for (const { key, status } of current) {
    const old = prev[key];
    if (old && old.status === status) next[key] = old;
    else {
      next[key] = { status, at: now };
      changed = true;
    }
  }
  return changed ? next : prev;
}
