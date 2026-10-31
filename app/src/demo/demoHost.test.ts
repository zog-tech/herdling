// Every native SSH call is a mock: the demo host must never call any of them.
const mockSsh = {
  ensureKey: jest.fn(),
  connect: jest.fn(),
  openExec: jest.fn(),
  write: jest.fn(),
  closeChannel: jest.fn(),
  disconnect: jest.fn(),
  probeHostKey: jest.fn(),
  execWithPassword: jest.fn(),
  startBrowse: jest.fn(),
  stopBrowse: jest.fn(),
};
const SSH_FUNCTIONS = ["ensureKey", "connect", "openExec", "write", "closeChannel", "disconnect", "probeHostKey", "execWithPassword", "startBrowse", "stopBrowse"];
jest.mock("../../modules/ssh", () => ({
  // The factory runs before `mockSsh` exists, so each function looks it up when called.
  ...Object.fromEntries(SSH_FUNCTIONS.map((k) => [k, (...a: unknown[]) => (mockSsh as Record<string, jest.Mock>)[k](...a)])),
  addListener: () => ({ remove: () => {} }),
}));

jest.mock("expo-secure-store", () => {
  const items = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => items.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void items.set(k, v),
    deleteItemAsync: async (k: string) => void items.delete(k),
  };
});

const mockRegisterPush = jest.fn(async () => {});
jest.mock("../push/register", () => ({ registerPush: () => mockRegisterPush() }));
const mockToken = jest.fn(async () => "ExponentPushToken[x]");
jest.mock("../push/token", () => ({ getExpoToken: () => mockToken() }));
const mockNotice = jest.fn(async (_n: unknown) => {});
jest.mock("./notify", () => ({ showDemoNotice: (n: unknown) => mockNotice(n) }));

import { AppState } from "react-native";

import { getHostConn, startConnections, stopConnections } from "@/hosts/connection";
import { removeHostEverywhere } from "@/hosts/removeHost";
import { useHosts } from "@/hosts/store";
import { useNotifPrefs } from "@/push/prefs";

import { DEMO_HOST_ID, DEMO_HOST_NAME, isDemoHost, startDemo } from "./demoHost";

beforeEach(() => {
  jest.useFakeTimers();
  (AppState as { currentState: string }).currentState = "active";
  Object.values(mockSsh).forEach((m) => m.mockReset());
  mockRegisterPush.mockClear();
  mockToken.mockClear();
  mockNotice.mockClear();
  useHosts.setState({ hosts: [] });
});
afterEach(() => {
  stopConnections();
  jest.useRealTimers();
});

function expectNoNetwork() {
  for (const [name, fn] of Object.entries(mockSsh)) {
    if (fn.mock.calls.length) throw new Error(`ssh.${name} was called`);
  }
  expect(mockRegisterPush).not.toHaveBeenCalled();
  expect(mockToken).not.toHaveBeenCalled();
}

describe("demo host", () => {
  it("startDemo adds one demo host, once", async () => {
    await startDemo();
    await startDemo();
    const hosts = useHosts.getState().hosts;
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({ id: DEMO_HOST_ID, name: DEMO_HOST_NAME, demo: true });
    expect(isDemoHost(hosts[0])).toBe(true);
    expect(isDemoHost("h_other")).toBe(false);
  });

  it("connects in process: online, hello, no SSH, no push registration", async () => {
    await startDemo();
    startConnections();
    await jest.advanceTimersByTimeAsync(200);
    const conn = getHostConn(DEMO_HOST_ID);
    expect(conn.status).toBe("online");
    expect(conn.hello?.host).toBe(DEMO_HOST_NAME);

    // Pings, a changed notification pref and some scenario time: still nothing on the network.
    useNotifPrefs.getState().setPref("finished", false);
    await jest.advanceTimersByTimeAsync(40_000);
    expect(getHostConn(DEMO_HOST_ID).status).toBe("online");
    expectNoNetwork();
    // The scenario asks for local notices only.
    expect(mockNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: "needs_you", paneId: "p2" }));
    useNotifPrefs.getState().setPref("finished", true);
  });

  it("remove: no revoke, no key generation, the connection stops", async () => {
    await startDemo();
    startConnections();
    await jest.advanceTimersByTimeAsync(200);
    const res = await removeHostEverywhere(DEMO_HOST_ID);
    expect(res).toEqual({ revoked: false });
    expect(useHosts.getState().hosts).toHaveLength(0);
    expect(getHostConn(DEMO_HOST_ID).status).toBe("offline");
    await jest.advanceTimersByTimeAsync(60_000);
    expectNoNetwork();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("the demo scripts stop while the app is in the background", async () => {
    const listeners: ((s: string) => void)[] = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((...args: unknown[]) => {
      listeners.push(args[1] as (s: string) => void);
      return { remove: () => {} };
    });
    await startDemo();
    startConnections();
    await jest.advanceTimersByTimeAsync(200);
    listeners.forEach((l) => l("background"));
    mockNotice.mockClear();
    await jest.advanceTimersByTimeAsync(120_000);
    // No scenario step ran: the "finished" notice of the working agent did not come.
    expect(mockNotice).not.toHaveBeenCalled();
    listeners.forEach((l) => l("active"));
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockNotice).toHaveBeenCalled();
    expectNoNetwork();
  });
});
