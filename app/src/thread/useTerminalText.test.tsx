import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useTerminalText } from "./useTerminalText";

const mockCalls: any[] = [];
let mockScreen = "a";
const mockRpc = {
  call: async (_m: string, params: any) => {
    mockCalls.push(params);
    return { read: { text: mockScreen } };
  },
};
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc }),
}));

let latest: ReturnType<typeof useTerminalText>;
let renders = 0;
function Probe({ enabled, format }: { enabled: boolean; format?: "text" | "ansi" }) {
  renders++;
  latest = useTerminalText("host-1", "w1:p1", enabled, format ? { format } : undefined);
  return null;
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  mockCalls.length = 0;
  mockScreen = "a";
  renders = 0;
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

test("ansi_reads_pane_with_escapes_every_second", async () => {
  await act(async () => {
    tree = create(<Probe enabled format="ansi" />);
  });
  await flush();
  expect(mockCalls).toEqual([
    { method: "pane.read", params: { pane_id: "w1:p1", source: "recent", lines: 200, format: "ansi", strip_ansi: false } },
  ]);
  await act(async () => jest.advanceTimersByTime(1000));
  await flush();
  expect(mockCalls).toHaveLength(2);
});

test("default_is_plain_text", async () => {
  await act(async () => {
    tree = create(<Probe enabled />);
  });
  await flush();
  expect(mockCalls[0].params).toMatchObject({ format: "text", strip_ansi: true });
  expect(latest.text).toBe("a");
});

test("unchanged_screen_does_not_rerender", async () => {
  await act(async () => {
    tree = create(<Probe enabled format="ansi" />);
  });
  await flush();
  // React may render once more before it bails out on an equal state; after that, no tick renders.
  await act(async () => jest.advanceTimersByTime(1000));
  await flush();
  const before = renders;
  for (let i = 0; i < 3; i++) {
    await act(async () => jest.advanceTimersByTime(1000));
    await flush();
  }
  expect(mockCalls.length).toBeGreaterThanOrEqual(5);
  expect(renders).toBe(before);
  mockScreen = "b";
  await act(async () => jest.advanceTimersByTime(1000));
  await flush();
  expect(latest.text).toBe("b");
});

test("refresh_reads_now", async () => {
  await act(async () => {
    tree = create(<Probe enabled format="ansi" />);
  });
  await flush();
  act(() => latest.refresh());
  await flush();
  expect(mockCalls).toHaveLength(2);
});

test("disabled_reads_nothing", async () => {
  await act(async () => {
    tree = create(<Probe enabled={false} />);
  });
  await act(async () => jest.advanceTimersByTime(3000));
  await flush();
  expect(mockCalls).toHaveLength(0);
  act(() => latest.refresh());
  expect(mockCalls).toHaveLength(0);
});
