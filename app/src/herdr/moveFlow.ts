/**
 * The "Move to space…" sheets: load the groups, pick a target in the menu sheet (the spaces with
 * their group tiles, then "New space", "Name a group…" and "Remove the group name"), type a group
 * name when asked, then `pane.move`. The rules are in `moveGroup.ts`. The board refreshes from the event stream.
 */
import type { GroupsList, PaneMove } from "@herdling/protocol";
import { Plus, Tag, X, type LucideIcon } from "lucide-react-native";
import { createElement } from "react";
import { Alert } from "react-native";

import type { RpcClient } from "@/rpc/RpcClient";
import { icon } from "@/theme/tokens";
import { GroupTile } from "@/ui/GroupTile";
import * as haptics from "@/ui/haptics";
import { showMenu, type MenuItem } from "@/ui/MenuSheet";
import { promptText } from "@/ui/nativeSheet";

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

/** The icon of a target that is not a space. */
const TARGET_ICON: Record<Exclude<MoveTarget["kind"], "space">, LucideIcon> = { new: Plus, name: Tag, clear: X };

/** The size of the group tile at the left of a space row: as large as a menu icon. */
const TILE = icon.md;

export async function moveToGroup(rpc: Rpc, agent: Pick<AgentInfo, "pane_id" | "workspace_id" | "group_source">): Promise<void> {
  let groups: GroupsList["groups"] = [];
  try {
    groups = (await rpc.call<GroupsList>("groups.list")).groups ?? [];
  } catch {
    // No list: the sheet still offers a new space and a group name.
  }
  const targets = moveTargets(groups, agent);
  const pick = (t: MoveTarget) => {
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
  };
  const item = (t: MoveTarget): MenuItem =>
    t.kind === "space"
      ? { label: moveTargetLabel(t), leading: createElement(GroupTile, { name: t.label, size: TILE }), onPick: () => pick(t) }
      : { label: moveTargetLabel(t), Icon: TARGET_ICON[t.kind], onPick: () => pick(t) };
  const spaces = targets.filter((t) => t.kind === "space");
  const others = targets.filter((t) => t.kind !== "space");
  showMenu({
    title: "Move to space",
    sections: [
      { title: "Spaces", items: spaces.map(item) },
      { items: others.map(item) },
    ],
  });
}
