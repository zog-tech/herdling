import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useRecentCommands } from "@/terminal/recentCommands";
import { colors } from "@/theme/tokens";
import { showActionSheet } from "@/ui/nativeSheet";

import { TerminalView } from "./TerminalView";

const mockCalls: any[] = [];
let mockScreen = "\x1b[31mred\x1b[0m ok\r\n$ ";
/** Answers a typing call; a test can hold or fail it. */
let mockSend: (params: any) => Promise<unknown> = async () => ({ type: "ok" });
/** A new client per test: the app remembers per connection whether herdr has `pane.send_input`. */
const makeRpc = () => ({
  srttMs: undefined as number | undefined,
  call: async (method: string, params: any) => {
    if (method === "ping") return {};
    mockCalls.push(params);
    if (params.method === "pane.read") return { read: { text: mockScreen } };
    return mockSend(params);
  },
  onSrtt: () => () => {},
});
let mockRpc = makeRpc();
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc }),
}));
jest.mock("expo-router", () => ({ useIsFocused: () => true }));
jest.mock("@/ui/haptics", () => ({ tap: jest.fn(), press: jest.fn() }));
jest.mock("@/ui/nativeSheet", () => ({ showActionSheet: jest.fn() }));
const sheet = showActionSheet as jest.Mock;

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
const reads = () => mockCalls.filter((c) => c.method === "pane.read").length;
const sends = () => mockCalls.filter((c) => c.method !== "pane.read");
const err = (code: string) => Object.assign(new Error(code), { code });

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  mockCalls.length = 0;
  mockScreen = "\x1b[31mred\x1b[0m ok\r\n$ ";
  mockSend = async () => ({ type: "ok" });
  mockRpc = makeRpc();
  sheet.mockClear();
  useRecentCommands.setState({ byHost: {} });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

async function mount(controls = true, shell = false) {
  await act(async () => {
    tree = create(
      <GestureHandlerRootView>
        <TerminalView hostId="host-1" paneId="w1:p1" controls={controls} shell={shell} />
      </GestureHandlerRootView>,
    );
  });
  await flush();
}
const input = () => tree!.root.find((n) => n.props.accessibilityLabel === "Terminal input" && !!n.props.onChangeText);
const pressable = (label: string) => tree!.root.find((n) => n.props.accessibilityLabel === label && !!n.props.onPress);
const dimTexts = () =>
  tree!.root.findAll((n) => n.type === Text && n.props.style?.color?.endsWith?.("99")).map((n) => n.props.children);

async function typeLine(text: string) {
  await act(async () => input().props.onChangeText(text));
  await act(async () => input().props.onSubmitEditing());
}

test("renders_colored_screen", async () => {
  await mount(false);
  const red = tree!.root.findAll((n) => n.type === Text && n.props.children === "red");
  expect(red).toHaveLength(1);
  expect(red[0].props.style).toMatchObject({ color: colors.ansi[1] });
  expect(tree!.root.findAll((n) => n.props.accessibilityLabel === "Control C")).toHaveLength(0);
});

test("key_press_sends_one_call_and_rereads", async () => {
  await mount();
  const before = reads();
  await act(async () => pressable("Control C").props.onPress());
  await flush();
  expect(sends()).toEqual([{ method: "pane.send_input", params: { pane_id: "w1:p1", keys: ["ctrl+c"] } }]);
  expect(reads()).toBe(before + 1);
});

test("text_box_sends_line_and_enter_in_one_call", async () => {
  await mount();
  await typeLine("ls");
  await flush();
  expect(sends()).toEqual([{ method: "pane.send_input", params: { pane_id: "w1:p1", text: "ls", keys: ["enter"] } }]);
  expect(input().props.value).toBe("");
});

test("sent_line_shows_dimmed_until_the_screen_shows_it", async () => {
  let accept: () => void = () => {};
  mockSend = () => new Promise((r) => (accept = () => r({ type: "ok" })));
  await mount();
  await typeLine("make test");
  await flush();
  // The box is empty at once, and the line shows on the prompt line before the computer answers.
  expect(input().props.value).toBe("");
  expect(dimTexts()).toEqual(["make test"]);
  mockScreen = "red ok\r\n$ make test\r\nok\r\n$ ";
  await act(async () => accept());
  await flush();
  expect(dimTexts()).toEqual([]);
});

test("echo_goes_after_two_seconds_without_confirmation", async () => {
  mockSend = () => new Promise(() => {});
  await mount();
  await typeLine("sleep 9");
  await flush();
  expect(dimTexts()).toEqual(["sleep 9"]);
  await act(async () => jest.advanceTimersByTime(2_100));
  await flush();
  expect(dimTexts()).toEqual([]);
});

test("failed_line_comes_back_to_the_box_with_the_error", async () => {
  mockSend = async () => {
    throw err("pane_not_found");
  };
  await mount();
  await typeLine("ls");
  await flush();
  expect(input().props.value).toBe("ls");
  expect(dimTexts()).toEqual([]);
  expect(tree!.root.findAll((n) => n.type === Text && n.props.children === "pane_not_found").length).toBeGreaterThan(0);
});

test("older_herdr_falls_back_to_two_calls_and_remembers", async () => {
  mockSend = async (p) => {
    if (p.method === "pane.send_input") throw err("invalid_request");
    return {};
  };
  await mount();
  await typeLine("ls");
  await flush();
  await typeLine("pwd");
  await flush();
  expect(sends().map((c) => [c.method, c.params.text ?? c.params.keys])).toEqual([
    ["pane.send_input", "ls"],
    ["pane.send_text", "ls"],
    ["pane.send_keys", ["enter"]],
    ["pane.send_text", "pwd"],
    ["pane.send_keys", ["enter"]],
  ]);
});

test("latency_badge_shows_the_srtt", async () => {
  mockRpc.srttMs = 84.4;
  await mount();
  expect(tree!.root.findAll((n) => n.type === Text && n.props.children === "84 ms").length).toBeGreaterThan(0);
});

test("type_directly_sends_keystrokes_and_coalesces_text", async () => {
  await mount();
  await act(async () => pressable("Type directly").props.onPress());
  const zw = input().props.value as string;
  expect(zw).toBe("​​");
  await act(async () => input().props.onChangeText(`${zw}l`));
  await act(async () => input().props.onChangeText(`${zw}ls`));
  await act(async () => jest.advanceTimersByTime(20));
  await flush();
  // Backspace, then Enter: the Enter goes with no waiting text.
  await act(async () => input().props.onChangeText(`${zw}l`));
  await flush();
  await act(async () => input().props.onSubmitEditing());
  await flush();
  expect(sends().map((c) => c.params)).toEqual([
    { pane_id: "w1:p1", text: "ls" },
    { pane_id: "w1:p1", keys: ["backspace"] },
    { pane_id: "w1:p1", keys: ["enter"] },
  ]);
});

test("inactive_view_reads_nothing", async () => {
  // A session that is not selected (the two-column layout) must not follow its pane.
  await act(async () => {
    tree = create(
      <GestureHandlerRootView>
        <TerminalView hostId="host-1" paneId="w1:p1" active={false} />
      </GestureHandlerRootView>,
    );
  });
  await flush();
  await act(async () => jest.advanceTimersByTime(3000));
  expect(reads()).toBe(0);
});

const chip = (cmd: string) => pressable(`Recent command: ${cmd}`);
const recentRow = () => tree!.root.findAll((n) => n.props.accessibilityLabel === "Recent commands");

test("a shell keeps sent lines as recent commands; an agent pane does not", async () => {
  await mount(true, false);
  await typeLine("ls");
  await flush();
  expect(useRecentCommands.getState().byHost["host-1"]).toBeUndefined();
  expect(recentRow()).toHaveLength(0);
  act(() => tree!.unmount());

  await mount(true, true);
  expect(recentRow()).toHaveLength(0);
  await typeLine("pnpm test");
  await flush();
  expect(useRecentCommands.getState().byHost["host-1"]).toEqual(["pnpm test"]);
  expect(recentRow().length).toBeGreaterThan(0);
});

test("a tap on a chip puts the command in the box and sends nothing", async () => {
  useRecentCommands.setState({ byHost: { "host-1": ["git status", "make test"] } });
  await mount(true, true);
  await act(async () => chip("make test").props.onPress());
  await flush();
  expect(input().props.value).toBe("make test");
  expect(sends()).toEqual([]);
});

test("Run now in the chip menu sends the command and Enter", async () => {
  useRecentCommands.setState({ byHost: { "host-1": ["git status", "make test"] } });
  await mount(true, true);
  await act(async () => chip("make test").props.onLongPress());
  expect(sheet).toHaveBeenCalledTimes(1);
  const [opts, onPick] = sheet.mock.calls[0];
  expect(opts.options).toEqual(["Run now", "Remove", "Cancel"]);
  await act(async () => onPick(0));
  await flush();
  expect(sends()).toEqual([{ method: "pane.send_input", params: { pane_id: "w1:p1", text: "make test", keys: ["enter"] } }]);
  // The command moves to the front, and the box stays as it was.
  expect(useRecentCommands.getState().byHost["host-1"]).toEqual(["make test", "git status"]);
  expect(input().props.value).toBe("");
});

test("Remove in the chip menu removes the command", async () => {
  useRecentCommands.setState({ byHost: { "host-1": ["git status", "make test"] } });
  await mount(true, true);
  await act(async () => chip("git status").props.onLongPress());
  await act(async () => sheet.mock.calls[0][1](1));
  expect(useRecentCommands.getState().byHost["host-1"]).toEqual(["make test"]);
  expect(sends()).toEqual([]);
});

/** Gives the terminal scroll view a size: a view of 600 pt and content of `contentHeight` pt. */
async function measure(contentHeight: number) {
  const view = tree!.root.find((n) => !!n.props.onContentSizeChange && !!n.props.onLayout);
  await act(async () => view.props.onLayout({ nativeEvent: { layout: { width: 360, height: 600 } } }));
  await act(async () => view.props.onContentSizeChange(360, contentHeight));
  await flush();
}
/** herdr `pane.get` with a scroll field: `rows` screen rows and `scrollback` rows above them. */
const paneGet = (rows: number, scrollback: number) => async (p: any) =>
  p.method === "pane.get"
    ? { type: "pane_info", pane: { pane_id: "w1:p1", scroll: { max_offset_from_bottom: scrollback, offset_from_bottom: 0, viewport_rows: rows } } }
    : { type: "ok" };
const pageButtons = () => tree!.root.findAll((n) => n.props.accessibilityLabel === "Page up" && !!n.props.onPress);

test("full_screen_app_gets_page_buttons_that_send_page_keys", async () => {
  // The screen has 2 lines and herdr says the pane has 2 rows and no scrollback.
  mockSend = paneGet(2, 0);
  await mount();
  expect(pageButtons()).toHaveLength(0);
  await measure(100);
  expect(pageButtons()).toHaveLength(1);
  const before = reads();
  await act(async () => pressable("Page up").props.onPress());
  await flush();
  await act(async () => pressable("Page down").props.onPress());
  await flush();
  expect(sends().filter((c) => c.method !== "pane.get")).toEqual([
    { method: "pane.send_input", params: { pane_id: "w1:p1", text: "\x1b[5~" } },
    { method: "pane.send_input", params: { pane_id: "w1:p1", text: "\x1b[6~" } },
  ]);
  expect(reads()).toBe(before + 2);
});

test("no_page_buttons_for_a_short_shell_or_a_screen_that_scrolls", async () => {
  // A short shell: 2 lines of 40 rows.
  mockSend = paneGet(40, 0);
  await mount();
  await measure(100);
  expect(pageButtons()).toHaveLength(0);
  act(() => tree?.unmount());
  // Content taller than the view: the phone scrolls it, and herdr is not asked.
  mockCalls.length = 0;
  mockSend = paneGet(2, 0);
  mockRpc = makeRpc();
  await mount();
  await measure(2000);
  expect(pageButtons()).toHaveLength(0);
  expect(mockCalls.filter((c) => c.method === "pane.get")).toHaveLength(0);
});

test("no_page_buttons_without_controls", async () => {
  mockSend = paneGet(2, 0);
  await mount(false);
  await measure(100);
  expect(pageButtons()).toHaveLength(0);
});
