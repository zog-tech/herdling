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

import { ExecTransport, getHostConn, startConnections, stopConnections } from "./connection";
import { useHosts } from "./store";

const HELLO = { host: "box", os: "macos", zogsshd: "0.1.0", herdr_ok: true };

/** Make `write` answer every rpc request line with `result`. */
function answerRequests(result: unknown = HELLO) {
  mockSsh.write.mockImplementation(async (ch: string, data: string) => {
    const req = JSON.parse(data);
    queueMicrotask(() => mockSsh.emit("onData", { channelId: ch, data: JSON.stringify({ id: req.id, result }) + "\n" }));
  });
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
  appStateHandler = undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_t: any, cb: any) => {
    appStateHandler = cb;
    return { remove: () => {} } as any;
  });
  useHosts.setState({ hosts: [] });
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
