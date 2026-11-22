import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useSeen } from "./seen";
import { useSeenSync } from "./seenSync";
import type { AgentInfo, Snapshot } from "./snapshot";

const mockCalls: { method: string; params: unknown }[] = [];
let mockFail = false;
const mockRpc = {
  call: async (method: string, params: unknown) => {
    mockCalls.push({ method, params });
    if (mockFail) throw new Error("offline");
    return {};
  },
};
let mockMethods: string[] | undefined = ["agent.mark_seen"];
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc, hello: { methods: mockMethods } }),
}));

const agent = (pane_id: string, o: Partial<AgentInfo> = {}): AgentInfo => ({
  pane_id,
  tab_id: "tab",
  workspace_id: "ws",
  agent_status: "done",
  state_change_seq: 100,
  turn: 4,
  ...o,
});
const snap = (agents: AgentInfo[]): Snapshot => ({ workspaces: [], tabs: [], panes: [], agents }) as unknown as Snapshot;

function Probe({ host, snapshot }: { host: string; snapshot: Snapshot }) {
  useSeenSync(host, snapshot);
  return null;
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};

let trees: ReactTestRenderer[] = [];
const mount = async (el: React.ReactElement) => {
  await act(async () => {
    trees.push(create(el));
  });
  await flush();
  return trees[trees.length - 1];
};
const wait = async () => {
  await act(async () => jest.advanceTimersByTime(2000));
  await flush();
};

// Each test uses its own host: the sent turns are module state.
beforeEach(() => {
  jest.useFakeTimers();
  mockCalls.length = 0;
  mockFail = false;
  mockMethods = ["agent.mark_seen"];
});
afterEach(() => {
  act(() => trees.forEach((t) => t.unmount()));
  trees = [];
  jest.useRealTimers();
});

test("sends the local mark to the host once, after a pause", async () => {
  useSeen.setState({ seen: { "a:t1": 100 } });
  const tree = await mount(<Probe host="a" snapshot={snap([agent("t1"), agent("t2")])} />);
  expect(mockCalls).toEqual([]);
  await wait();
  expect(mockCalls).toEqual([{ method: "agent.mark_seen", params: { pane_id: "t1", turn: 4 } }]);
  // A new snapshot with the same state sends nothing again.
  await act(async () => tree.update(<Probe host="a" snapshot={snap([agent("t1"), agent("t2")])} />));
  await wait();
  expect(mockCalls).toHaveLength(1);
});

test("sends nothing to a host that does not list the method", async () => {
  mockMethods = undefined;
  useSeen.setState({ seen: { "b:t1": 100 } });
  await mount(<Probe host="b" snapshot={snap([agent("t1")])} />);
  await wait();
  expect(mockCalls).toEqual([]);
});

test("sends a failed mark again at the next change, without a queue", async () => {
  mockFail = true;
  useSeen.setState({ seen: { "c:t1": 100 } });
  const tree = await mount(<Probe host="c" snapshot={snap([agent("t1")])} />);
  await wait();
  expect(mockCalls).toHaveLength(1);
  await wait();
  expect(mockCalls).toHaveLength(1);
  mockFail = false;
  await act(async () => tree.update(<Probe host="c" snapshot={snap([agent("t1")])} />));
  await wait();
  expect(mockCalls).toHaveLength(2);
});
