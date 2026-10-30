import { GestureHandlerRootView } from "react-native-gesture-handler";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { LiveToolContext, newestRunningTool, type LiveTool } from "../LiveToolContext";
import { toolTime } from "../toolView";
import { ToolCard } from "./ToolCard";

const mockReads: string[] = [];
const mockRpc = {
  call: async (_m: string, params: any) => {
    mockReads.push(params.params.pane_id);
    return { read: { text: "line 1\nline 2\n\n" } };
  },
};
jest.mock("@/hosts/connection", () => ({ useHostConn: () => ({ status: "online", rpc: mockRpc }) }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

const T0 = 1_000_000;
const live = (over: Partial<LiveTool> = {}): LiveTool => ({ hostId: "studio", paneId: "w1:p1", newestRunningId: "t2", active: true, ...over });

function card(id: string, result?: { ok: boolean; text: string; truncated: boolean; ts?: number }, ctx: LiveTool | null = live()) {
  return (
    <GestureHandlerRootView>
      <LiveToolContext.Provider value={ctx}>
        <ToolCard id={id} ts={T0} name="Bash" inputSummary="pnpm test" input={{ command: "pnpm test" }} result={result} />
      </LiveToolContext.Provider>
    </GestureHandlerRootView>
  );
}
const texts = (t: ReactTestRenderer) => t.root.findAll((n) => (n.type as unknown) === "Text").map((n) => n.props.children).flat();
const header = (t: ReactTestRenderer) => t.root.find((n) => n.props.accessibilityState?.expanded !== undefined && !!n.props.onPress);
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0 + 12_000);
  mockReads.length = 0;
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

test("tool_time_formats_running_and_done", () => {
  expect(toolTime(T0, undefined, T0 + 12_400)).toBe("12s");
  expect(toolTime(T0, undefined, T0 + 300)).toBe("0s");
  expect(toolTime(T0, { ok: true, text: "", truncated: false, ts: T0 + 72_000 }, 0)).toBe("1m 12s");
  expect(toolTime(T0, { ok: true, text: "", truncated: false, ts: T0 + 200 }, 0)).toBe("<1s");
  // An older host sends no result time: no duration.
  expect(toolTime(T0, { ok: true, text: "", truncated: false }, 0)).toBeUndefined();
});

test("newest_running_tool_is_the_last_without_a_result", () => {
  const items = [
    { kind: "tool", id: "t1" },
    { kind: "tool", id: "t2" },
    { kind: "tool", id: "t3", result: {} },
  ];
  expect(newestRunningTool(items)).toBe("t2");
  expect(newestRunningTool([])).toBeUndefined();
});

const clock = (t: ReactTestRenderer) => t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "ticking-duration");

test("running_card_ticks_and_done_card_shows_its_duration", () => {
  act(() => {
    tree = create(card("t2"));
  });
  // The running timer is the UI-thread clock; VoiceOver hears whole minutes.
  expect(clock(tree!)[0].props.defaultValue).toBe("12s");
  expect(header(tree!).props.accessibilityLabel).toBe("Bash pnpm test, running, under a minute");
  act(() => tree!.update(card("t2", { ok: true, text: "ok", truncated: false, ts: T0 + 20_000 })));
  expect(header(tree!).props.accessibilityLabel).toBe("Bash pnpm test, done, 20s");
  expect(clock(tree!)).toHaveLength(0);
  act(() => jest.advanceTimersByTime(5000));
  expect(texts(tree!)).toContain("20s");
});

test("open_newest_running_card_polls_and_stops_on_result", async () => {
  await act(async () => {
    tree = create(card("t2"));
  });
  await flush();
  expect(mockReads).toHaveLength(0);
  act(() => header(tree!).props.onPress());
  await flush();
  expect(mockReads).toEqual(["w1:p1"]);
  expect(texts(tree!)).toContain("line 1\nline 2");
  await act(async () => jest.advanceTimersByTime(1500));
  await flush();
  expect(mockReads).toHaveLength(2);
  await act(async () => tree!.update(card("t2", { ok: true, text: "done", truncated: false })));
  await act(async () => jest.advanceTimersByTime(4500));
  await flush();
  expect(mockReads).toHaveLength(2);
  expect(texts(tree!)).toContain("done");
});

test("only_the_newest_running_card_polls_and_not_when_unfocused", async () => {
  await act(async () => {
    tree = create(card("t1"));
  });
  act(() => header(tree!).props.onPress());
  await act(async () => jest.advanceTimersByTime(3000));
  await flush();
  expect(mockReads).toHaveLength(0);
  expect(texts(tree!)).toContain("Running…");
  await act(async () => tree!.update(card("t2", undefined, live({ active: false }))));
  act(() => header(tree!).props.onPress());
  await act(async () => jest.advanceTimersByTime(3000));
  await flush();
  expect(mockReads).toHaveLength(0);
});

test("expand_opens_the_tool_view", () => {
  act(() => {
    tree = create(card("t2"));
  });
  act(() => header(tree!).props.onPress());
  act(() => tree!.root.find((n) => n.props.accessibilityLabel === "Expand" && !!n.props.onPress).props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/tool");
  const { useToolView } = require("../toolView");
  expect(useToolView.getState().current).toMatchObject({ id: "t2", hostId: "studio", paneId: "w1:p1", name: "Bash" });
});
