import { ActionSheetIOS, Alert } from "react-native";

import type { RpcClient } from "@/rpc/RpcClient";

import { closeAgent, restartAgent } from "./sessionActions";
import type { AgentInfo } from "./snapshot";

type Rpc = Pick<RpcClient, "call">;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A second sheet with one destructive button; resolves true when the user picks it. */
export function confirmDestructive(title: string, detail: string, action: string): Promise<boolean> {
  return new Promise((resolve) =>
    ActionSheetIOS.showActionSheetWithOptions(
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

/** Asks to confirm a restart. False when the user cancels. */
export const confirmRestart = () =>
  confirmDestructive("Restart this agent?", "A new agent starts in a new tab. This pane closes.", "Restart");

/**
 * Restarts `agent` (already confirmed) and hands the new pane to `opened`. A pane that did not
 * close gets the "still running" offer.
 */
export async function restartConfirmed(rpc: Rpc, agent: AgentInfo, opened: (paneId: string) => void): Promise<void> {
  const oldPane = agent.pane_id;
  const { paneId, closeError } = await restartAgent(rpc, agent);
  opened(paneId);
  if (closeError) offerCloseOld(rpc, oldPane, closeError);
}
