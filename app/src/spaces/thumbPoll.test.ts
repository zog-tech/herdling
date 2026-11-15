import { initialThumbs, THUMB_POLL_MS, thumbReducer, thumbText, type ThumbState } from "./thumbPoll";

const run = (s: ThumbState, ...events: Parameters<typeof thumbReducer>[1][]) => {
  let state = s;
  const effects: ReturnType<typeof thumbReducer>["effects"] = [];
  for (const e of events) {
    const r = thumbReducer(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
};

describe("thumbReducer", () => {
  it("reads at once and on each tick of its generation", () => {
    const a = run(initialThumbs, { type: "show", panes: ["p1", "p2"] });
    expect(a.state).toMatchObject({ kind: "polling", gen: 1 });
    expect(a.effects).toEqual([{ type: "cancel" }, { type: "read", gen: 1, panes: ["p1", "p2"] }, { type: "schedule", gen: 1, ms: THUMB_POLL_MS }]);
    expect(run(a.state, { type: "tick", gen: 1 }).effects.map((e) => e.type)).toEqual(["read", "schedule"]);
    // A tick of an old generation does nothing.
    expect(run(a.state, { type: "tick", gen: 0 }).effects).toEqual([]);
  });

  it("does not restart for the same panes", () => {
    const a = run(initialThumbs, { type: "show", panes: ["p1"] });
    expect(run(a.state, { type: "show", panes: ["p1"] }).effects).toEqual([]);
  });

  it("drops a late result after a tab change and after a blur", () => {
    const a = run(initialThumbs, { type: "show", panes: ["p1"] }, { type: "result", gen: 1, paneId: "p1", text: "one" });
    expect(a.state.texts).toEqual({ p1: "one" });
    const b = run(a.state, { type: "show", panes: ["p2"] }, { type: "result", gen: 1, paneId: "p2", text: "late" });
    expect(b.state).toMatchObject({ kind: "polling", gen: 2, texts: {} });
    const c = run(b.state, { type: "hide" }, { type: "result", gen: 2, paneId: "p2", text: "late" });
    expect(c.state).toMatchObject({ kind: "idle", gen: 3 });
    expect(c.effects).toEqual([{ type: "cancel" }]);
    // A result for a pane that is not shown does nothing.
    expect(run(a.state, { type: "result", gen: 1, paneId: "p9", text: "x" }).state).toBe(a.state);
  });

  it("an empty tab is a hide, and a hide when idle does nothing", () => {
    const a = run(initialThumbs, { type: "show", panes: ["p1"] }, { type: "show", panes: [] });
    expect(a.state.kind).toBe("idle");
    expect(run(initialThumbs, { type: "hide" }).effects).toEqual([]);
    expect(run(initialThumbs, { type: "tick", gen: 0 }).effects).toEqual([]);
  });
});

test("thumbText keeps the last rows", () => {
  expect(thumbText("a\nb\nc\n\n\n", 2)).toBe("b\nc");
  expect(thumbText("a", 5)).toBe("a");
});
