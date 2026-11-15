import type { AgentInfo, Snapshot } from "@/herdr/snapshot";

import { BANNER_MS, BANNER_START, bannerFromPush, bannerItems, bannerReducer, DEDUPE_MS, type BannerItem, type BannerState } from "./banner";

const agent = (pane_id: string, agent_status: AgentInfo["agent_status"], name?: string): AgentInfo => ({
  pane_id,
  tab_id: "t1",
  workspace_id: "w1",
  agent: "claude",
  agent_status,
  ...(name ? { name } : {}),
});
const snap = (...agents: AgentInfo[]): Snapshot => ({ agents, workspaces: [], tabs: [], panes: [] });
const all = () => true;
const item = (paneId: string, kind: BannerItem["kind"] = "blocked"): BannerItem => ({
  key: `h1:${paneId}:${kind}`,
  hostId: "h1",
  paneId,
  kind,
  title: paneId,
  detail: "",
});

describe("bannerItems", () => {
  test("blocked_and_finished_transitions", () => {
    const prev = snap(agent("p1", "working", "fix login"), agent("p2", "working"), agent("p3", "idle"), agent("p4", "idle"));
    const next = snap(agent("p1", "blocked", "fix login"), agent("p2", "done"), agent("p3", "done"), agent("p4", "idle"), agent("p5", "blocked"));
    const items = bannerItems("h1", "studio", prev, next);
    expect(items.map((i) => [i.paneId, i.kind])).toEqual([
      ["p1", "blocked"],
      ["p2", "done"],
    ]);
    expect(items[0]).toMatchObject({ title: "fix login needs you", detail: "studio · claude", key: "h1:p1:blocked" });
  });

  test("first_snapshot_gives_none", () => {
    expect(bannerItems("h1", "studio", undefined, snap(agent("p1", "blocked")))).toEqual([]);
  });
});

test("banner_from_push", () => {
  expect(bannerFromPush({ hostId: "h1", paneId: "p1" }, "api needs you", "claude")).toMatchObject({ kind: "blocked", key: "h1:p1:blocked", detail: "claude" });
  expect(bannerFromPush({ hostId: "h1", paneId: "p1", kind: "shell" }, "make finished", "")?.kind).toBe("shell");
  expect(bannerFromPush({ hostId: "h1", paneId: "p1" }, "api finished", null)?.kind).toBe("done");
  expect(bannerFromPush({ foo: 1 }, "x", "y")).toBeNull();
});

describe("bannerReducer", () => {
  const arrive = (s: BannerState, items: BannerItem[], now = 1_000, allowed: (i: BannerItem) => boolean = all) => bannerReducer(s, { type: "arrive", items, now, allowed });

  test("shows_one_and_queues_the_rest_in_order", () => {
    const r = arrive(BANNER_START, [item("p1"), item("p2")]);
    expect(r.state.current?.paneId).toBe("p1");
    expect(r.state.queue.map((q) => q.paneId)).toEqual(["p2"]);
    expect(r.effects).toEqual([{ type: "timer", gen: 1, ms: BANNER_MS }, { type: "haptic" }]);
    const t = bannerReducer(r.state, { type: "timeout", gen: 1 });
    expect(t.state.current).toMatchObject({ paneId: "p2", gen: 2 });
    expect(bannerReducer(t.state, { type: "dismiss", gen: 2 }).state.current).toBeUndefined();
  });

  test("stale_timeout_is_ignored", () => {
    const r = arrive(BANNER_START, [item("p1"), item("p2")]);
    const t = bannerReducer(r.state, { type: "dismiss", gen: 1 });
    const stale = bannerReducer(t.state, { type: "timeout", gen: 1 });
    expect(stale.state).toBe(t.state);
    expect(stale.effects).toEqual([]);
  });

  test("dedupe_within_the_window", () => {
    const r = arrive(BANNER_START, [item("p1")], 1_000);
    const same = arrive(r.state, [item("p1")], 2_000);
    expect(same.state.queue).toEqual([]);
    const done = bannerReducer(r.state, { type: "dismiss", gen: 1 }).state;
    expect(arrive(done, [item("p1")], 1_000 + DEDUPE_MS + 1).state.current?.paneId).toBe("p1");
  });

  test("open_session_is_filtered_and_opening_drops_its_banners", () => {
    const r = arrive(BANNER_START, [item("p1"), item("p2")], 1_000, (i) => i.paneId !== "p2");
    expect(r.state.queue).toEqual([]);
    const two = arrive(r.state, [item("p3")], 1_100);
    const opened = bannerReducer(two.state, { type: "opened", hostId: "h1", paneId: "p1" });
    expect(opened.state.current?.paneId).toBe("p3");
  });

  test("a_newer_banner_of_the_same_pane_replaces_the_waiting_one", () => {
    const r = arrive(BANNER_START, [item("p1"), item("p2", "blocked")]);
    const r2 = arrive(r.state, [item("p2", "done")], 1_200);
    expect(r2.state.queue.map((q) => q.kind)).toEqual(["done"]);
  });
});
