import { GestureHandlerRootView } from "react-native-gesture-handler";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import ToolScreen from "@/app/tool";
import { openToolView } from "./toolView";

jest.mock("@/hosts/connection", () => ({ useHostConn: () => ({ status: "offline", rpc: undefined }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true }), useIsFocused: () => true }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

const T0 = 1_000_000;
const clock = (t: ReactTestRenderer) => t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "ticking-duration");

test("full_tool_view_timer_ticks_while_the_tool_runs", () => {
  jest.useFakeTimers();
  jest.setSystemTime(T0 + 12_000);
  openToolView({ id: "t1", hostId: "h", paneId: "p", name: "Bash", input: { command: "ls" }, ts: T0 });
  let t!: ReactTestRenderer;
  act(() => {
    t = create(
      <GestureHandlerRootView>
        <ToolScreen />
      </GestureHandlerRootView>,
    );
  });
  // Before, the time was read once at render and never moved. Now it is the UI-thread clock.
  expect(clock(t)).toHaveLength(1);
  expect(clock(t)[0].props.defaultValue).toBe("12s");
  act(() => openToolView({ id: "t1", hostId: "h", paneId: "p", name: "Bash", input: { command: "ls" }, ts: T0, result: { ok: true, text: "", truncated: false, ts: T0 + 20_000 } }));
  expect(clock(t)).toHaveLength(0);
  act(() => t.unmount());
  jest.useRealTimers();
});

/** The strings of the Text nodes. A `LinkedText` child counts as its text. */
const texts = (t: ReactTestRenderer) =>
  t.root
    .findAll((n) => (n.type as unknown) === "Text")
    .map((n) => n.props.children)
    .flat()
    .map((c: unknown) => (c && typeof c === "object" && "props" in c && typeof (c as { props: { text?: unknown } }).props.text === "string" ? (c as { props: { text: string } }).props.text : c));

test("full_screen_shows_the_edit_diff", () => {
  openToolView({ id: "t2", hostId: "h", paneId: "p", name: "Edit", input: { file_path: "src/a.ts", old_string: "a", new_string: "b" }, ts: T0, result: { ok: true, text: "Updated", truncated: false, ts: T0 + 500 } });
  let t!: ReactTestRenderer;
  act(() => {
    t = create(
      <GestureHandlerRootView>
        <ToolScreen />
      </GestureHandlerRootView>,
    );
  });
  const all = texts(t);
  expect(all).toEqual(expect.arrayContaining(["-a", "+b"]));
  expect(all.join("\n")).not.toContain("old_string");
  act(() => t.unmount());
});
