import type { AgentInfo, Snapshot } from "./snapshot";

/**
 * Names as the herdr apps show them.
 * Title: the agent's own name, else the pane label, else the workspace label (plus
 * " · <tab label>" when the workspace has more than one tab). Without a workspace: the terminal
 * title, the agent kind or the pane id. The companion builds push titles with the same rule.
 */

type Names = Pick<Snapshot, "workspaces" | "tabs" | "panes">;
type Agent = Pick<AgentInfo, "pane_id" | "tab_id" | "workspace_id" | "agent" | "terminal_title_stripped" | "name" | "display_agent">;

const nonEmpty = (s: string | null | undefined): string | undefined => (s && s.trim() ? s : undefined);

/** Workspace label, plus " · <tab label>" when the workspace has more than one tab. */
export function placeName(snapshot: Names, agent: Pick<AgentInfo, "workspace_id" | "tab_id">): string | undefined {
  const ws = snapshot.workspaces.find((w) => w.workspace_id === agent.workspace_id);
  const label = nonEmpty(ws?.label);
  if (!ws || !label) return undefined;
  const tabs = ws.tab_count ?? snapshot.tabs.filter((t) => t.workspace_id === ws.workspace_id).length;
  const tab = nonEmpty(snapshot.tabs.find((t) => t.tab_id === agent.tab_id)?.label);
  return tabs > 1 && tab ? `${label} · ${tab}` : label;
}

/** The agent's own name or the pane label, if one is set. */
export function ownName(snapshot: Pick<Snapshot, "panes">, agent: Pick<AgentInfo, "pane_id" | "name">): string | undefined {
  return nonEmpty(agent.name) ?? nonEmpty(snapshot.panes.find((p) => p.pane_id === agent.pane_id)?.label);
}

export function agentTitle(snapshot: Names, agent: Agent): string {
  return (
    ownName(snapshot, agent) ??
    placeName(snapshot, agent) ??
    nonEmpty(agent.terminal_title_stripped) ??
    nonEmpty(agent.agent) ??
    agent.pane_id
  );
}

/** Agent kind as herdr shows it. */
export function agentKind(agent: Pick<AgentInfo, "agent" | "display_agent">): string {
  return nonEmpty(agent.display_agent) ?? agent.agent;
}

/** "<host> · <agent kind>". */
export function agentSubtitle(hostName: string, agent: Pick<AgentInfo, "agent" | "display_agent">): string {
  const kind = agentKind(agent);
  return kind ? `${hostName} · ${kind}` : hostName;
}

/** The terminal title, when it adds something the title does not already say. */
export function secondaryTitle(snapshot: Names, agent: Agent): string | undefined {
  const t = nonEmpty(agent.terminal_title_stripped);
  return t && t !== agentTitle(snapshot, agent) ? t : undefined;
}
