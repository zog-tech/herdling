import type { Hello } from "@herdling/protocol";

import type { RpcClient } from "../rpc/RpcClient";
import {
  connectionReducer,
  initialConnState,
  toHostConn,
  type ConnEffect,
  type ConnEvent,
  type ConnState,
} from "./connectionMachine";

const HELLO = { host: "box", os: "macos", herdlingd: "0.1.0", herdr_ok: true } as Hello;
const RPC = {} as RpcClient;

/** Applies the events in order and returns the last state and all effects. */
function run(events: ConnEvent[], from: ConnState = initialConnState(true)) {
  let state = from;
  const effects: ConnEffect[] = [];
  for (const e of events) {
    const r = connectionReducer(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

/** An online host whose attempt has generation `state.gen`. */
function online(): ConnState {
  const s = run([{ type: "connect" }]).state;
  return run([{ type: "connected", gen: s.gen }, { type: "channelOpened", gen: s.gen }, { type: "hello", gen: s.gen, hello: HELLO, at: 100 }], s).state;
}

test("connect_runs_the_steps_in_order", () => {
  let r = connectionReducer(initialConnState(true), { type: "connect" });
  expect(r.state).toMatchObject({ phase: "connecting", step: "handshake", attempt: 1 });
  const gen = r.state.gen;
  expect(r.effects).toEqual([{ type: "teardown" }, { type: "connect", gen }]);
  r = connectionReducer(r.state, { type: "connected", gen, fingerprint: "SHA256:abc" });
  expect(r.state).toMatchObject({ phase: "connecting", step: "session" });
  expect(r.effects).toEqual([{ type: "pin", fingerprint: "SHA256:abc" }, { type: "openChannel", gen }]);
  r = connectionReducer(r.state, { type: "channelOpened", gen });
  expect(r.effects).toEqual([{ type: "useChannel", gen }]);
  r = connectionReducer(r.state, { type: "hello", gen, hello: HELLO, at: 5 });
  expect(r.state).toMatchObject({ phase: "online", hello: HELLO, lastSeen: 5, failures: 0 });
  expect(r.effects).toEqual([{ type: "startPings" }, { type: "registerPush" }]);
  expect(toHostConn(r.state, RPC)).toEqual({ status: "online", lastSeen: 5, hello: HELLO, attempt: 1, rpc: RPC });
});

test("no_pings_in_the_background", () => {
  const s = run([{ type: "foreground", active: false }, { type: "connect" }]).state;
  const r = run([{ type: "connected", gen: s.gen }, { type: "channelOpened", gen: s.gen }, { type: "hello", gen: s.gen, hello: HELLO, at: 1 }], s);
  expect(r.effects).not.toContainEqual({ type: "startPings" });
});

test("backoff_delays_grow_and_cap", () => {
  let s = initialConnState(true);
  const delays: number[] = [];
  s = run([{ type: "connect" }], s).state;
  for (let i = 0; i < 8; i++) {
    const r = run([{ type: "failed", gen: s.gen, error: "refused", code: "connect_failed" }], s);
    const sched = r.effects.find((e) => e.type === "schedule");
    if (sched?.type === "schedule") delays.push(sched.ms / 1000);
    expect(r.effects[0]).toEqual({ type: "teardown" });
    expect(r.state).toMatchObject({ phase: "offline", error: "refused", errorCode: "connect_failed" });
    s = run([{ type: "timer", gen: r.state.gen }], r.state).state;
    expect(s.phase).toBe("connecting");
  }
  expect(delays).toEqual([1, 2, 4, 8, 16, 30, 30, 30]);
});

test("each_failure_tears_down_before_it_schedules", () => {
  // A failure always cancels the old timer first (via teardown), so two timers never run.
  const s = run([{ type: "connect" }]).state;
  const r = connectionReducer(s, { type: "failed", gen: s.gen, error: "x" });
  expect(r.effects.map((e) => e.type)).toEqual(["teardown", "schedule"]);
});

test("stale_events_are_ignored", () => {
  const s = online();
  const old = s.gen - 1;
  for (const e of [
    { type: "dropped", gen: old, reason: "x" },
    { type: "failed", gen: old, error: "x" },
    { type: "hello", gen: old, hello: HELLO, at: 1 },
    { type: "connected", gen: old },
    { type: "timer", gen: old },
    { type: "pong", gen: old, at: 999 },
  ] as ConnEvent[]) {
    expect(connectionReducer(s, e)).toEqual({ state: s, effects: [] });
  }
});

test("stale_channel_is_closed", () => {
  const s = online();
  expect(connectionReducer(s, { type: "channelOpened", gen: s.gen - 1 }).effects).toEqual([{ type: "dropChannel" }]);
});

test("disconnect_during_handshake_belongs_to_the_old_client", () => {
  const s = run([{ type: "retry" }], online()).state;
  expect(s).toMatchObject({ phase: "connecting", step: "handshake" });
  expect(connectionReducer(s, { type: "disconnected", reason: "connection closed" })).toEqual({ state: s, effects: [] });
});

test("disconnect_after_handshake_or_online_drops", () => {
  const s = run([{ type: "connect" }]).state;
  const session = run([{ type: "connected", gen: s.gen }], s).state;
  expect(connectionReducer(session, { type: "disconnected", reason: "gone" }).state).toMatchObject({ phase: "offline", error: "gone" });
  const r = connectionReducer(online(), { type: "disconnected", reason: "gone" });
  expect(r.state).toMatchObject({ phase: "offline", error: "gone", hello: HELLO, lastSeen: 100 });
  expect(r.effects.map((e) => e.type)).toEqual(["teardown", "schedule"]);
});

test("disconnect_when_offline_is_ignored", () => {
  const s = initialConnState(true);
  expect(connectionReducer(s, { type: "disconnected", reason: "x" }).state).toBe(s);
});

test("mismatch_blocks_until_retry", () => {
  const s = run([{ type: "connect" }]).state;
  const r = connectionReducer(s, { type: "failed", gen: s.gen, error: "host key differs", code: "host_key_mismatch" });
  expect(r.state).toMatchObject({ phase: "blocked", error: "Host key changed: host key differs" });
  expect(r.effects).toEqual([{ type: "teardown" }]);
  expect(toHostConn(r.state, undefined)).toEqual({ status: "offline", attempt: 1, error: "Host key changed: host key differs", blocked: true });
  for (const e of [{ type: "wake" }, { type: "foreground", active: true }, { type: "timer", gen: r.state.gen }] as ConnEvent[]) {
    expect(connectionReducer(r.state, e).state.phase).toBe("blocked");
  }
  const retried = connectionReducer(r.state, { type: "retry" });
  expect(retried.state).toMatchObject({ phase: "connecting", attempt: 2, failures: 0 });
  expect(toHostConn(retried.state, undefined)?.blocked).toBeUndefined();
});

test("wake_resets_backoff_only_when_offline", () => {
  const s = run([{ type: "connect" }]).state;
  const off = connectionReducer(s, { type: "failed", gen: s.gen, error: "x" }).state;
  expect(off.failures).toBe(1);
  expect(connectionReducer(off, { type: "wake" }).state).toMatchObject({ phase: "connecting", failures: 0 });
  expect(connectionReducer(s, { type: "wake" }).state).toBe(s);
  const on = online();
  expect(connectionReducer(on, { type: "wake" }).state).toBe(on);
});

test("retry_on_online_host_starts_a_new_attempt_and_keeps_hello", () => {
  const s = online();
  const r = connectionReducer(s, { type: "retry" });
  expect(r.state).toMatchObject({ phase: "connecting", attempt: s.attempt + 1, hello: HELLO });
  expect(toHostConn(r.state, RPC)).toEqual({ status: "connecting", attempt: s.attempt + 1, hello: HELLO, lastSeen: 100 });
});

test("foreground_pings_when_online_and_wakes_when_offline", () => {
  const s = online();
  const back = connectionReducer(s, { type: "foreground", active: false });
  expect(back.effects).toEqual([{ type: "setDemoActive", active: false }, { type: "stopPings" }]);
  const front = connectionReducer(back.state, { type: "foreground", active: true });
  expect(front.effects).toEqual([{ type: "setDemoActive", active: true }, { type: "ping", gen: s.gen }, { type: "startPings" }]);
  const off = connectionReducer(initialConnState(false), { type: "foreground", active: true });
  expect(off.state.phase).toBe("connecting");
});

test("pong_updates_last_seen", () => {
  const s = online();
  expect(connectionReducer(s, { type: "pong", gen: s.gen, at: 500 }).state.lastSeen).toBe(500);
});

test("stop_is_final", () => {
  const s = run([{ type: "connect" }]).state;
  const r = connectionReducer(s, { type: "stop" });
  expect(r.effects).toEqual([{ type: "teardown" }, { type: "disconnect" }, { type: "forget" }]);
  expect(toHostConn(r.state, undefined)).toBeUndefined();
  // A handshake that finishes after stop disconnects at once.
  expect(connectionReducer(r.state, { type: "connected", gen: s.gen }).effects).toEqual([{ type: "disconnect" }]);
  expect(connectionReducer(r.state, { type: "channelOpened", gen: s.gen }).effects).toEqual([{ type: "dropChannel" }]);
  for (const e of [{ type: "connect" }, { type: "retry" }, { type: "wake" }, { type: "foreground", active: true }, { type: "stop" }] as ConnEvent[]) {
    expect(connectionReducer(r.state, e)).toEqual({ state: r.state, effects: [] });
  }
});
