/**
 * Terminals: herdr panes with no agent in them, for example a plain shell that New session started.
 * The board lists them after the agents, and the session screen shows them in Terminal mode only.
 */
import type { PaneInfo, Snapshot } from "./snapshot";
import { basename } from "./startSession";

const nonEmpty = (s: string | null | undefined): string | undefined => (s && s.trim() ? s.trim() : undefined);

/** True when the pane hosts an agent: herdr lists it in `agents`, or the pane carries an agent kind. */
function hasAgent(snapshot: Pick<Snapshot, "agents">, pane: PaneInfo): boolean {
  return !!pane.agent || snapshot.agents.some((a) => a.pane_id === pane.pane_id);
}

/** The panes of the snapshot that host no agent, in snapshot order. */
export function terminalPanes(snapshot: Pick<Snapshot, "agents" | "panes">): PaneInfo[] {
  return snapshot.panes.filter((p) => !hasAgent(snapshot, p));
}

/** The pane `paneId` when it is a terminal (no agent), else undefined. */
export function terminalPane(snapshot: Pick<Snapshot, "agents" | "panes"> | undefined, paneId: string): PaneInfo | undefined {
  const pane = snapshot?.panes.find((p) => p.pane_id === paneId);
  return pane && snapshot && !hasAgent(snapshot, pane) ? pane : undefined;
}

/**
 * True when the session screen shows the pane as a terminal only. An agent in the pane always gets
 * the agent layout. A pane where the app just started an agent (`expected` "agent") keeps the agent
 * layout while the snapshot lags. A new shell (`expected` "shell") is a terminal before the snapshot
 * shows its pane. Other panes follow the snapshot: no agent means a terminal.
 */
export function showsTerminal(
  snapshot: Pick<Snapshot, "agents" | "panes"> | undefined,
  paneId: string,
  expected?: "agent" | "shell",
): boolean {
  if (snapshot?.agents.some((a) => a.pane_id === paneId)) return false;
  if (expected === "agent") return false;
  if (terminalPane(snapshot, paneId)) return true;
  return expected === "shell" && !snapshot?.panes.some((p) => p.pane_id === paneId);
}

/** The folder of the terminal: the folder herdr reports for the pane, else the folder of its foreground process. */
export const terminalFolder = (pane: PaneInfo): string | undefined => nonEmpty(pane.cwd) ?? nonEmpty(pane.foreground_cwd);

/** The name of a terminal: the pane label, else the terminal title, else the last part of its folder. */
export function terminalTitle(pane: PaneInfo): string {
  const folder = terminalFolder(pane);
  return nonEmpty(pane.label) ?? nonEmpty(pane.terminal_title_stripped) ?? (folder ? basename(folder) : undefined) ?? "Terminal";
}

export type BoardTerminal = {
  /** `hostId:paneId`. */
  key: string;
  hostId: string;
  hostName: string;
  paneId: string;
  title: string;
  folder?: string;
};

/** The home folder of a user, as `folderTitles` in `board/buckets` finds it. */
const HOME = /^(?:\/Users|\/home)\/[^/]+(?=\/|$)/;

/** The second line of a board terminal: the host first when there is more than one host, then the folder with "~" for home. */
export function terminalDetail(t: Pick<BoardTerminal, "hostName" | "folder">, multiHost: boolean): string | undefined {
  const folder = t.folder?.replace(HOME, "~");
  const parts = [multiHost ? t.hostName : undefined, folder].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** The terminals of all hosts for the board: host order, then snapshot order. */
export function boardTerminals(hosts: { hostId: string; hostName: string; agents: Snapshot["agents"]; panes: PaneInfo[] }[]): BoardTerminal[] {
  return hosts.flatMap((h) =>
    terminalPanes(h).map((p) => ({
      key: `${h.hostId}:${p.pane_id}`,
      hostId: h.hostId,
      hostName: h.hostName,
      paneId: p.pane_id,
      title: terminalTitle(p),
      folder: terminalFolder(p),
    })),
  );
}
