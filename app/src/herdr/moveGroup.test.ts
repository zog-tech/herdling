import type { CoreGroup } from "@herdling/protocol";

import { canMove, groupNameError, moveParams, moveTargetLabel, moveTargets } from "./moveGroup";

const hello = { methods: ["pane.move"] };
const g = (workspace_id: string, label: string, source: CoreGroup["source"]): CoreGroup => ({ workspace_id, label, source, terminals: 1, agents: 1, agent_status: "idle" });

test("only a Herdr 2 terminal in no space moves, on a host with pane.move", () => {
  expect(canMove({ pane_id: "hc:t1", group_source: "repo" }, hello)).toBe(true);
  expect(canMove({ pane_id: "hc:t1", group_source: "label" }, hello)).toBe(true);
  expect(canMove({ pane_id: "hc:t1", group_source: "folder" }, hello)).toBe(true);
  expect(canMove({ pane_id: "hc:t1", group_source: "space" }, hello)).toBe(false);
  expect(canMove({ pane_id: "hc:t1" }, hello)).toBe(false);
  expect(canMove({ pane_id: "w1:p1", group_source: "repo" }, hello)).toBe(false);
  expect(canMove({ pane_id: "hc:t1", group_source: "repo" }, { methods: ["hello"] })).toBe(false);
  expect(canMove({ pane_id: "hc:t1", group_source: "repo" }, undefined)).toBe(false);
});

test("targets: spaces and label groups but not the current one, then new, name and clear", () => {
  const groups = [g("hc:space:b", "web", "space"), g("hc:g:api", "api", "repo"), g("hc:g:clips", "Clips", "label"), g("hc:space:a", "Payments", "space")];
  const t = moveTargets(groups, { workspace_id: "hc:g:clips", group_source: "label" });
  expect(t.map(moveTargetLabel)).toEqual(["Payments", "web", "New space", "Name a group…", "Remove the group name"]);
  expect(moveTargets(groups, { workspace_id: "hc:g:api", group_source: "repo" }).map(moveTargetLabel)).toEqual([
    "Clips",
    "Payments",
    "web",
    "New space",
    "Name a group…",
  ]);
});

test("params and group names", () => {
  expect(moveParams("hc:t1", { kind: "space", workspaceId: "hc:space:a", label: "Payments" })).toEqual({ pane_id: "hc:t1", workspace_id: "hc:space:a" });
  expect(moveParams("hc:t1", { kind: "new" })).toEqual({ pane_id: "hc:t1", new_space: true });
  expect(moveParams("hc:t1", { kind: "name" }, "  Clips ")).toEqual({ pane_id: "hc:t1", group: "Clips" });
  expect(moveParams("hc:t1", { kind: "clear" })).toEqual({ pane_id: "hc:t1", group: "" });
  expect(groupNameError("Clips")).toBeUndefined();
  expect(groupNameError("")).toBeUndefined();
  expect(groupNameError("x".repeat(65))).toMatch(/64/);
  expect(groupNameError("a\nb")).toMatch(/one line/);
});
