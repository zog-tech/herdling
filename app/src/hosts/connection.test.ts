import { AppState } from "react-native";

type Listener = (e: any) => void;

// In-memory stand-in for the native ssh module.
const mockSsh = {
  listeners: new Map<string, Set<Listener>>(),
  emit(event: string, payload: unknown) {
    this.listeners.get(event)?.forEach((l) => l(payload));
  },
  ensureKey: jest.fn(async () => ({ publicKey: "ssh-ed25519 AAAA zogssh" })),
  connect: jest.fn(async (_hostId: string, _o: unknown): Promise<{ fingerprint: string }> => ({ fingerprint: "SHA256:abc" })),
  openExec: jest.fn(async (_hostId: string, _cmd: string) => "ch1"),
  write: jest.fn(async (_ch: string, _data: string) => {}),
  closeChannel: jest.fn(async (_ch: string) => {}),
  disconnect: jest.fn(async (_hostId: string) => {}),
  addListener(event: string, l: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(l);
    return { remove: () => this.listeners.get(event)!.delete(l) };
  },
};

jest.mock("../../modules/ssh", () => ({
  ensureKey: (...a: any[]) => (mockSsh.ensureKey as any)(...a),
  connect: (...a: any[]) => (mockSsh.connect as any)(...a),
  openExec: (...a: any[]) => (mockSsh.openExec as any)(...a),
  write: (...a: any[]) => (mockSsh.write as any)(...a),
  closeChannel: (...a: any[]) => (mockSsh.closeChannel as any)(...a),
  disconnect: (...a: any[]) => (mockSsh.disconnect as any)(...a),
  addListener: (e: string, l: Listener) => mockSsh.addListener(e, l),
}));

jest.mock("expo-secure-store", () => {
  // Defined inside the factory: the store module reads it at import time.
  const items = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => items.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void items.set(k, v),
    deleteItemAsync: async (k: string) => void items.delete(k),
  };
});

const mockRegisterPush = jest.fn(async (_rpc: unknown, _hostId: string) => {});
jest.mock("../push/register", () => ({
  registerPush: (rpc: unknown, hostId: string) => mockRegisterPush(rpc, hostId),
}));

import { useNotifPrefs } from "../push/prefs";
import { ExecTransport, getHostConn, retryNow, startConnections, stopConnections } from "./connection";
import { useHosts } from "./store";

const HELLO = { host: "box", os: "macos", zogsshd: "0.1.0", herdr_ok: true };

/** Rpc methods the fake companion does not answer (to simulate a dead link). */
const silent = new Set<string>();

/** Make `write` answer every rpc request line: `hello` with HELLO, anything else with {}. */
function answerRequests() {
  mockSsh.write.mockImplementation(async (ch: string, data: string) => {
    const req = JSON.parse(data);
    if (silent.has(req.method)) return;
    const result = req.method === "hello" ? HELLO : {};
    queueMicrotask(() => mockSsh.emit("onData", { channelId: ch, data: JSON.stringify({ id: req.id, result }) + "\n" }));
  });
}

function sentMethods(): string[] {
  return mockSsh.write.mock.calls.map(([, data]) => JSON.parse(data as string).method);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

let appStateHandler: ((s: string) => void) | undefined;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] });
  mockSsh.listeners.clear();
  mockSsh.connect.mockReset().mockResolvedValue({ fingerprint: "SHA256:abc" });
  mockSsh.openExec.mockReset().mockResolvedValue("ch1");
  mockSsh.write.mockReset();
  mockSsh.closeChannel.mockReset().mockResolvedValue(undefined);
  mockSsh.disconnect.mockReset().mockResolvedValue(undefined);
  answerRequests();
  silent.clear();
  appStateHandler = undefined;
  // The jest-expo mock has no real value here.
  (AppState as { currentState: string }).currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation((_t: any, cb: any) => {
    appStateHandler = cb;
    return { remove: () => {} } as any;
  });
  useHosts.setState({ hosts: [] });
  mockRegisterPush.mockClear();
  useNotifPrefs.setState({ finished: true, needs_you: true, quiet_at_desk: true });
});

afterEach(() => {
  stopConnections();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function addHost(fingerprint?: string) {
  useHosts.setState({
    hosts: [{ id: "h1", name: "Box", address: "10.0.0.5", port: 22, user: "sam", command: "zogsshd rpc", fingerprint }],
  });
}

test("line_adapter_buffers_partial_lines", () => {
  const t = new ExecTransport("ch1");
  const lines: string[] = [];
  t.onLine((l) => lines.push(l));
  mockSsh.emit("onData", { channelId: "ch1", data: '{"id":1,' });
  expect(lines).toEqual([]);
  mockSsh.emit("onData", { channelId: "ch1", data: '"result":{}}\n{"id":2' });
  mockSsh.emit("onData", { channelId: "other", data: "noise\n" });
  mockSsh.emit("onData", { channelId: "ch1", data: ',"result":"é"}\r\n\n' });
  expect(lines).toEqual(['{"id":1,"result":{}}', '{"id":2,"result":"é"}']);

  t.send('{"id":3}');
  expect(mockSsh.write).toHaveBeenCalledWith("ch1", '{"id":3}\n');

  const reasons: string[] = [];
  t.onClose((r) => reasons.push(r));
  mockSsh.emit("onChannelClose", { channelId: "ch1", reason: "eof" });
  expect(reasons).toEqual(["eof"]);
  t.close();
});

test("first_connect_pins_fingerprint", async () => {
  addHost();
  startConnections();
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledWith("h1", { host: "10.0.0.5", port: 22, user: "sam", fingerprint: undefined });
  expect(mockSsh.openExec).toHaveBeenCalledWith("h1", "zogsshd rpc");
  expect(useHosts.getState().hosts[0].fingerprint).toBe("SHA256:abc");
  const conn = getHostConn("h1");
  expect(conn.status).toBe("online");
  expect(conn.hello).toEqual(HELLO);
  expect(conn.rpc).toBeDefined();
  expect(conn.lastSeen).toEqual(expect.any(Number));
});

test("reconnect_backoff_sequence", async () => {
  addHost("SHA256:abc");
  mockSsh.connect.mockRejectedValue(Object.assign(new Error("refused"), { code: "connect_failed" }));
  startConnections();
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(1);
  expect(getHostConn("h1")).toMatchObject({ status: "offline", error: "refused" });

  for (const [i, seconds] of [1, 2, 4, 8, 16, 30, 30].entries()) {
    jest.advanceTimersByTime(seconds * 1000 - 1);
    await flush();
    expect(mockSsh.connect).toHaveBeenCalledTimes(i + 1);
    jest.advanceTimersByTime(1);
    await flush();
    expect(mockSsh.connect).toHaveBeenCalledTimes(i + 2);
  }
  // Pinned fingerprint is passed on every attempt.
  expect(mockSsh.connect).toHaveBeenLastCalledWith("h1", expect.objectContaining({ fingerprint: "SHA256:abc" }));
});

test("foreground_triggers_immediate_reconnect", async () => {
  addHost("SHA256:abc");
  mockSsh.connect.mockRejectedValueOnce(new Error("refused"));
  startConnections();
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(1);
  // Pending retry is in 1 s; foreground connects now.
  appStateHandler!("active");
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(2);
  expect(getHostConn("h1").status).toBe("online");
  // The old retry timer was cancelled.
  jest.advanceTimersByTime(5000);
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(2);
});

test("drop_while_online_reconnects", async () => {
  addHost("SHA256:abc");
  startConnections();
  await flush();
  expect(getHostConn("h1").status).toBe("online");
  mockSsh.emit("onDisconnect", { hostId: "h1", reason: "connection closed" });
  await flush();
  expect(getHostConn("h1").status).toBe("offline");
  jest.advanceTimersByTime(1000);
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(2);
  expect(getHostConn("h1").status).toBe("online");
});

test("mismatch_marks_error_and_stops_retrying", async () => {
  addHost("SHA256:old");
  mockSsh.connect.mockRejectedValue(Object.assign(new Error("host key differs"), { code: "host_key_mismatch" }));
  startConnections();
  await flush();
  const conn = getHostConn("h1");
  expect(conn.status).toBe("offline");
  expect(conn.error).toMatch(/host key/i);
  jest.advanceTimersByTime(120_000);
  appStateHandler!("active");
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(1);
  // The pin is kept as it was.
  expect(useHosts.getState().hosts[0].fingerprint).toBe("SHA256:old");
});

test("early_channel_events_are_kept", async () => {
  mockSsh.openExec.mockImplementation(async () => {
    // The companion writes before openExec resolves in JS.
    mockSsh.emit("onData", { channelId: "ch9", data: '{"a":1}\n{"b"' });
    mockSsh.emit("onData", { channelId: "other", data: '{"x":1}\n' });
    mockSsh.emit("onData", { channelId: "ch9", data: ":2}\n" });
    mockSsh.emit("onChannelClose", { channelId: "ch9", reason: "exit 1" });
    return "ch9";
  });
  const t = await ExecTransport.open("h1", "zogsshd rpc");
  const lines: string[] = [];
  const reasons: string[] = [];
  t.onLine((l) => lines.push(l));
  t.onClose((r) => reasons.push(r));
  await flush();
  expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  expect(reasons).toEqual(["exit 1"]);
});

test("update_during_inflight_connect_uses_only_new_attempt", async () => {
  addHost("SHA256:abc");
  const first = deferred<{ fingerprint: string }>();
  mockSsh.connect.mockReturnValueOnce(first.promise);
  startConnections();
  await flush();
  expect(getHostConn("h1").status).toBe("connecting");

  // The address changes while the first handshake runs.
  useHosts.getState().updateHost("h1", { address: "10.0.0.6" });
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(2);
  expect(mockSsh.connect).toHaveBeenLastCalledWith("h1", expect.objectContaining({ host: "10.0.0.6" }));
  expect(getHostConn("h1").status).toBe("online");

  // The old handshake finishes late: it must not open a channel or replace the connection.
  const rpc = getHostConn("h1").rpc;
  first.resolve({ fingerprint: "SHA256:abc" });
  await flush();
  expect(mockSsh.openExec).toHaveBeenCalledTimes(1);
  expect(getHostConn("h1").rpc).toBe(rpc);
  expect(getHostConn("h1").status).toBe("online");
});

test("stop_during_inflight_connect_disconnects", async () => {
  addHost("SHA256:abc");
  const first = deferred<{ fingerprint: string }>();
  mockSsh.connect.mockReturnValueOnce(first.promise);
  startConnections();
  await flush();
  useHosts.getState().removeHost("h1");
  await flush();
  mockSsh.disconnect.mockClear();
  first.resolve({ fingerprint: "SHA256:abc" });
  await flush();
  expect(mockSsh.disconnect).toHaveBeenCalledWith("h1");
  expect(mockSsh.openExec).not.toHaveBeenCalled();
  expect(getHostConn("h1").status).toBe("offline");
});

test("ping_every_15s_and_drop_on_timeout", async () => {
  addHost("SHA256:abc");
  startConnections();
  await flush();
  expect(getHostConn("h1").status).toBe("online");

  jest.advanceTimersByTime(14_999);
  await flush();
  expect(sentMethods()).toEqual(["hello"]);
  jest.advanceTimersByTime(1);
  await flush();
  expect(sentMethods()).toEqual(["hello", "ping"]);
  expect(getHostConn("h1").status).toBe("online");

  // The link dies: the next ping gets no answer and times out after 5 s.
  silent.add("ping");
  jest.advanceTimersByTime(15_000);
  await flush();
  expect(getHostConn("h1").status).toBe("online");
  jest.advanceTimersByTime(5_000);
  await flush();
  expect(getHostConn("h1")).toMatchObject({ status: "offline", error: expect.stringMatching(/ping/) });
  // Normal reconnect follows.
  silent.clear();
  jest.advanceTimersByTime(1_000);
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(2);
  expect(getHostConn("h1").status).toBe("online");
});

test("foreground_pings_at_once_and_background_stops_pings", async () => {
  addHost("SHA256:abc");
  startConnections();
  await flush();
  expect(getHostConn("h1").status).toBe("online");

  appStateHandler!("background");
  jest.advanceTimersByTime(60_000);
  await flush();
  expect(sentMethods()).toEqual(["hello"]);

  silent.add("ping");
  appStateHandler!("active");
  await flush();
  expect(sentMethods()).toEqual(["hello", "ping"]);
  jest.advanceTimersByTime(5_000);
  await flush();
  expect(getHostConn("h1").status).toBe("offline");
  expect(mockSsh.connect).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1_000);
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(2);
});

test("retry_now_connects_immediately_from_backoff", async () => {
  addHost("SHA256:abc");
  mockSsh.connect.mockRejectedValueOnce(new Error("refused"));
  startConnections();
  await flush();
  const before = getHostConn("h1");
  expect(before).toMatchObject({ status: "offline", error: "refused" });
  const n = retryNow("h1");
  expect(n).toBe(before.attempt + 1);
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(2);
  expect(getHostConn("h1")).toMatchObject({ status: "online", attempt: n });
  // The backoff timer was cancelled.
  jest.advanceTimersByTime(5000);
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(2);
});

test("retry_now_on_online_host_reconnects_with_fresh_hello", async () => {
  addHost("SHA256:abc");
  startConnections();
  await flush();
  const first = getHostConn("h1");
  expect(first.status).toBe("online");
  const n = retryNow("h1")!;
  // Right after the call the old hello is not offered as the new result.
  expect(getHostConn("h1")).toMatchObject({ status: "connecting", attempt: n });
  await flush();
  const second = getHostConn("h1");
  expect(second).toMatchObject({ status: "online", attempt: n });
  expect(second.rpc).not.toBe(first.rpc);
  expect(second.hello).toEqual(HELLO);
  expect(mockSsh.connect).toHaveBeenCalledTimes(2);
});

test("retry_now_after_mismatch_retries_once", async () => {
  addHost("SHA256:old");
  mockSsh.connect.mockRejectedValue(Object.assign(new Error("host key differs"), { code: "host_key_mismatch" }));
  startConnections();
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(1);
  retryNow("h1");
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(2);
  expect(getHostConn("h1").error).toMatch(/^Host key changed/);
  jest.advanceTimersByTime(60_000);
  await flush();
  expect(mockSsh.connect).toHaveBeenCalledTimes(2);
});

test("retry_now_unknown_host_returns_undefined", () => {
  startConnections();
  expect(retryNow("nope")).toBeUndefined();
});

test("hello_registers_push", async () => {
  addHost("SHA256:abc");
  startConnections();
  await flush();
  expect(getHostConn("h1").status).toBe("online");
  expect(mockRegisterPush).toHaveBeenCalledTimes(1);
  expect(mockRegisterPush).toHaveBeenCalledWith(getHostConn("h1").rpc, "h1");
});

test("pref_change_reregisters_online_hosts", async () => {
  addHost("SHA256:abc");
  startConnections();
  await flush();
  mockRegisterPush.mockClear();
  useNotifPrefs.getState().setPref("finished", false);
  expect(mockRegisterPush).toHaveBeenCalledTimes(1);
  expect(mockRegisterPush).toHaveBeenCalledWith(getHostConn("h1").rpc, "h1");
  // Setting the same value again sends nothing.
  useNotifPrefs.getState().setPref("finished", false);
  expect(mockRegisterPush).toHaveBeenCalledTimes(1);
});

test("quiet_at_desk_change_reregisters_online_hosts", async () => {
  addHost("SHA256:abc");
  startConnections();
  await flush();
  mockRegisterPush.mockClear();
  useNotifPrefs.getState().setPref("quiet_at_desk", false);
  expect(mockRegisterPush).toHaveBeenCalledTimes(1);
});

test("pref_change_skips_offline_hosts", async () => {
  addHost("SHA256:abc");
  mockSsh.connect.mockRejectedValue(Object.assign(new Error("refused"), { code: "connect_failed" }));
  startConnections();
  await flush();
  expect(getHostConn("h1").status).toBe("offline");
  useNotifPrefs.getState().setPref("needs_you", false);
  expect(mockRegisterPush).not.toHaveBeenCalled();
});
