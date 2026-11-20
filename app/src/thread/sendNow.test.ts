import { sendNowDispatch, sendNowOf, useSendNowStore, type SendNowIo } from "./sendNow";
import { SENT_HOLD_MS } from "./sendNowMachine";

jest.mock("@/ui/haptics", () => ({ commit: jest.fn(), fail: jest.fn() }));

const H = "studio";
const P = "w1:p1";
const rpc = { call: jest.fn() };

function fakeIo(press: () => Promise<void>) {
  const timers: { fn: () => void; ms: number }[] = [];
  const io: SendNowIo = { pressEsc: jest.fn(press), setTimer: (fn, ms) => timers.push({ fn, ms }) };
  return { io, timers };
}

beforeEach(() => useSendNowStore.setState({ byPane: {} }));

test("a_double_tap_presses_esc_once_and_the_hold_ends_after_the_timer", async () => {
  const { io, timers } = fakeIo(() => Promise.resolve());
  sendNowDispatch(rpc, H, P, { type: "tap", working: true }, io);
  sendNowDispatch(rpc, H, P, { type: "tap", working: true }, io);
  expect(io.pressEsc).toHaveBeenCalledTimes(1);
  expect(io.pressEsc).toHaveBeenCalledWith(rpc, P);
  expect(sendNowOf(H, P).phase).toBe("sending");
  await Promise.resolve();
  expect(sendNowOf(H, P).phase).toBe("sent");
  // A tap during the hold: no second Esc (two Esc presses open the rewind menu of Claude Code).
  sendNowDispatch(rpc, H, P, { type: "tap", working: true }, io);
  expect(io.pressEsc).toHaveBeenCalledTimes(1);
  expect(timers.map((t) => t.ms)).toEqual([SENT_HOLD_MS]);
  timers[0].fn();
  expect(sendNowOf(H, P).phase).toBe("idle");
});

test("a_key_error_shows_on_the_pane", async () => {
  const { io } = fakeIo(() => Promise.reject(new Error("Host offline")));
  sendNowDispatch(rpc, H, P, { type: "tap", working: true }, io);
  await Promise.resolve();
  await Promise.resolve();
  expect(sendNowOf(H, P)).toEqual({ phase: "failed", gen: 1, error: "Host offline" });
  // Another pane has its own state.
  expect(sendNowOf(H, "w1:p2").phase).toBe("idle");
});
