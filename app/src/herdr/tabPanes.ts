/**
 * The panes of the tab of one pane, for the pages of the session screen and the tab map. Pure.
 * The order is the order of `snapshot.panes` (herdr sends the panes of a tab in layout order).
 * The snapshot has no pane sizes, so the tab map is a list in this order, not the real layout.
 */
import type { AgentStatus } from "@herdling/protocol";

import { agentKind, agentTitle } from "./names";
import type { Snapshot } from "./snapshot";
import { terminalTitle } from "./terminals";

export type TabPane = {
  pane_id: string;
  title: string;
  /** The agent kind; missing for a terminal (a pane with no agent). */
  kind?: string;
  status?: AgentStatus;
  terminal: boolean;
};

export type TabPanes = { tabId: string; tabLabel?: string; panes: TabPane[]; index: number };

/** The panes of the tab of `paneId`. Null when the snapshot does not hold the pane or its tab has one pane only. */
export function tabPanes(s: Snapshot | undefined, paneId: string): TabPanes | null {
  if (!s) return null;
  const self = s.panes.find((p) => p.pane_id === paneId) ?? s.agents.find((a) => a.pane_id === paneId);
  if (!self) return null;
  const ids = s.panes.filter((p) => p.tab_id === self.tab_id).map((p) => p.pane_id);
  // An agent that the pane list does not hold yet still counts.
  for (const a of s.agents) if (a.tab_id === self.tab_id && !ids.includes(a.pane_id)) ids.push(a.pane_id);
  if (ids.length < 2) return null;
  const panes = ids.map((id): TabPane => {
    const agent = s.agents.find((a) => a.pane_id === id);
    if (agent) return { pane_id: id, title: agentTitle(s, agent), kind: agentKind(agent), status: agent.agent_status, terminal: false };
    const pane = s.panes.find((p) => p.pane_id === id)!;
    return { pane_id: id, title: terminalTitle(pane), terminal: true };
  });
  const tab = s.tabs.find((t) => t.tab_id === self.tab_id);
  return { tabId: self.tab_id, tabLabel: tab?.label || undefined, panes, index: ids.indexOf(paneId) };
}

/** The pane `step` pages from the current one, or undefined at an end (no wrap). */
export function pageTarget(t: TabPanes, step: -1 | 1): string | undefined {
  return t.panes[t.index + step]?.pane_id;
}
