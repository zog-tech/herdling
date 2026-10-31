import type { AgentStatus } from "@herdling/protocol";

/** Subset of herdr `session.snapshot` the app uses. Extra fields from herdr are kept as they come. */
export type AgentInfo = {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  agent: string;
  agent_status: AgentStatus;
  cwd?: string;
  state_change_seq: number;
  terminal_title_stripped?: string;
  /** The agent's own name (`agent.rename`); null or missing when it has none. */
  name?: string | null;
  /** Agent kind as herdr shows it, when it differs from `agent`. */
  display_agent?: string | null;
};
export type WorkspaceInfo = {
  workspace_id: string;
  label: string;
  number: number;
  agent_status: AgentStatus;
  tab_count?: number;
};
export type TabInfo = {
  tab_id: string;
  workspace_id: string;
  label: string;
  number: number;
  agent_status: AgentStatus;
};
export type PaneInfo = {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  /** The pane's own label (`pane.rename`); null or missing when it has none. */
  label?: string | null;
};

export type Snapshot = {
  agents: AgentInfo[];
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  /** Set when an event could not be applied exactly; the owner should refetch. */
  stale?: boolean;
};

/** A line from `herdr.subscribe`: herdr's `{"event": name, "data": {...}}`. */
export type HerdrEvent = { event?: string; data?: Record<string, unknown>; closed?: boolean };

export const EMPTY_SNAPSHOT: Snapshot = { agents: [], workspaces: [], tabs: [], panes: [] };

/** Reads the `snapshot` object from a `session.snapshot` result (also accepts the bare object). */
export function parseSnapshot(result: unknown): Snapshot {
  const r = (result ?? {}) as Record<string, unknown>;
  const s = ((r.snapshot as Record<string, unknown> | undefined) ?? r) as Partial<Snapshot>;
  return {
    agents: s.agents ?? [],
    workspaces: s.workspaces ?? [],
    tabs: s.tabs ?? [],
    panes: s.panes ?? [],
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function upsert<T>(list: T[], item: T, key: (t: T) => string): T[] {
  const k = key(item);
  return list.some((x) => key(x) === k) ? list.map((x) => (key(x) === k ? { ...x, ...item } : x)) : [...list, item];
}

function removePanes(s: Snapshot, drop: (p: { pane_id: string; tab_id: string; workspace_id: string }) => boolean): Snapshot {
  return {
    ...s,
    agents: s.agents.filter((a) => !drop(a)),
    panes: s.panes.filter((p) => !drop(p)),
  };
}

/**
 * Applies one herdr event. Event names may use dots or underscores.
 * Events the reducer cannot apply exactly set `stale`, so the caller refetches.
 */
export function applyEvent(s: Snapshot, e: HerdrEvent): Snapshot {
  const name = (e.event ?? str(e.data?.type) ?? "").replace(/\./g, "_");
  const d = e.data ?? {};
  switch (name) {
    case "pane_agent_status_changed": {
      const paneId = str(d.pane_id);
      const status = str(d.agent_status) as AgentStatus | undefined;
      if (!paneId || !status || !s.agents.some((a) => a.pane_id === paneId)) return { ...s, stale: true };
      // The event carries no state_change_seq, so the exact value comes from the next refetch.
      return { ...s, stale: true, agents: s.agents.map((a) => (a.pane_id === paneId ? { ...a, agent_status: status } : a)) };
    }
    case "pane_agent_detected": {
      const paneId = str(d.pane_id);
      if (paneId && (d.released === true || d.agent == null)) return { ...removeAgent(s, paneId), stale: true };
      return { ...s, stale: true };
    }
    case "pane_closed": {
      const paneId = str(d.pane_id);
      // Stale too: a refetch already in flight must not bring the pane back.
      return paneId ? { ...removePanes(s, (p) => p.pane_id === paneId), stale: true } : { ...s, stale: true };
    }
    case "tab_created": {
      const tab = d.tab as TabInfo | undefined;
      return tab ? { ...s, tabs: upsert(s.tabs, tab, (t) => t.tab_id) } : { ...s, stale: true };
    }
    case "tab_closed": {
      const tabId = str(d.tab_id);
      if (!tabId) return { ...s, stale: true };
      return {
        ...removePanes(s, (p) => p.tab_id === tabId),
        tabs: s.tabs.filter((t) => t.tab_id !== tabId),
        stale: true,
      };
    }
    case "workspace_created": {
      const ws = d.workspace as WorkspaceInfo | undefined;
      return ws ? { ...s, workspaces: upsert(s.workspaces, ws, (w) => w.workspace_id) } : { ...s, stale: true };
    }
    case "workspace_renamed": {
      const id = str(d.workspace_id);
      const label = str(d.label);
      if (!id || label === undefined) return { ...s, stale: true };
      return { ...s, workspaces: s.workspaces.map((w) => (w.workspace_id === id ? { ...w, label } : w)) };
    }
    case "workspace_closed": {
      const id = str(d.workspace_id) ?? str((d.workspace as { workspace_id?: unknown } | null)?.workspace_id);
      if (!id) return { ...s, stale: true };
      return {
        ...removePanes(s, (p) => p.workspace_id === id),
        workspaces: s.workspaces.filter((w) => w.workspace_id !== id),
        tabs: s.tabs.filter((t) => t.workspace_id !== id),
        stale: true,
      };
    }
    default:
      return { ...s, stale: true };
  }
}

function removeAgent(s: Snapshot, paneId: string): Snapshot {
  return { ...s, agents: s.agents.filter((a) => a.pane_id !== paneId) };
}

/** Key of one pane across hosts, used for last-seen tracking. */
export const paneKey = (hostId: string, paneId: string) => `${hostId}:${paneId}`;

export type NeedsYou = { hostId: string; agent: AgentInfo };

/**
 * Agents that wait for the user: `blocked` first, then `idle`/`done` agents whose
 * `state_change_seq` is newer than the last-seen value. Newest first within each group.
 */
export function needsYou(
  hosts: { hostId: string; snapshot: Snapshot }[],
  seen: Record<string, number>,
): NeedsYou[] {
  const blocked: NeedsYou[] = [];
  const finished: NeedsYou[] = [];
  for (const { hostId, snapshot } of hosts) {
    for (const agent of snapshot.agents) {
      if (agent.agent_status === "blocked") blocked.push({ hostId, agent });
      else if (
        (agent.agent_status === "idle" || agent.agent_status === "done") &&
        agent.state_change_seq > (seen[paneKey(hostId, agent.pane_id)] ?? 0)
      )
        finished.push({ hostId, agent });
    }
  }
  const newest = (a: NeedsYou, b: NeedsYou) => b.agent.state_change_seq - a.agent.state_change_seq;
  return [...blocked.sort(newest), ...finished.sort(newest)];
}
