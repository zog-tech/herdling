import type { CoreGroup } from "@herdling/protocol";

import { firstChoice, groupsReducer, initialGroups, NEW_SPACE, spaceChoices, spaceDetail, startsOnCore } from "./spacePick";

const g = (workspace_id: string, label: string, source: CoreGroup["source"]): CoreGroup => ({
  workspace_id,
  label,
  source,
  terminals: 1,
  agents: 1,
  agent_status: "idle",
});

const groups = [g("hc:space:b", "web", "space"), g("hc:g:api", "api", "repo"), g("hc:space:a", "Payments", "space"), g("hc:g:x", "Clips", "label")];

test("startsOnCore needs session.start and a core", () => {
  expect(startsOnCore({ methods: ["session.start"], backends: { core: { version: "0.1.20", generation: 1 } } })).toBe(true);
  expect(startsOnCore({ methods: ["session.start"], backends: {} })).toBe(false);
  expect(startsOnCore({ methods: ["hello"], backends: { core: { version: "0.1.20", generation: 1 } } })).toBe(false);
  expect(startsOnCore(undefined)).toBe(false);
});

test("spaceChoices lists new space, then spaces and label groups by name", () => {
  expect(spaceChoices(groups)).toEqual([NEW_SPACE, { id: "hc:g:x", label: "Clips" }, { id: "hc:space:a", label: "Payments" }, { id: "hc:space:b", label: "web" }]);
  expect(spaceChoices([])).toEqual([NEW_SPACE]);
});

test("firstChoice takes the asked space, else the space of an agent in the folder, else new", () => {
  const choices = spaceChoices(groups);
  const snap = { agents: [{ pane_id: "hc:t1", tab_id: "x", workspace_id: "hc:space:b", agent_status: "idle" as const, cwd: "/home/sam/proj/web/" }] };
  expect(firstChoice(choices, snap, "/home/sam/proj/web", "hc:space:a")).toBe("hc:space:a");
  expect(firstChoice(choices, snap, "/home/sam/proj/web", "hc:space:gone")).toBe("hc:space:b");
  expect(firstChoice(choices, snap, "/home/sam/proj/api")).toBeNull();
  expect(firstChoice(choices, undefined, undefined)).toBeNull();
});

describe("groupsReducer", () => {
  it("loads with a generation and drops old answers", () => {
    const a = groupsReducer(initialGroups, { type: "load" });
    expect(a).toEqual({ state: { kind: "loading", gen: 1 }, effects: [{ type: "fetch", gen: 1 }] });
    const b = groupsReducer(a.state, { type: "load" });
    expect(groupsReducer(b.state, { type: "done", gen: 1, groups }).state).toBe(b.state);
    expect(groupsReducer(b.state, { type: "done", gen: 2, groups }).state).toEqual({ kind: "ready", gen: 2, groups });
    expect(groupsReducer(b.state, { type: "fail", gen: 2, error: "x" }).state).toEqual({ kind: "failed", gen: 2, error: "x" });
  });

  it("ignores answers when not loading, and a reset drops a load in flight", () => {
    expect(groupsReducer(initialGroups, { type: "done", gen: 0, groups }).state).toBe(initialGroups);
    const a = groupsReducer(initialGroups, { type: "load" });
    const r = groupsReducer(a.state, { type: "reset" });
    expect(r.state).toEqual({ kind: "idle", gen: 2 });
    expect(groupsReducer(r.state, { type: "done", gen: 1, groups }).state).toBe(r.state);
  });
});

describe("spaceDetail", () => {
  test("says when the spaces load and when the load failed, and nothing else", () => {
    expect(spaceDetail({ kind: "idle", gen: 0 })).toBeUndefined();
    expect(spaceDetail({ kind: "loading", gen: 1 })).toBe("Loading the spaces…");
    expect(spaceDetail({ kind: "failed", gen: 1, error: "x" })).toBe("Can't list the spaces. The session starts in a new space.");
    expect(spaceDetail({ kind: "ready", gen: 1, groups: [] })).toBeUndefined();
  });
});
