import { Alert } from "react-native";

import { allows } from "@/herdr/backend";
import { chooseRestart, restartConfirmed, sessionToKeep } from "@/herdr/confirmActions";
import { moveToGroup } from "@/herdr/moveFlow";
import { canMove } from "@/herdr/moveGroup";
import { renameItems } from "@/herdr/rename";
import { getHostConn } from "@/hosts/connection";
import { rememberedArgs } from "@/newSession/startOptionsMemory";
import type { MenuSpec } from "@/ui/menuRules";

import { agentMenu } from "./agentMenu";
import type { BoardItem } from "./buckets";

/**
 * The actions of one Board agent that need the connection: the agent menu with the actions that
 * this agent and its host support, the restart flow and the route of its space. The Board and the
 * peek sheet share them, so both show the same menu.
 */

/** The handlers that depend on the screen. Leave one out to hide its row. */
export type AgentMenuHandlers = {
  reply?: () => void;
  peek?: () => void;
  openSpace?: () => void;
  markRead?: () => void;
  explain?: () => void;
  restart?: () => void;
};

/** The agent menu for `i`: rename, move and restart show only when the agent and its host can do them. */
export function boardAgentMenu(i: BoardItem, h: AgentMenuHandlers): MenuSpec {
  const { rpc, hello } = getHostConn(i.hostId);
  return agentMenu({
    title: i.title,
    detail: i.subtitle,
    reply: h.reply,
    peek: h.peek,
    openSpace: h.openSpace,
    markRead: i.bucket === "ready" ? h.markRead : undefined,
    renames: rpc && allows(i.agent, "rename", i.hostId) ? renameItems(rpc, i.hostId, i.agent) : [],
    move: rpc && canMove(i.agent, hello) ? () => void moveToGroup(rpc, i.agent) : undefined,
    explain: h.explain,
    // A Herdr 2 agent of an older herdlingd cannot restart.
    restart: allows(i.agent, "restart", i.hostId) ? h.restart : undefined,
  });
}

/** The route of the space of `i`, with its tab selected. */
export function spaceRoute(i: Pick<BoardItem, "hostId" | "agent">) {
  return {
    pathname: "/spaces/[hostId]/[workspaceId]",
    params: { hostId: i.hostId, workspaceId: i.agent.workspace_id, tab: i.agent.tab_id },
  } as const;
}

/**
 * Restarts `i` after the user picks how (keep the conversation, a new one, or other options).
 * `openPane` opens the new pane; `openOptions` opens the restart options screen.
 */
export async function restartAgent(i: BoardItem, openPane: (hostId: string, paneId: string) => void, openOptions: (path: string) => void) {
  const { rpc, hello } = getHostConn(i.hostId);
  if (!rpc || !allows(i.agent, "restart", i.hostId)) return;
  const session = await sessionToKeep(rpc, hello, i.agent);
  const choice = await chooseRestart(!!session);
  if (!choice) return;
  if (choice === "options") {
    openOptions(`/restart/${i.hostId}/${i.agent.pane_id}`);
    return;
  }
  try {
    await restartConfirmed(rpc, i.hostId, i.agent, (paneId) => openPane(i.hostId, paneId), {
      session: choice === "keep" ? session : undefined,
      args: rememberedArgs(i.agent.agent),
      hostId: i.hostId,
    });
  } catch (e) {
    Alert.alert("Can't restart", e instanceof Error ? e.message : String(e));
  }
}
