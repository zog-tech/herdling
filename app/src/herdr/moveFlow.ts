/**
 * The "Move to space…" sheets: load the groups, pick a target, type a group name when asked, then
 * `pane.move`. The rules are in `moveGroup.ts`. The board refreshes from the event stream.
 */
import type { GroupsList, PaneMove } from "@herdling/protocol";
import { Alert } from "react-native";

import type { RpcClient } from "@/rpc/RpcClient";
import * as haptics from "@/ui/haptics";
import { promptText, showActionSheet } from "@/ui/nativeSheet";

import { groupNameError, moveParams, moveTargetLabel, moveTargets, type MoveTarget } from "./moveGroup";
import type { AgentInfo } from "./snapshot";

type Rpc = Pick<RpcClient, "call">;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function send(rpc: Rpc, paneId: string, target: MoveTarget, name?: string): Promise<void> {
  try {
    await rpc.call<PaneMove>("pane.move", moveParams(paneId, target, name));
    haptics.commit();
  } catch (e) {
    haptics.fail();
    Alert.alert("Can't move the terminal", message(e));
  }
}

export async function moveToGroup(rpc: Rpc, agent: Pick<AgentInfo, "pane_id" | "workspace_id" | "group_source">): Promise<void> {
  let groups: GroupsList["groups"] = [];
  try {
    groups = (await rpc.call<GroupsList>("groups.list")).groups ?? [];
  } catch {
    // No list: the sheet still offers a new space and a group name.
  }
  const targets = moveTargets(groups, agent);
  showActionSheet(
    { title: "Move to space", options: [...targets.map(moveTargetLabel), "Cancel"], cancelButtonIndex: targets.length },
    (k) => {
      const t = targets[k];
      if (!t) return;
      if (t.kind !== "name") {
        void send(rpc, agent.pane_id, t);
        return;
      }
      promptText("Name a group", "Herdling shows the terminal in this group. Empty removes the group name.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move",
          onPress: (text?: string) => {
            const err = groupNameError(text ?? "");
            if (err) {
              Alert.alert("Can't use this name", err);
              return;
            }
            void send(rpc, agent.pane_id, t, text ?? "");
          },
        },
      ]);
    },
  );
}
