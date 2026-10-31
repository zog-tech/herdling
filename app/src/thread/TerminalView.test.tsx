import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { colors } from "@/theme/tokens";

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
jest.mock("@/ui/haptics", () => ({ tap: jest.fn() }));

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
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

async function mount(controls = true) {
  await act(async () => {
    tree = create(
      <GestureHandlerRootView>
        <TerminalView hostId="host-1" paneId="w1:p1" controls={controls} />
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
