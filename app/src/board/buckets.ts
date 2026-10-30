import type { AgentPreview, AgentStatus } from "@zogssh/protocol";

import { agentSubtitle, agentTitle, secondaryTitle } from "@/herdr/names";
import type { AgentInfo, PaneInfo, TabInfo, WorkspaceInfo } from "@/herdr/snapshot";

/** Where an agent sits on the Board. */
export type Bucket = "needs_you" | "ready" | "working" | "idle";

/** Board order: what needs the user first, quiet agents last. */
export const BUCKETS: readonly Bucket[] = ["needs_you", "ready", "working", "idle"];

export const BUCKET_LABEL: Record<Bucket, string> = {
  needs_you: "Needs you",
  ready: "Ready",
  working: "Working",
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
  /** The line under the title: activity, question or last reply. */
  line?: string;
};

/** The preview field that fits the bucket: activity while working, the question when blocked, else the last reply. */
export function previewLine(bucket: Bucket, p: AgentPreview | undefined): string | undefined {
  if (!p) return undefined;
  switch (bucket) {
    case "working":
      return p.activity ?? p.last_reply;
    case "needs_you":
      return p.question ?? p.last_reply;
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
      const bucket = bucketOf(agent, seen ? seen[key] : Number.POSITIVE_INFINITY);
      const raw = previews[key];
      const p = raw && raw.status === agent.agent_status ? raw : undefined;
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
  const c: Counts = { needs_you: 0, ready: 0, working: 0, idle: 0 };
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

export type GroupBy = "status" | "host" | "workspace";
export type BoardSection = { key: string; title: string; bucket?: Bucket; data: BoardItem[] };

/** Sections in display order. Items keep their sorted order inside a section. */
export function groupBoard(items: BoardItem[], by: GroupBy): BoardSection[] {
  if (by === "status") {
    return BUCKETS.map((b) => ({ key: b, title: BUCKET_LABEL[b], bucket: b, data: items.filter((i) => i.bucket === b) })).filter(
      (s) => s.data.length > 0,
    );
  }
  const sections = new Map<string, BoardSection>();
  for (const i of items) {
    const key = by === "host" ? i.hostId : `${i.hostId}:${i.agent.workspace_id}`;
    const title = by === "host" ? i.hostName : `${i.hostName} · ${i.workspace}`;
    const s = sections.get(key) ?? { key, title, data: [] };
    s.data.push(i);
    sections.set(key, s);
  }
  // Sections follow their most urgent card.
  return [...sections.values()];
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
