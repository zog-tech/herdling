import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useTerminalText } from "./useTerminalText";

const mockCalls: any[] = [];
let mockScreen = "a";
let mockHello: { methods?: string[] } | undefined;
type OnData = (d: unknown) => void;
const mockWatch: { params?: any; onData?: OnData; off: jest.Mock; fail?: Error } = { off: jest.fn() };
const mockRpc = {
  call: async (_m: string, params: any) => {
    mockCalls.push(params);
    return { read: { text: mockScreen } };
  },
  stream: async (method: string, params: any, onData: OnData) => {
    if (mockWatch.fail) throw mockWatch.fail;
    expect(method).toBe("pane.watch");
    mockWatch.params = params;
    mockWatch.onData = onData;
    return mockWatch.off;
  },
};
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc, hello: mockHello }),
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
  mockHello = undefined;
  mockWatch.params = undefined;
  mockWatch.onData = undefined;
  mockWatch.fail = undefined;
  mockWatch.off = jest.fn();
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

describe("with pane.watch", () => {
  beforeEach(() => {
    mockHello = { methods: ["pane.watch"] };
  });

  test("watch_replaces_polling", async () => {
    await act(async () => {
      tree = create(<Probe enabled format="ansi" />);
    });
    await flush();
    expect(mockWatch.params).toEqual({ pane_id: "w1:p1", lines: 200, format: "ansi", interval_ms: 80 });
    await act(async () => mockWatch.onData?.({ revision: 0, text: "$ ls", truncated: false }));
    expect(latest.text).toBe("$ ls");
    await act(async () => jest.advanceTimersByTime(3000));
    await flush();
    expect(mockCalls).toHaveLength(0);
  });

  test("leaving_the_view_cancels_the_stream", async () => {
    await act(async () => {
      tree = create(<Probe enabled />);
    });
    await flush();
    expect(mockWatch.off).not.toHaveBeenCalled();
    await act(async () => tree!.update(<Probe enabled={false} />));
    expect(mockWatch.off).toHaveBeenCalledTimes(1);
  });

  test("a_failed_watch_falls_back_to_polling", async () => {
    mockWatch.fail = Object.assign(new Error("unknown method: pane.watch"), { code: "unknown_method" });
    await act(async () => {
      tree = create(<Probe enabled />);
    });
    await flush();
    expect(mockCalls).toHaveLength(1);
    expect(latest.text).toBe("a");
    await act(async () => jest.advanceTimersByTime(1000));
    await flush();
    expect(mockCalls).toHaveLength(2);
  });

  test("an_ended_stream_shows_the_error_and_polls", async () => {
    await act(async () => {
      tree = create(<Probe enabled />);
    });
    await flush();
    await act(async () => mockWatch.onData?.({ error: "pane_not_found", message: "pane w1:p1 not found" }));
    expect(mockWatch.off).toHaveBeenCalledTimes(1);
    await flush();
    expect(mockCalls).toHaveLength(1);
  });
});
