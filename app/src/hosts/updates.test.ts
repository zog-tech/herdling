const mockItems = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => mockItems.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockItems.set(k, v),
  deleteItemAsync: async (k: string) => void mockItems.delete(k),
}));
jest.mock("../../modules/ssh", () => ({}));
const mockConn: { current: Record<string, unknown> } = { current: { status: "offline", attempt: 0 } };
const mockRetry = jest.fn((id: string) => {
  void id;
  return 7;
});
jest.mock("./connection", () => ({
  getHostConn: () => mockConn.current,
  retryNow: (id: string) => mockRetry(id),
  useHostConn: () => mockConn.current,
}));

import type { Hello } from "@herdling/protocol";

import type { PasswordExecOptions, PasswordExecResult } from "../../modules/ssh";
import type { RpcClient } from "../rpc/RpcClient";
import { RpcError } from "../rpc/RpcClient";
import { useHosts, type Host } from "./store";
import {
  applyUpdate,
  CHECK_EVERY_MS,
  checkForUpdate,
  shouldCheck,
  showUpdateNotice,
  updateStatus,
  updateWithPassword,
} from "./updates";

const NOW = 1_800_000_000_000;
const FP = "SHA256:" + "a".repeat(43);
const ALL = ["hello", "update.check", "update.apply"];
const hello = (version: string, methods: string[] | undefined = ALL): Hello => ({
  host: "studio",
  os: "linux",
  herdlingd: version,
  herdr_ok: true,
  methods,
});
const noList = (version: string): Hello => ({ ...hello(version), methods: undefined });
const base: Host = { id: "h1", name: "studio", address: "10.0.0.5", port: 22, user: "sam", fingerprint: FP, command: "herdlingd rpc" };
const cache = (over: Partial<NonNullable<Host["updateCheck"]>> = {}) => ({
  checkedAt: NOW,
  current: "0.1.0",
  latest: "0.2.0",
  updateAvailable: true,
  notes: "New things",
  ...over,
});

function fakeRpc(answer: (method: string) => unknown): RpcClient & { call: jest.Mock } {
  return {
    call: jest.fn(async (method: string) => {
      const a = answer(method);
      if (a instanceof Error) throw a;
      return a;
    }),
  } as unknown as RpcClient & { call: jest.Mock };
}

beforeEach(() => {
  useHosts.setState({ hosts: [{ ...base }] });
  mockRetry.mockClear();
});

describe("shouldCheck", () => {
  it("checks once a day, and again when the version changes", () => {
    expect(shouldCheck(base, hello("0.1.0"), NOW)).toBe(true);
    const h = { ...base, updateCheck: cache() };
    expect(shouldCheck(h, hello("0.1.0"), NOW + 1000)).toBe(false);
    expect(shouldCheck(h, hello("0.1.0"), NOW + CHECK_EVERY_MS - 1)).toBe(false);
    expect(shouldCheck(h, hello("0.1.0"), NOW + CHECK_EVERY_MS)).toBe(true);
    expect(shouldCheck(h, hello("0.2.0"), NOW + 1000)).toBe(true);
    // A clock that went back does not block the check for long.
    expect(shouldCheck(h, hello("0.1.0"), NOW - 1000)).toBe(true);
  });

  it("never checks a host without update.check, offline, or the demo", () => {
    expect(shouldCheck(base, undefined, NOW)).toBe(false);
    expect(shouldCheck(base, hello("0.1.0", ["hello"]), NOW)).toBe(false);
    expect(shouldCheck(base, noList("0.1.0"), NOW)).toBe(false);
    expect(shouldCheck({ ...base, demo: true }, hello("demo"), NOW)).toBe(false);
  });
});

describe("updateStatus", () => {
  it("shows an update for the running version only", () => {
    const h = { ...base, updateCheck: cache() };
    expect(updateStatus(h, hello("0.1.0"))).toEqual({ kind: "available", from: "0.1.0", to: "0.2.0", notes: "New things" });
    expect(updateStatus(h, hello("0.2.0"))).toEqual({ kind: "none" });
    expect(updateStatus({ ...base, updateCheck: cache({ updateAvailable: false }) }, hello("0.1.0"))).toEqual({ kind: "none" });
    expect(updateStatus(h, undefined)).toEqual({ kind: "none" });
  });

  it("asks for the password path when herdlingd cannot update itself", () => {
    expect(updateStatus(base, hello("0.1.0", ["hello", "ping"]))).toEqual({ kind: "password" });
    expect(updateStatus(base, noList("0.0.9"))).toEqual({ kind: "password" });
    expect(updateStatus({ ...base, demo: true }, noList("demo"))).toEqual({ kind: "none" });
  });

  it("hides the notice for a closed version", () => {
    const status = updateStatus({ ...base, updateCheck: cache() }, hello("0.1.0"));
    expect(showUpdateNotice(base, status)).toBe(true);
    expect(showUpdateNotice({ ...base, dismissedUpdate: "0.2.0" }, status)).toBe(false);
    expect(showUpdateNotice({ ...base, dismissedUpdate: "0.1.5" }, status)).toBe(true);
  });
});

describe("checkForUpdate", () => {
  it("saves the result on the host", async () => {
    const rpc = fakeRpc(() => ({ current: "0.1.0", latest: "0.2.0", update_available: true, notes: "n", target: "x" }));
    await checkForUpdate("h1", rpc, NOW);
    expect(rpc.call).toHaveBeenCalledWith("update.check", {}, expect.any(Number));
    expect(useHosts.getState().hosts[0].updateCheck).toEqual(cache({ notes: "n" }));
  });

  it("a failure keeps the old result and waits a day", async () => {
    useHosts.setState({ hosts: [{ ...base, updateCheck: cache({ checkedAt: NOW - CHECK_EVERY_MS }) }] });
    await checkForUpdate("h1", fakeRpc(() => new RpcError("update_unavailable", "offline")), NOW);
    expect(useHosts.getState().hosts[0].updateCheck).toEqual(cache());
  });
});

describe("applyUpdate", () => {
  it("updates, reconnects and reads the new version", async () => {
    const rpc = fakeRpc(() => ({ from: "0.1.0", to: "0.2.0", status: "updated", service_restarted: true }));
    mockConn.current = { status: "online", rpc, hello: hello("0.1.0"), attempt: 6 };
    mockRetry.mockImplementationOnce(() => {
      mockConn.current = { status: "online", rpc, hello: hello("0.2.0"), attempt: 7 };
      return 7;
    });
    expect(await applyUpdate("h1", 2000)).toEqual({ status: "updated", version: "0.2.0" });
    expect(rpc.call).toHaveBeenCalledWith("update.apply", {}, 180_000);
    expect(mockRetry).toHaveBeenCalledWith("h1");
    expect(useHosts.getState().hosts[0].updateCheck).toMatchObject({ current: "0.2.0", updateAvailable: false });
  });

  it("up to date changes nothing and does not reconnect", async () => {
    const rpc = fakeRpc(() => ({ from: "0.2.0", to: "0.2.0", status: "up_to_date", service_restarted: false }));
    mockConn.current = { status: "online", rpc, hello: hello("0.2.0"), attempt: 1 };
    expect(await applyUpdate("h1", 100)).toEqual({ status: "up_to_date", version: "0.2.0" });
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it("gives a clear message for an error", async () => {
    const rpc = fakeRpc(() => new RpcError("checksum_mismatch", "sha"));
    mockConn.current = { status: "online", rpc, hello: hello("0.1.0"), attempt: 1 };
    await expect(applyUpdate("h1", 100)).rejects.toThrow(/checksum mismatch/);
    mockConn.current = { status: "offline", attempt: 1 };
    await expect(applyUpdate("h1", 100)).rejects.toThrow(/offline/);
  });
});

describe("updateWithPassword", () => {
  const PASSWORD = "correct horse battery staple";
  const exec = (stdout: string) =>
    jest.fn(async (o: PasswordExecOptions): Promise<PasswordExecResult> => {
      void o;
      return { stdout, stderr: "", exitCode: stdout.includes("INSTALLED") ? 0 : 1, hostFingerprint: FP };
    });

  it("runs the installer pinned to the saved key, then reconnects", async () => {
    const e = exec("HERDLINGD_INSTALLED 0.2.0\n");
    expect(await updateWithPassword(base, PASSWORD, { execWithPassword: e })).toEqual({ ok: true, version: "0.2.0" });
    expect(e.mock.calls[0][0]).toMatchObject({ host: "10.0.0.5", user: "sam", expectedFingerprint: FP });
    expect(mockRetry).toHaveBeenCalledWith("h1");
    expect(JSON.stringify(useHosts.getState())).not.toContain(PASSWORD);
  });

  it("refuses a host with no pinned key", async () => {
    const e = exec("HERDLINGD_INSTALLED 0.2.0\n");
    const r = await updateWithPassword({ ...base, fingerprint: undefined }, PASSWORD, { execWithPassword: e });
    expect(r.ok).toBe(false);
    expect(e).not.toHaveBeenCalled();
  });
});
