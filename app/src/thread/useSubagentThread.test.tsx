import type { SubagentPage, ThreadItem } from "@zogssh/protocol";
import { act, create } from "react-test-renderer";

import { useSubagentThread } from "./useSubagentThread";

const SUB = "/home/sam/.claude/projects/p/sess1/subagents/agent-a1.jsonl";
const user = (id: string): ThreadItem => ({ kind: "user", id, ts: 1, text: id });

class FakeRpc {
  calls: { method: string; params: any }[] = [];
  pages: SubagentPage[] = [];
  follows: { logPath: string; from: number; push: (d: unknown) => void }[] = [];
  async call<T>(method: string, params: any): Promise<T> {
    this.calls.push({ method, params });
    if (method !== "thread.subagent") throw new Error(`unexpected ${method}`);
    return this.pages.shift() as T;
  }
  async stream<T>(method: string, params: any, onData: (d: T) => void): Promise<() => void> {
    if (method !== "thread.follow") throw new Error(`unexpected ${method}`);
    this.follows.push({ logPath: params.log_path, from: params.from, push: onData as (d: unknown) => void });
    return () => {};
  }
}

let mockRpc: FakeRpc;
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", rpc: mockRpc, attempt: 1 }),
}));

let latest: ReturnType<typeof useSubagentThread>;
function Probe() {
  latest = useSubagentThread("host-1", "/home/sam/.claude/projects/p/sess1.jsonl", "a1");
  return null;
}
async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => {});
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRpc = new FakeRpc();
});
afterEach(() => jest.useRealTimers());

async function mount() {
  await act(async () => {
    create(<Probe />);
  });
  await flush();
}

test("loads_page_then_follows_subagent_log", async () => {
  mockRpc.pages = [{ items: [user("s1")], cursor: null, end: 120, log_path: SUB }];
  await mount();
  expect(latest.items.map((i) => i.id)).toEqual(["s1"]);
  expect(latest.status).toBe("live");
  expect(latest.hasOlder).toBe(false);
  expect(mockRpc.calls[0]).toEqual({
    method: "thread.subagent",
    params: { log_path: "/home/sam/.claude/projects/p/sess1.jsonl", agent_id: "a1", limit: 40 },
  });
  expect(mockRpc.follows).toHaveLength(1);
  expect(mockRpc.follows[0].logPath).toBe(SUB);
  expect(mockRpc.follows[0].from).toBe(120);
  await act(async () => mockRpc.follows[0].push({ items: [user("s2")], offset: 200 }));
  expect(latest.items.map((i) => i.id)).toEqual(["s1", "s2"]);
});

test("loads_older_pages_with_before_cursor", async () => {
  mockRpc.pages = [
    { items: [user("s2")], cursor: 50, end: 120, log_path: SUB },
    { items: [user("s1")], cursor: null, end: 120, log_path: SUB },
  ];
  await mount();
  expect(latest.hasOlder).toBe(true);
  await act(async () => latest.loadOlder());
  await flush();
  expect(mockRpc.calls[1].params.before).toBe(50);
  expect(latest.items.map((i) => i.id)).toEqual(["s1", "s2"]);
  expect(latest.hasOlder).toBe(false);
});

test("running_comes_from_the_page_and_ends_with_the_follow", async () => {
  mockRpc.pages = [{ items: [user("s1")], cursor: null, end: 120, log_path: SUB, running: true }];
  await mount();
  expect(latest.running).toBe(true);
  await act(async () => mockRpc.follows[0].push({ items: [], offset: 120, agent_running: false }));
  expect(latest.running).toBe(false);
  expect(latest.items.map((i) => i.id)).toEqual(["s1"]);
});

test("running_is_unknown_on_an_older_host", async () => {
  mockRpc.pages = [{ items: [user("s1")], cursor: null, end: 120, log_path: SUB }];
  await mount();
  expect(latest.running).toBeUndefined();
});
