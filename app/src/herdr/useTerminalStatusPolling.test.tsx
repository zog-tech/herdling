import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useTerminalStatus } from "./terminalStatus";
import { STATUS_POLL_MS, useTerminalStatusPolling } from "./useTerminalStatusPolling";

const mockCalls: string[] = [];
const mockRpc = {
  call: async (_method: string, p: { params: { pane_id: string } }) => {
    mockCalls.push(p.params.pane_id);
    return { process_info: { shell_pid: 1, foreground_process_group_id: 2, foreground_processes: [{ pid: 2, cmdline: "pnpm dev" }] } };
  },
};
let mockStatus = "online";
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: mockStatus, attempt: 1, rpc: mockRpc }),
}));

function Probe({ host, panes, enabled }: { host: string; panes: string[]; enabled: boolean }) {
  useTerminalStatusPolling(host, panes, enabled);
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

// Each test uses its own host: the poll gate of a host is shared module state.
beforeEach(() => {
  jest.useFakeTimers();
  mockCalls.length = 0;
  mockStatus = "online";
  useTerminalStatus.setState({ byKey: {} });
});
afterEach(() => {
  act(() => trees.forEach((t) => t.unmount()));
  trees = [];
  jest.useRealTimers();
});

test("polls every 5 s and stores the status", async () => {
  await mount(<Probe host="a" panes={["p1", "p2"]} enabled />);
  expect(mockCalls).toEqual(["p1", "p2"]);
  expect(useTerminalStatus.getState().byKey["a:p1"]).toEqual({ kind: "running", command: "pnpm dev" });
  await act(async () => jest.advanceTimersByTime(STATUS_POLL_MS));
  await flush();
  expect(mockCalls).toHaveLength(4);
});

test("does not poll when the screen is not focused", async () => {
  await mount(<Probe host="b" panes={["p1"]} enabled={false} />);
  await act(async () => jest.advanceTimersByTime(STATUS_POLL_MS * 3));
  await flush();
  expect(mockCalls).toHaveLength(0);
});

test("stops when the screen loses focus", async () => {
  const t = await mount(<Probe host="c" panes={["p1"]} enabled />);
  await act(async () => t.update(<Probe host="c" panes={["p1"]} enabled={false} />));
  const before = mockCalls.length;
  await act(async () => jest.advanceTimersByTime(STATUS_POLL_MS * 3));
  await flush();
  expect(mockCalls).toHaveLength(before);
});

test("does not poll with no panes or an offline host", async () => {
  await mount(<Probe host="d" panes={[]} enabled />);
  mockStatus = "offline";
  await mount(<Probe host="e" panes={["p1"]} enabled />);
  await act(async () => jest.advanceTimersByTime(STATUS_POLL_MS * 2));
  await flush();
  expect(mockCalls).toHaveLength(0);
});

test("two users of one host share one poll every 5 s", async () => {
  await mount(<Probe host="f" panes={["p1"]} enabled />);
  await act(async () => jest.advanceTimersByTime(1_000));
  await mount(<Probe host="f" panes={["p1", "p2"]} enabled />);
  // The first poll of the second user comes too soon after the last poll.
  expect(mockCalls).toEqual(["p1"]);
  await act(async () => jest.advanceTimersByTime(STATUS_POLL_MS));
  await flush();
  // One poll of the union in the next 5 s, not two.
  expect(mockCalls).toEqual(["p1", "p1", "p2"]);
});
