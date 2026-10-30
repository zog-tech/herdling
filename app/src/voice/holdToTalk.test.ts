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

test("release_stops_and_gives_the_trimmed_text", () => {
  const recording = run([{ type: "press" }]).state;
  const released = holdReducer(recording, { type: "release" });
  expect(released.state.phase).toBe("finishing");
  expect(released.effects).toEqual(["stop", "hapticStop"]);
  const done = holdReducer(released.state, { type: "final", text: "  hi there " });
  expect(done.state).toEqual(idle);
  expect(done.effects).toEqual([{ text: "hi there" }]);
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
  expect(sends(sent.effects)).toEqual([{ text: "ok" }]);
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
  expect(r.effects).toEqual(["start", "hapticStart", "stop", "hapticStop"]);
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

test("a_short_tap_latches_and_the_next_tap_stops", () => {
  const latched = run([{ type: "press", at: 1000 }, { type: "release", at: 1200 }]);
  expect(latched.state).toMatchObject({ phase: "recording", latched: true });
  expect(latched.effects).toEqual(["start", "hapticStart"]);
  // The touch ending, a slide or a lost touch do not end a latched recording.
  expect(run([{ type: "move", dx: 200, dy: 0 }, { type: "cancel" }], latched.state).state).toMatchObject({ phase: "recording", latched: true });
  const stopped = run([{ type: "press", at: 3000 }, { type: "release", at: 3100 }], latched.state);
  expect(stopped.state.phase).toBe("finishing");
  expect(stopped.effects).toEqual(["stop", "hapticStop"]);
  expect(sends(holdReducer(stopped.state, { type: "final", text: "ship it" }).effects)).toEqual([{ text: "ship it" }]);
});

test("a_long_hold_still_stops_on_release", () => {
  const r = run([{ type: "press", at: 1000 }, { type: "release", at: 1600 }]);
  expect(r.state.phase).toBe("finishing");
  expect(r.effects).toEqual(["start", "hapticStart", "stop", "hapticStop"]);
});

test("voiceover_toggle_starts_and_stops", () => {
  const on = holdReducer(idle, { type: "toggle" });
  expect(on.state).toMatchObject({ phase: "recording", latched: true });
  const off = holdReducer(on.state, { type: "toggle" });
  expect(off.state.phase).toBe("finishing");
  expect(off.effects).toEqual(["stop", "hapticStop"]);
});

test("force_cancel_ends_a_latched_recording", () => {
  const latched = run([{ type: "toggle" }]).state;
  expect(holdReducer(latched, { type: "cancel", force: true }).state.phase).toBe("idle");
});

test("failed_transcription_keeps_the_recording_until_retry_or_discard", () => {
  const finishing = run([{ type: "toggle" }, { type: "toggle" }]).state;
  const failed = holdReducer(finishing, { type: "failed" });
  expect(failed.state.phase).toBe("failed");
  expect(failed.effects).toEqual([]);
  // The mic, a gesture cancel and a stray error do not touch it.
  expect(run([{ type: "press" }, { type: "cancel" }, { type: "error" }], failed.state).state.phase).toBe("failed");
  const retry = holdReducer(failed.state, { type: "retry" });
  expect(retry.state.phase).toBe("finishing");
  expect(retry.effects).toEqual(["retry"]);
  expect(sends(holdReducer(retry.state, { type: "final", text: "ok" }).effects)).toEqual([{ text: "ok" }]);
  const discard = holdReducer(failed.state, { type: "discard" });
  expect(discard).toEqual({ state: idle, effects: ["discard"] });
  // ✕ (a forced cancel) discards too.
  expect(holdReducer(failed.state, { type: "cancel", force: true })).toEqual({ state: idle, effects: ["discard"] });
});

test("halt_stops_and_transcribes_what_was_recorded", () => {
  const latched = run([{ type: "toggle" }]).state;
  const halted = holdReducer(latched, { type: "halted" });
  expect(halted.state).toMatchObject({ phase: "finishing", latched: false });
  expect(halted.effects).toEqual(["stop"]);
  // Too late (idle, finishing): nothing.
  expect(holdReducer(halted.state, { type: "halted" }).effects).toEqual([]);
  expect(holdReducer(idle, { type: "halted" })).toEqual({ state: idle, effects: [] });
});
