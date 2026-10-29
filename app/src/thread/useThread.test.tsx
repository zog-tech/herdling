import type { AgentStatus, ThreadItem, ThreadPage, ThreadRef } from "@zogssh/protocol";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { RpcError } from "@/rpc/RpcClient";
import { useThread, type Thread } from "./useThread";

/** Fake rpc: `thread.*` answers come from the test; follow streams are kept so the test can push data. */
class FakeRpc {
  refs: ThreadRef[] = [];
  pages: Record<string, ThreadPage | "not_found"> = {};
  calls: { method: string; params: any }[] = [];
  follows: { logPath: string; from: number; push: (d: unknown) => void; cancelled: boolean }[] = [];

  async call<T>(method: string, params: any): Promise<T> {
    this.calls.push({ method, params });
    if (method === "thread.resolve") return (this.refs.length > 1 ? this.refs.shift() : this.refs[0]) as T;
    if (method === "thread.get") {
      const page = this.pages[params.log_path];
      if (page === "not_found" || !page) throw new RpcError("not_found", `no such log: ${params.log_path}`);
      return page as T;
    }
    throw new Error(`unexpected ${method}`);
  }

  async stream<T>(method: string, params: any, onData: (d: T) => void): Promise<() => void> {
    if (method !== "thread.follow") throw new Error(`unexpected ${method}`);
    const f = { logPath: params.log_path, from: params.from, push: onData as (d: unknown) => void, cancelled: false };
    this.follows.push(f);
    return () => {
      f.cancelled = true;
    };
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }
}

let mockRpc: FakeRpc;
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", rpc: mockRpc, attempt: 1 }),
}));

const ref = (log: string | null): ThreadRef => ({ kind: "claude", session: log ? "s" : null, log_path: log, cwd: "/home/sam/proj" });
const user = (id: string, text = id): ThreadItem => ({ kind: "user", id, ts: 1, text });
const page = (items: ThreadItem[], end: number, cursor: number | null = null): ThreadPage => ({ items, cursor, end });

let latest: Thread;
function Probe({ status }: { status?: AgentStatus }) {
  latest = useThread("host-1", "w1:p1", status);
  return null;
}

/** Lets pending promise chains run. */
async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => {});
}

let tree: ReactTestRenderer | undefined;
async function mount(status?: AgentStatus) {
  await act(async () => {
    tree = create(<Probe status={status} />);
  });
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRpc = new FakeRpc();
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

test("missing log file gives status waiting and retries until it exists", async () => {
  mockRpc.refs = [ref("/home/sam/.claude/projects/p/new.jsonl")];
  mockRpc.pages["/home/sam/.claude/projects/p/new.jsonl"] = "not_found";
  await mount("idle");
  expect(latest.status).toBe("waiting");
  expect(mockRpc.follows).toHaveLength(0);

  mockRpc.pages["/home/sam/.claude/projects/p/new.jsonl"] = page([user("u1")], 120);
  await act(async () => {
    jest.advanceTimersByTime(2_000);
  });
  await flush();
  expect(mockRpc.count("thread.resolve")).toBe(2);
  expect(latest.status).toBe("live");
  expect(latest.items.map((i) => i.id)).toEqual(["u1"]);
  expect(mockRpc.follows[0]).toMatchObject({ logPath: "/home/sam/.claude/projects/p/new.jsonl", from: 120 });
});

test("follow error re-resolves and follows again", async () => {
  mockRpc.refs = [ref("/logs/a.jsonl")];
  mockRpc.pages["/logs/a.jsonl"] = page([user("u1")], 50);
  await mount("working");
  expect(latest.status).toBe("live");

  await act(async () => {
    mockRpc.follows[0].push({ items: [user("u2")], offset: 80 });
  });
  expect(latest.items.map((i) => i.id)).toEqual(["u1", "u2"]);

  await act(async () => {
    mockRpc.follows[0].push({ error: "not_found" });
  });
  expect(latest.status).toBe("error");
  expect(latest.items.map((i) => i.id)).toEqual(["u1", "u2"]);

  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
  await flush();
  expect(mockRpc.count("thread.resolve")).toBe(2);
  expect(mockRpc.follows).toHaveLength(2);
  expect(latest.status).toBe("live");
});

test("idle with a new log path restarts on the new log", async () => {
  mockRpc.refs = [ref("/logs/old.jsonl"), ref("/logs/new.jsonl")];
  mockRpc.pages["/logs/old.jsonl"] = page([user("old1")], 10);
  mockRpc.pages["/logs/new.jsonl"] = page([user("new1")], 20);
  await mount("working");
  expect(latest.ref?.log_path).toBe("/logs/old.jsonl");

  await act(async () => {
    tree!.update(<Probe status="idle" />);
  });
  await flush();
  expect(latest.ref?.log_path).toBe("/logs/new.jsonl");
  expect(latest.items.map((i) => i.id)).toEqual(["new1"]);
  expect(mockRpc.follows[0].cancelled).toBe(true);
  expect(mockRpc.follows[1]).toMatchObject({ logPath: "/logs/new.jsonl", from: 20 });
});

test("idle with the same log path keeps following", async () => {
  mockRpc.refs = [ref("/logs/a.jsonl")];
  mockRpc.pages["/logs/a.jsonl"] = page([user("u1")], 10);
  await mount("working");
  await act(async () => {
    tree!.update(<Probe status="idle" />);
  });
  await flush();
  expect(mockRpc.count("thread.resolve")).toBe(2);
  expect(mockRpc.follows).toHaveLength(1);
  expect(mockRpc.follows[0].cancelled).toBe(false);
});

test("loadOlder fetches each cursor once", async () => {
  mockRpc.refs = [ref("/logs/a.jsonl")];
  mockRpc.pages["/logs/a.jsonl"] = page([user("u3")], 300, 200);
  await mount("idle");
  act(() => {
    latest.loadOlder();
    latest.loadOlder();
  });
  await flush();
  const gets = mockRpc.calls.filter((c) => c.method === "thread.get" && c.params.before === 200);
  expect(gets).toHaveLength(1);
});

test("restart on the same log keeps older pages", async () => {
  mockRpc.refs = [ref("/logs/a.jsonl")];
  mockRpc.pages["/logs/a.jsonl"] = page([user("u3")], 300, 200);
  await mount("working");
  // Older page.
  mockRpc.pages["/logs/a.jsonl"] = page([user("u1"), user("u2")], 300, null);
  act(() => latest.loadOlder());
  await flush();
  expect(latest.items.map((i) => i.id)).toEqual(["u1", "u2", "u3"]);
  expect(latest.hasOlder).toBe(false);

  // Follow ends; the retry reads the newest page again (u3 plus a new u4).
  mockRpc.pages["/logs/a.jsonl"] = page([user("u3"), user("u4")], 400, 200);
  await act(async () => {
    mockRpc.follows[0].push({ error: "io_error" });
  });
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
  await flush();
  expect(latest.items.map((i) => i.id)).toEqual(["u1", "u2", "u3", "u4"]);
  expect(latest.hasOlder).toBe(false);
});
