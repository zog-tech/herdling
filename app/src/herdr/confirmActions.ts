import type { Hello } from "@herdling/protocol";
import { Alert } from "react-native";

import { RpcError, type RpcClient } from "@/rpc/RpcClient";
import * as haptics from "@/ui/haptics";
import { showActionSheet } from "@/ui/nativeSheet";

import { expectPane } from "./expectedPanes";
import {
  canResume,
  closeAgent,
  paneSession,
  RESTART_AFTER_CLOSE,
  restartAgent,
  restartArgs,
  startRestarted,
  type RestartPlan,
} from "./sessionActions";
import type { AgentInfo } from "./snapshot";

type Rpc = Pick<RpcClient, "call">;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A second sheet with one destructive button; resolves true when the user picks it. */
export function confirmDestructive(title: string, detail: string, action: string): Promise<boolean> {
  haptics.warn();
  return new Promise((resolve) =>
    showActionSheet(
      { title, message: detail, options: [action, "Cancel"], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => resolve(i === 0),
    ),
  );
}

/** After a restart whose old pane did not close: say so, and offer to close it again. */
export function offerCloseOld(rpc: Rpc, paneId: string, error: string) {
  Alert.alert("The old agent is still running", `Can't close it: ${error}`, [
    { text: "Keep it", style: "cancel" },
    {
      text: "Close it",
      style: "destructive",
      onPress: () => closeAgent(rpc, paneId).catch((e) => offerCloseOld(rpc, paneId, message(e))),
    },
  ]);
}

/** The restart choices of the sheet. */
export type RestartChoice = "keep" | "fresh" | "options";

/** The labels of the restart sheet, in order. Without a session to keep, the first one is left out. */
export function restartOptions(canKeep: boolean): { label: string; choice: RestartChoice }[] {
  return [
    ...(canKeep ? [{ label: "Restart and keep the conversation", choice: "keep" as const }] : []),
    { label: "Restart with a new conversation", choice: "fresh" },
    { label: "Restart with options…", choice: "options" },
  ];
}

/**
 * Asks how to restart: keep the conversation (only when `canKeep`), a new conversation, or with
 * other start options. Undefined when the user cancels.
 */
export function chooseRestart(canKeep: boolean): Promise<RestartChoice | undefined> {
  haptics.warn();
  const items = restartOptions(canKeep);
  return new Promise((resolve) =>
    showActionSheet(
      {
        title: "Restart this agent?",
        message: "The agent starts again in a new tab, with the start options of this agent. This pane closes.",
        options: [...items.map((i) => i.label), "Cancel"],
        cancelButtonIndex: items.length,
      },
      (i) => resolve(items[i]?.choice),
    ),
  );
}

/**
 * The session to keep for a restart of `agent`: only when the host can resume its kind
 * (`canResume`) and `thread.resolve` finds its session. Else undefined.
 */
export async function sessionToKeep(rpc: Rpc, hello: Hello | undefined, agent: AgentInfo): Promise<string | undefined> {
  const kind = agent.agent;
  if (!kind || !canResume(hello, kind)) return undefined;
  return paneSession(rpc, agent.pane_id, kind);
}

/** After a kept-conversation restart that closed the old pane but did not start: say so, and offer to try again. */
function offerTryAgain(rpc: Rpc, hostId: string, agent: AgentInfo, args: string[], error: string, opened: (paneId: string) => void) {
  haptics.fail();
  Alert.alert("Can't restart", error, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Try again",
      onPress: () =>
        startRestarted(rpc, agent, args).then(
          ({ paneId }) => {
            expectPane(hostId, paneId, "agent");
            opened(paneId);
          },
          (e) => offerTryAgain(rpc, hostId, agent, args, message(e), opened),
        ),
    },
  ]);
}

/**
 * Restarts `agent` of `hostId` (already chosen) as `plan` says and hands the new pane to `opened`.
 * The new pane expects an agent, so it does not show as a terminal while the snapshot lags. A pane
 * that did not close gets the "still running" offer. A kept conversation whose new agent did not
 * start gets "Try again"; other errors go to the caller.
 */
export async function restartConfirmed(
  rpc: Rpc,
  hostId: string,
  agent: AgentInfo,
  opened: (paneId: string) => void,
  plan: RestartPlan = {},
): Promise<void> {
  const oldPane = agent.pane_id;
  let result: { paneId: string; closeError?: string };
  try {
    result = await restartAgent(rpc, agent, plan);
  } catch (e) {
    if (e instanceof RpcError && e.code === RESTART_AFTER_CLOSE && agent.agent) {
      offerTryAgain(rpc, hostId, agent, restartArgs(agent.agent, plan), e.message, opened);
      return;
    }
    throw e;
  }
  expectPane(hostId, result.paneId, "agent");
  opened(result.paneId);
  if (result.closeError) offerCloseOld(rpc, oldPane, result.closeError);
}
