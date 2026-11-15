/**
 * "Move to space" (spec goal 6): a Herdr 2 terminal in no Herdr app space moves to a space, a new
 * space or a named group with `pane.move`. Pure rules: which entry can move, the targets of the
 * sheet, the params and the check of a group name.
 */
import type { CoreGroup, GroupFields, Hello, PaneMoveParams } from "@herdling/protocol";

/** The longest group name that herdlingd takes. */
export const GROUP_NAME_MAX = 64;

/**
 * True when the entry can move: a Herdr 2 entry in no Herdr app space, on a host that lists
 * `pane.move`. Only Herdr 2 entries have `group_source`, on herdlingd 0.1.x (`hc:` ids) and on
 * 0.2.0 (plain ids). A terminal in a space stays: it is not known if the Herdr app moves it.
 */
export function canMove(entry: GroupFields & { pane_id: string; backend?: string | null }, hello: Pick<Hello, "methods"> | undefined): boolean {
  return !!entry.group_source && entry.group_source !== "space" && (hello?.methods?.includes("pane.move") ?? false);
}

export type MoveTarget =
  | { kind: "space"; workspaceId: string; label: string }
  | { kind: "new" }
  | { kind: "name" }
  | { kind: "clear" };

/** The text of a target in the sheet. */
export function moveTargetLabel(t: MoveTarget): string {
  switch (t.kind) {
    case "space":
      return t.label;
    case "new":
      return "New space";
    case "name":
      return "Name a group…";
    case "clear":
      return "Remove the group name";
  }
}

/**
 * The targets of the sheet: the spaces and the label groups by name (not the current one), "New
 * space", "Name a group…", and "Remove the group name" for a terminal in a label group.
 */
export function moveTargets(groups: readonly CoreGroup[], current: Pick<GroupFields, "group_source"> & { workspace_id: string }): MoveTarget[] {
  const list: MoveTarget[] = groups
    .filter((g) => (g.source === "space" || g.source === "label") && g.workspace_id !== current.workspace_id)
    .map((g) => ({ kind: "space" as const, workspaceId: g.workspace_id, label: g.label.trim() || g.workspace_id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  list.push({ kind: "new" }, { kind: "name" });
  if (current.group_source === "label") list.push({ kind: "clear" });
  return list;
}

/** Why a group name is not good, or undefined. An empty name is good: it removes the label. */
export function groupNameError(name: string): string | undefined {
  if (name.trim().length > GROUP_NAME_MAX) return `Use at most ${GROUP_NAME_MAX} characters.`;
  if (/[\x00-\x1f\x7f]/.test(name)) return "Use one line of text.";
  return undefined;
}

/** The `pane.move` params of a target. `name` is the typed group name of "Name a group…". */
export function moveParams(paneId: string, t: MoveTarget, name = ""): PaneMoveParams {
  switch (t.kind) {
    case "space":
      return { pane_id: paneId, workspace_id: t.workspaceId };
    case "new":
      return { pane_id: paneId, new_space: true };
    case "name":
      return { pane_id: paneId, group: name.trim() };
    case "clear":
      return { pane_id: paneId, group: "" };
  }
}
