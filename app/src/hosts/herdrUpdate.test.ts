const mockConn: { current: Record<string, unknown> } = { current: { status: "offline", attempt: 0 } };
const mockRetry = jest.fn((id: string) => {
  void id;
  return 3;
});
jest.mock("./connection", () => ({
  getHostConn: () => mockConn.current,
  retryNow: (id: string) => mockRetry(id),
  useHostConn: () => mockConn.current,
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
jest.mock("../../modules/ssh", () => ({}));

import type { Hello, HerdrUpdate } from "@herdling/protocol";

import { RpcError, type RpcClient } from "../rpc/RpcClient";
import {
  canUpdateHerdr,
  CONFIRM_BODY,
  herdrUpdateErrorMessage,
  initialHerdrUpdate,
  outcome,
  reducer,
  runHerdrUpdate,
  type HerdrUpdateEvent,
  type HerdrUpdateState,
} from "./herdrUpdate";

const hello = (methods: string[] | undefined, herdr_version = "0.9.5"): Hello => ({
  host: "studio",
  os: "linux",
  herdlingd: "0.1.9",
  herdr_ok: true,
  herdr_version,
  methods,
});

const result = (over: Partial<HerdrUpdate> = {}): HerdrUpdate => ({
  from: "0.9.5",
  to: "0.9.6",
  status: "updated",
  handoff: "complete",
  output: "installed 0.9.6",
  ...over,
});

/** Runs the events in order from `start` and gives the last state and all effects. */
function play(start: HerdrUpdateState, events: HerdrUpdateEvent[]) {
  let state = start;
  const effects = [];
  for (const e of events) {
    const r = reducer(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

describe("reducer", () => {
  test("press asks, confirm runs with a new generation, success is done", () => {
    let r = reducer(initialHerdrUpdate, { type: "press" });
    expect(r.state.phase).toBe("confirming");
    expect(r.effects).toEqual([{ type: "ask" }]);
    r = reducer(r.state, { type: "confirm" });
    expect(r.state).toEqual({ phase: "running", gen: 1 });
    expect(r.effects).toEqual([{ type: "run", gen: 1 }]);
    r = reducer(r.state, { type: "succeeded", gen: 1, text: "Updated to 0.9.6." });
    expect(r.state).toEqual({ phase: "done", gen: 1, text: "Updated to 0.9.6.", output: undefined });
    expect(r.effects).toEqual([]);
  });

  test("cancel goes back to idle and runs nothing", () => {
    const { state, effects } = play(initialHerdrUpdate, [{ type: "press" }, { type: "cancel" }]);
    expect(state).toEqual({ phase: "idle", gen: 0 });
    expect(effects).toEqual([{ type: "ask" }]);
  });

  test("a failure shows its text", () => {
    const { state } = play(initialHerdrUpdate, [{ type: "press" }, { type: "confirm" }, { type: "failed", gen: 1, text: "busy" }]);
    expect(state).toEqual({ phase: "failed", gen: 1, text: "busy" });
  });

  test("one run at a time: press and confirm do nothing while running", () => {
    const running: HerdrUpdateState = { phase: "running", gen: 1 };
    expect(reducer(running, { type: "press" })).toEqual({ state: running, effects: [] });
    expect(reducer(running, { type: "confirm" })).toEqual({ state: running, effects: [] });
    expect(reducer(running, { type: "cancel" })).toEqual({ state: running, effects: [] });
  });

  test("a second press while asking does not ask again", () => {
    const asking: HerdrUpdateState = { phase: "confirming", gen: 0 };
    expect(reducer(asking, { type: "press" }).effects).toEqual([]);
  });

  test("confirm and results are ignored outside their phase", () => {
    const idle: HerdrUpdateState = { phase: "idle", gen: 2 };
    expect(reducer(idle, { type: "confirm" })).toEqual({ state: idle, effects: [] });
    expect(reducer(idle, { type: "succeeded", gen: 2, text: "x" }).state).toBe(idle);
    expect(reducer(idle, { type: "failed", gen: 2, text: "x" }).state).toBe(idle);
    expect(reducer(idle, { type: "cancel" }).state).toBe(idle);
  });

  test("a result of an old generation is ignored", () => {
    const running: HerdrUpdateState = { phase: "running", gen: 2 };
    expect(reducer(running, { type: "succeeded", gen: 1, text: "old" }).state).toBe(running);
    expect(reducer(running, { type: "failed", gen: 1, text: "old" }).state).toBe(running);
  });

  test("a new run can start after a result, with the next generation", () => {
    const { state, effects } = play({ phase: "failed", gen: 1, text: "x" }, [{ type: "press" }, { type: "confirm" }]);
    expect(state).toEqual({ phase: "running", gen: 2 });
    expect(effects).toEqual([{ type: "ask" }, { type: "run", gen: 2 }]);
  });
});

test("canUpdateHerdr needs the method in the list", () => {
  expect(canUpdateHerdr(undefined)).toBe(false);
  expect(canUpdateHerdr(hello(undefined))).toBe(false);
  expect(canUpdateHerdr(hello(["hello", "update.apply"]))).toBe(false);
  expect(canUpdateHerdr(hello(["hello", "herdr.update"]))).toBe(true);
});

test("the confirmation says that agents can stop", () => {
  expect(CONFIRM_BODY).toContain("running commands and agents stop");
});

describe("outcome", () => {
  test("sessions kept running only with a complete handoff", () => {
    expect(outcome(result())).toEqual({ text: "Updated to 0.9.6. Sessions kept running." });
    expect(outcome(result({ handoff: "failed", output: "live handoff failed\n" }))).toEqual({
      text: "Updated to 0.9.6.",
      output: "live handoff failed",
    });
    expect(outcome(result({ handoff: "none", output: "  " }))).toEqual({ text: "Updated to 0.9.6.", output: undefined });
  });

  test("up to date, and the running version when herdr gave none", () => {
    expect(outcome(result({ status: "up_to_date", to: "0.9.5" }))).toEqual({ text: "herdr 0.9.5 is already up to date." });
    expect(outcome(result({ status: "up_to_date", to: null }))).toEqual({ text: "herdr is already up to date." });
    expect(outcome(result({ to: null }), "0.9.7").text).toBe("Updated to 0.9.7. Sessions kept running.");
    expect(outcome(result({ to: undefined, handoff: "none", output: "" })).text).toBe("herdr is updated.");
  });
});

test("error messages", () => {
  expect(herdrUpdateErrorMessage(new RpcError("managed_install", "x"))).toContain("package manager");
  expect(herdrUpdateErrorMessage(new RpcError("busy", "x"))).toContain("already running");
  expect(herdrUpdateErrorMessage(new RpcError("not_installed", "x"))).toContain("cannot find herdr");
  expect(herdrUpdateErrorMessage(new RpcError("command_failed", "herdr update exited with 1: no network"))).toBe(
    "The herdr update failed: herdr update exited with 1: no network",
  );
});

describe("runHerdrUpdate", () => {
  beforeEach(() => mockRetry.mockClear());

  test("offline host throws", async () => {
    mockConn.current = { status: "offline", attempt: 0 };
    await expect(runHerdrUpdate("h1")).rejects.toThrow("offline");
  });

  test("up to date does not reconnect", async () => {
    const call = jest.fn(async () => result({ status: "up_to_date", to: "0.9.5" }));
    mockConn.current = { status: "online", attempt: 1, rpc: { call } as unknown as RpcClient, hello: hello(["herdr.update"]) };
    await expect(runHerdrUpdate("h1")).resolves.toEqual({ text: "herdr 0.9.5 is already up to date." });
    expect(call).toHaveBeenCalledWith("herdr.update", {}, expect.any(Number));
    expect(mockRetry).not.toHaveBeenCalled();
  });

  test("an update reconnects and reads the new hello", async () => {
    const call = jest.fn(async () => result({ to: null }));
    mockConn.current = { status: "online", attempt: 3, rpc: { call } as unknown as RpcClient, hello: hello(["herdr.update"], "0.9.6") };
    await expect(runHerdrUpdate("h1", 1000)).resolves.toEqual({ text: "Updated to 0.9.6. Sessions kept running." });
    expect(mockRetry).toHaveBeenCalledWith("h1");
  });

  test("an rpc error becomes a user text", async () => {
    const call = jest.fn(async () => {
      throw new RpcError("managed_install", "herdr is installed with a package manager");
    });
    mockConn.current = { status: "online", attempt: 1, rpc: { call } as unknown as RpcClient, hello: hello(["herdr.update"]) };
    await expect(runHerdrUpdate("h1")).rejects.toThrow("Homebrew, mise or Nix");
  });
});
