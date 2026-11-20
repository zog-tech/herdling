import { FAILED_HOLD_MS, SEND_NOW_IDLE, SENT_HOLD_MS, sendNowLabel, sendNowReducer, showsSendNow, type SendNowState } from "./sendNowMachine";

const tap = { type: "tap", working: true } as const;

test("a_tap_while_working_presses_esc_once", () => {
  const r = sendNowReducer(SEND_NOW_IDLE, tap);
  expect(r.state).toEqual({ phase: "sending", gen: 1 });
  expect(r.effects).toEqual([{ type: "pressEsc", gen: 1 }]);
});

test("a_tap_while_not_working_does_nothing", () => {
  expect(sendNowReducer(SEND_NOW_IDLE, { type: "tap", working: false })).toEqual({ state: SEND_NOW_IDLE, effects: [] });
});

test("a_double_tap_sends_one_esc", () => {
  const sending = sendNowReducer(SEND_NOW_IDLE, tap).state;
  expect(sendNowReducer(sending, tap)).toEqual({ state: sending, effects: [] });
  const sent: SendNowState = { phase: "sent", gen: 1 };
  expect(sendNowReducer(sent, tap)).toEqual({ state: sent, effects: [] });
});

test("key_ok_holds_the_lock_then_the_timer_frees_it", () => {
  const r = sendNowReducer({ phase: "sending", gen: 1 }, { type: "keyOk", gen: 1 });
  expect(r.state).toEqual({ phase: "sent", gen: 1 });
  expect(r.effects).toEqual([{ type: "startTimer", gen: 1, ms: SENT_HOLD_MS }, { type: "haptic", kind: "commit" }]);
  expect(sendNowReducer(r.state, { type: "timer", gen: 1 }).state).toEqual({ phase: "idle", gen: 1 });
});

test("key_failed_shows_the_error_and_a_tap_tries_again", () => {
  const r = sendNowReducer({ phase: "sending", gen: 1 }, { type: "keyFailed", gen: 1, error: "offline" });
  expect(r.state).toEqual({ phase: "failed", gen: 1, error: "offline" });
  expect(r.effects).toEqual([{ type: "startTimer", gen: 1, ms: FAILED_HOLD_MS }, { type: "haptic", kind: "fail" }]);
  expect(sendNowLabel(r.state)).toBe("Can't send now: offline");
  const again = sendNowReducer(r.state, tap);
  expect(again.state).toEqual({ phase: "sending", gen: 2 });
  expect(again.effects).toEqual([{ type: "pressEsc", gen: 2 }]);
});

test("results_and_timers_of_an_old_attempt_do_nothing", () => {
  const s: SendNowState = { phase: "sending", gen: 2 };
  expect(sendNowReducer(s, { type: "keyOk", gen: 1 }).state).toBe(s);
  expect(sendNowReducer(s, { type: "keyFailed", gen: 1, error: "x" }).state).toBe(s);
  const sent: SendNowState = { phase: "sent", gen: 2 };
  expect(sendNowReducer(sent, { type: "timer", gen: 1 }).state).toBe(sent);
});

test("impossible_events_do_nothing", () => {
  expect(sendNowReducer(SEND_NOW_IDLE, { type: "keyOk", gen: 0 }).state).toBe(SEND_NOW_IDLE);
  expect(sendNowReducer(SEND_NOW_IDLE, { type: "timer", gen: 0 }).state).toBe(SEND_NOW_IDLE);
  const sent: SendNowState = { phase: "sent", gen: 1 };
  expect(sendNowReducer(sent, { type: "keyFailed", gen: 1, error: "x" }).state).toBe(sent);
  // A timer while sending: the key result decides, not the timer.
  const sending: SendNowState = { phase: "sending", gen: 1 };
  expect(sendNowReducer(sending, { type: "timer", gen: 1 }).state).toBe(sending);
});

test("labels", () => {
  expect(sendNowLabel(SEND_NOW_IDLE)).toBeUndefined();
  expect(sendNowLabel({ phase: "sending", gen: 1 })).toBe("Sending now…");
  expect(sendNowLabel({ phase: "sent", gen: 1 })).toBe("Sending now…");
});

test("send_now_shows_only_for_a_working_claude_pane_and_a_queued_bubble", () => {
  expect(showsSendNow("claude", "working", "queued")).toBe(true);
  expect(showsSendNow("claude", "working", "unconfirmed")).toBe(false);
  expect(showsSendNow("claude", "working", "sending")).toBe(false);
  expect(showsSendNow("claude", "working", "failed")).toBe(false);
  expect(showsSendNow("claude", "idle", "queued")).toBe(false);
  expect(showsSendNow("codex", "working", "queued")).toBe(false);
  expect(showsSendNow(undefined, "working", "queued")).toBe(false);
});
