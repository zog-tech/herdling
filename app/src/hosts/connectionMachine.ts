/**
 * The connection to one saved host as a pure state machine.
 *
 * Many async steps race here: the SSH handshake, the rpc channel, `hello`, pings, the retry timer,
 * native disconnects, user retries and host edits. Each attempt has a generation (`gen`). An event
 * of an older generation is ignored, so a late result of a replaced attempt cannot tear down the
 * current one. `HostConnection` (connection.ts) is the I/O shell: it sends events in and runs the
 * effects (timers, native calls, the rpc channel, pings).
 *
 * `hello` and `lastSeen` stay through "connecting" and "offline". Screens use them to show what
 * the computer was (its OS, its version). The rpc client exists only while "online", and an
 * online state always has the `hello` of its own attempt. Thus no method call uses an old `hello`.
 */
import type { Hello } from "@herdling/protocol";

import type { RpcClient } from "../rpc/RpcClient";

/** The store view of one host (`useHostConn`). Add fields only: many screens read it. */
export type HostConn = {
  status: "offline" | "connecting" | "online";
  lastSeen?: number;
  rpc?: RpcClient;
  hello?: Hello;
  error?: string;
  /** Code of the native error of the last failed attempt (for example "connect_failed"), when it had one. */
  errorCode?: string;
  /** Number of connection attempts started for this host. A caller that wants a fresh result compares it. */
  attempt: number;
  /** True after a host key mismatch: no automatic retries until a retry or a change of the host entry. */
  blocked?: boolean;
};

/** Seconds to wait before retry number n (1-based); the last value repeats. */
export const BACKOFF_S = [1, 2, 4, 8, 16, 30];
/** The native error code of a host key that differs from the pinned key. */
export const HOST_KEY_MISMATCH = "host_key_mismatch";

type Common = {
  /** Generation of the current attempt. A new attempt and each teardown increase it. */
  gen: number;
  attempt: number;
  /** Failed attempts since the last success: the index into BACKOFF_S. */
  failures: number;
  foreground: boolean;
  lastSeen?: number;
  hello?: Hello;
};

export type ConnState = Common &
  (
    | { phase: "offline"; error?: string; errorCode?: string }
    /** "handshake": ssh.connect runs. "session": the channel opens and says hello. */
    | { phase: "connecting"; step: "handshake" | "session" }
    | { phase: "online"; hello: Hello; lastSeen: number }
    /** A host key mismatch. Only `retry` (or a changed host entry) leaves it. */
    | { phase: "blocked"; error: string }
    | { phase: "stopped" }
  );

export type ConnEvent =
  /** Connect now (a new host). Does not reset the backoff. */
  | { type: "connect" }
  /** Reset the backoff and the mismatch block, then connect now, also when online. */
  | { type: "retry" }
  /** Connect now when offline and not blocked. */
  | { type: "wake" }
  | { type: "foreground"; active: boolean }
  /** The retry timer of generation `gen` fired. */
  | { type: "timer"; gen: number }
  /** ssh.connect resolved. `fingerprint`: the host key seen. */
  | { type: "connected"; gen: number; fingerprint?: string }
  /** The rpc channel is open (for the demo host: the in-app transport exists). */
  | { type: "channelOpened"; gen: number }
  | { type: "hello"; gen: number; hello: Hello; at: number }
  | { type: "failed"; gen: number; error: string; code?: string }
  /** The rpc channel closed or a ping failed. */
  | { type: "dropped"; gen: number; reason: string }
  /** The native SSH connection of the host closed. Native events carry no generation. */
  | { type: "disconnected"; reason: string }
  | { type: "pong"; gen: number; at: number }
  | { type: "stop" };

export type ConnEffect =
  /** Stop pings, cancel the retry timer and close the rpc channel. */
  | { type: "teardown" }
  /** Start the native handshake (or the demo transport) for `gen`. */
  | { type: "connect"; gen: number }
  /** Close the native SSH connection. */
  | { type: "disconnect" }
  /** Save the host key seen on the first connect. */
  | { type: "pin"; fingerprint: string }
  | { type: "openChannel"; gen: number }
  /** Use the channel that just opened: make the rpc client and say hello. */
  | { type: "useChannel"; gen: number }
  /** Close the channel that just opened: its attempt is no longer current. */
  | { type: "dropChannel" }
  | { type: "schedule"; gen: number; ms: number }
  | { type: "startPings" }
  | { type: "stopPings" }
  | { type: "ping"; gen: number }
  | { type: "registerPush" }
  | { type: "setDemoActive"; active: boolean }
  /** Remove the host from the store. */
  | { type: "forget" };

export type ConnResult = { state: ConnState; effects: ConnEffect[] };

export function initialConnState(foreground: boolean): ConnState {
  return { phase: "offline", gen: 0, attempt: 0, failures: 0, foreground };
}

const same = (s: ConnState): ConnResult => ({ state: s, effects: [] });

function common(s: ConnState): Common {
  return { gen: s.gen, attempt: s.attempt, failures: s.failures, foreground: s.foreground, lastSeen: s.lastSeen, hello: s.hello };
}

/** Start a new attempt. It replaces whatever runs now. */
function begin(s: ConnState, failures = s.failures): ConnResult {
  if (s.phase === "stopped") return same(s);
  const gen = s.gen + 1;
  return {
    state: { ...common(s), gen, attempt: s.attempt + 1, failures, phase: "connecting", step: "handshake" },
    effects: [{ type: "teardown" }, { type: "connect", gen }],
  };
}

/** The attempt failed or the link dropped: go offline and retry after the backoff delay. */
function backoff(s: ConnState, error: string, errorCode?: string): ConnResult {
  const gen = s.gen + 1;
  const delay = BACKOFF_S[Math.min(s.failures, BACKOFF_S.length - 1)];
  return {
    state: { ...common(s), gen, failures: s.failures + 1, phase: "offline", error, errorCode },
    effects: [{ type: "teardown" }, { type: "schedule", gen, ms: delay * 1000 }],
  };
}

/** True when `gen` is the generation of the attempt that runs now. */
const current = (s: ConnState, gen: number): boolean => (s.phase === "connecting" || s.phase === "online") && s.gen === gen;

export function connectionReducer(s: ConnState, e: ConnEvent): ConnResult {
  switch (e.type) {
    case "connect":
      return begin(s);
    case "retry":
      return begin(s, 0);
    case "wake":
      return s.phase === "offline" ? begin(s, 0) : same(s);
    case "foreground": {
      if (s.phase === "stopped") return same(s);
      const next = { ...s, foreground: e.active };
      const demo: ConnEffect = { type: "setDemoActive", active: e.active };
      if (!e.active) return { state: next, effects: [demo, { type: "stopPings" }] };
      if (next.phase === "online") return { state: next, effects: [demo, { type: "ping", gen: next.gen }, { type: "startPings" }] };
      const woken = connectionReducer(next, { type: "wake" });
      return { state: woken.state, effects: [demo, ...woken.effects] };
    }
    case "timer":
      return s.phase === "offline" && s.gen === e.gen ? begin(s) : same(s);
    case "connected": {
      // stop() ran during the handshake: make sure no connection stays open.
      if (s.phase === "stopped") return { state: s, effects: [{ type: "disconnect" }] };
      // A newer attempt supersedes this one natively (its connect replaces this client).
      if (s.phase !== "connecting" || s.gen !== e.gen) return same(s);
      const pin: ConnEffect[] = e.fingerprint ? [{ type: "pin", fingerprint: e.fingerprint }] : [];
      return { state: { ...s, step: "session" }, effects: [...pin, { type: "openChannel", gen: e.gen }] };
    }
    case "channelOpened":
      if (s.phase !== "connecting" || s.gen !== e.gen) return { state: s, effects: [{ type: "dropChannel" }] };
      return { state: { ...s, step: "session" }, effects: [{ type: "useChannel", gen: e.gen }] };
    case "hello": {
      if (s.phase !== "connecting" || s.gen !== e.gen) return same(s);
      const state: ConnState = { ...common(s), failures: 0, phase: "online", hello: e.hello, lastSeen: e.at };
      return { state, effects: [...(s.foreground ? [{ type: "startPings" } as const] : []), { type: "registerPush" }] };
    }
    case "failed":
      if (s.phase !== "connecting" || s.gen !== e.gen) return same(s);
      if (e.code === HOST_KEY_MISMATCH) {
        const { lastSeen: _l, hello: _h, ...rest } = common(s);
        return {
          state: { ...rest, gen: s.gen + 1, phase: "blocked", error: `Host key changed: ${e.error}` },
          effects: [{ type: "teardown" }],
        };
      }
      return backoff(s, e.error, e.code);
    case "dropped":
      return current(s, e.gen) ? backoff(s, e.reason) : same(s);
    case "disconnected":
      // During the handshake the native module has no client of this attempt yet, so the event
      // belongs to the client that the handshake replaced. A drop of the new client shows up as
      // a failed openExec or a closed channel later.
      if (s.phase === "online" || (s.phase === "connecting" && s.step === "session")) return backoff(s, e.reason);
      return same(s);
    case "pong":
      return s.phase === "online" && s.gen === e.gen ? same({ ...s, lastSeen: e.at }) : same(s);
    case "stop":
      if (s.phase === "stopped") return same(s);
      return {
        state: { ...common(s), gen: s.gen + 1, phase: "stopped" },
        effects: [{ type: "teardown" }, { type: "disconnect" }, { type: "forget" }],
      };
  }
}

/** The store view of a state; undefined when the host is stopped. `rpc` is the client of the current attempt. */
export function toHostConn(s: ConnState, rpc: RpcClient | undefined): HostConn | undefined {
  const base = { lastSeen: s.lastSeen, hello: s.hello, attempt: s.attempt };
  switch (s.phase) {
    case "offline":
      return { status: "offline", ...base, error: s.error, errorCode: s.errorCode };
    case "connecting":
      return { status: "connecting", ...base };
    case "online":
      return { status: "online", ...base, rpc };
    case "blocked":
      return { status: "offline", attempt: s.attempt, error: s.error, blocked: true };
    case "stopped":
      return undefined;
  }
}
