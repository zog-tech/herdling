import { CANCEL_DISTANCE, holdReducer, type HoldEffect, type HoldEvent, type HoldState } from "./holdToTalk";

const idle: HoldState = { phase: "idle", partial: "" };

/** Runs events in order; returns the last state and every effect. */
function run(events: HoldEvent[], from: HoldState = idle) {
  let state = from;
  const effects: HoldEffect[] = [];
  for (const e of events) {
    const r = holdReducer(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

const sends = (effects: HoldEffect[]) => effects.filter((e) => typeof e === "object");

test("press_starts", () => {
  const r = holdReducer(idle, { type: "press" });
  expect(r.state.phase).toBe("recording");
  expect(r.effects).toEqual(["start", "hapticStart"]);
});

test("release_sends_trimmed_final", () => {
  const recording = run([{ type: "press" }]).state;
  const released = holdReducer(recording, { type: "release" });
  expect(released.state.phase).toBe("finishing");
  expect(released.effects).toEqual(["stop"]);
  const done = holdReducer(released.state, { type: "final", text: "  hi there " });
  expect(done.state).toEqual(idle);
  expect(done.effects).toEqual([{ send: "hi there" }, "hapticSend"]);
});

test("release_after_slide_away_cancels", () => {
  const armed = run([{ type: "press" }, { type: "move", dx: 0, dy: -81 }]).state;
  expect(armed.phase).toBe("armedCancel");
  const r = holdReducer(armed, { type: "release" });
  expect(r.state).toEqual(idle);
  expect(r.effects).toEqual(["cancel", "hapticCancel"]);
  // A late final from the native side must not send either.
  const late = run([{ type: "final", text: "hello" }], r.state);
  expect(sends(late.effects)).toEqual([]);
});

test("slide_back_rearms", () => {
  const r = run([{ type: "press" }, { type: "move", dx: 0, dy: -81 }, { type: "move", dx: 0, dy: -10 }]);
  expect(r.state.phase).toBe("recording");
  const sent = run([{ type: "release" }, { type: "final", text: "ok" }], r.state);
  expect(sends(sent.effects)).toEqual([{ send: "ok" }]);
});

test("cancel_distance_is_80_and_any_direction", () => {
  expect(CANCEL_DISTANCE).toBe(80);
  expect(run([{ type: "press" }, { type: "move", dx: 0, dy: -80 }]).state.phase).toBe("recording");
  expect(run([{ type: "press" }, { type: "move", dx: 60, dy: 60 }]).state.phase).toBe("armedCancel");
});

test("empty_transcript_sends_nothing", () => {
  const r = run([{ type: "press" }, { type: "release" }, { type: "final", text: "   " }]);
  expect(r.state).toEqual(idle);
  expect(sends(r.effects)).toEqual([]);
  expect(r.effects).not.toContain("hapticSend");
});

test("error_sends_nothing", () => {
  const recording = run([{ type: "press" }, { type: "partial", text: "say" }]).state;
  const r = holdReducer(recording, { type: "error" });
  expect(r.state).toEqual(idle);
  expect(r.effects).toEqual(["cancel"]);
  // An error after release (stop failed) also sends nothing, and a release after it is ignored.
  const afterRelease = run([{ type: "press" }, { type: "release" }, { type: "error" }, { type: "release" }]);
  expect(afterRelease.state).toEqual(idle);
  expect(sends(afterRelease.effects)).toEqual([]);
});

test("partial_updates_text", () => {
  const r = run([{ type: "press" }, { type: "partial", text: "say" }, { type: "partial", text: "say hi" }]);
  expect(r.state).toEqual({ phase: "recording", partial: "say hi" });
  expect(r.effects).toEqual(["start", "hapticStart"]);
  // Partials keep coming while finishing; ignored when idle.
  expect(run([{ type: "release" }, { type: "partial", text: "say hi there" }], r.state).state.partial).toBe("say hi there");
  expect(holdReducer(idle, { type: "partial", text: "x" }).state).toEqual(idle);
});

test("gesture_cancel_stops_without_send", () => {
  const r = run([{ type: "press" }, { type: "partial", text: "say hi" }, { type: "cancel" }]);
  expect(r.state).toEqual(idle);
  expect(r.effects).toEqual(["start", "hapticStart", "cancel", "hapticCancel"]);
});

test("press_while_busy_is_ignored", () => {
  const finishing = run([{ type: "press" }, { type: "release" }]).state;
  expect(holdReducer(finishing, { type: "press" })).toEqual({ state: finishing, effects: [] });
});
