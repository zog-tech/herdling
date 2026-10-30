import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useSnapshots } from "@/herdr/snapshotStore";

import { useBoard } from "./boardStore";
import { PREVIEW_POLL_MS, usePreviewPolling } from "./usePreviewPolling";

const mockCalls: string[] = [];
let mockFail: { code: string } | undefined;
const mockRpc = {
  call: async (method: string) => {
    mockCalls.push(method);
    if (mockFail) throw Object.assign(new Error(mockFail.code), mockFail);
    return { previews: [{ pane_id: "w1:p1", activity: "Thinking", status_since: 5, source: "log" }] };
  },
};
let mockMethods: string[] | undefined;
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc, hello: { methods: mockMethods } }),
}));

function Probe({ enabled }: { enabled: boolean }) {
  usePreviewPolling("host-1", enabled);
  return null;
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  mockCalls.length = 0;
  mockFail = undefined;
  mockMethods = undefined;
  useBoard.setState({ previews: {} });
  useSnapshots.setState({ byHost: { "host-1": { agents: [{ pane_id: "w1:p1", agent_status: "working" }] } as any }, errors: {} });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

test("polls_every_3s_and_stores_previews_with_status", async () => {
  await act(async () => {
    tree = create(<Probe enabled />);
  });
  await flush();
  expect(mockCalls).toEqual(["agents.preview"]);
  expect(useBoard.getState().previews["host-1:w1:p1"]).toMatchObject({ activity: "Thinking", status: "working" });
  await act(async () => jest.advanceTimersByTime(PREVIEW_POLL_MS));
  await flush();
  expect(mockCalls).toHaveLength(2);
});

test("poll_stops_when_unfocused", async () => {
  await act(async () => {
    tree = create(<Probe enabled />);
  });
  await flush();
  await act(async () => tree!.update(<Probe enabled={false} />));
  const before = mockCalls.length;
  await act(async () => jest.advanceTimersByTime(PREVIEW_POLL_MS * 5));
  await flush();
  expect(mockCalls).toHaveLength(before);
});

test("does_not_poll_while_unfocused", async () => {
  await act(async () => {
    tree = create(<Probe enabled={false} />);
  });
  await act(async () => jest.advanceTimersByTime(PREVIEW_POLL_MS * 3));
  await flush();
  expect(mockCalls).toHaveLength(0);
});

test("old_companion_without_method_is_not_asked_again", async () => {
  mockFail = { code: "unknown_method" };
  await act(async () => {
    tree = create(<Probe enabled />);
  });
  await flush();
  await act(async () => jest.advanceTimersByTime(PREVIEW_POLL_MS * 3));
  await flush();
  expect(mockCalls).toHaveLength(1);
});

test("does_not_poll_a_host_whose_method_list_lacks_agents_preview", async () => {
  mockMethods = ["ping"];
  await act(async () => {
    tree = create(<Probe enabled />);
  });
  await flush();
  await act(async () => jest.advanceTimersByTime(PREVIEW_POLL_MS * 3));
  expect(mockCalls).toEqual([]);
});
