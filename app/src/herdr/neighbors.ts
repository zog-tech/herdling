import type { Snapshot } from "./snapshot";

/**
 * The agents next to `paneId` in its workspace, ordered by tab number, then by the pane's index in `s.panes`.
 * No wrap-around: the first agent has no `prev`, the last has no `next`.
 */
export function neighborAgents(s: Snapshot, paneId: string): { prev?: string; next?: string } {
  const self = s.agents.find((a) => a.pane_id === paneId);
  if (!self) return {};
  const tabNumber = new Map(s.tabs.map((t) => [t.tab_id, t.number]));
  const paneIndex = new Map(s.panes.map((p, i) => [p.pane_id, i]));
  const order = (id: string, tabId: string): [number, number] => [
    tabNumber.get(tabId) ?? Number.MAX_SAFE_INTEGER,
    paneIndex.get(id) ?? Number.MAX_SAFE_INTEGER,
  ];
  const list = s.agents
    .filter((a) => a.workspace_id === self.workspace_id)
    .map((a) => ({ id: a.pane_id, key: order(a.pane_id, a.tab_id) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
  const i = list.findIndex((a) => a.id === paneId);
  return { prev: list[i - 1]?.id, next: list[i + 1]?.id };
}
