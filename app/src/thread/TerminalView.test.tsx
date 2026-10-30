import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";

import { colors } from "@/theme/tokens";

import { TerminalView } from "./TerminalView";

const mockCalls: any[] = [];
const mockRpc = {
  call: async (_m: string, params: any) => {
    mockCalls.push(params);
    return params.method === "pane.read" ? { read: { text: "\x1b[31mred\x1b[0m ok\r\n$ " } } : {};
  },
};
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc }),
}));
jest.mock("expo-router", () => ({ useIsFocused: () => true }));
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
const reads = () => mockCalls.filter((c) => c.method === "pane.read").length;

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  mockCalls.length = 0;
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

test("renders_colored_screen", async () => {
  await act(async () => {
    tree = create(<TerminalView hostId="host-1" paneId="w1:p1" />);
  });
  await flush();
  const red = tree!.root.findAll((n) => n.type === Text && n.props.children === "red");
  expect(red).toHaveLength(1);
  expect(red[0].props.style).toMatchObject({ color: colors.ansi[1] });
  expect(tree!.root.findAll((n) => n.props.accessibilityLabel === "Control C")).toHaveLength(0);
});

test("key_press_sends_and_rereads", async () => {
  await act(async () => {
    tree = create(<TerminalView hostId="host-1" paneId="w1:p1" controls />);
  });
  await flush();
  const before = reads();
  const ctrlC = tree!.root.find((n) => n.props.accessibilityLabel === "Control C" && !!n.props.onPress);
  await act(async () => ctrlC.props.onPress());
  await flush();
  expect(mockCalls).toContainEqual({ method: "pane.send_keys", params: { pane_id: "w1:p1", keys: ["ctrl+c"] } });
  expect(reads()).toBe(before + 1);
});

test("text_box_sends_line_then_enter", async () => {
  await act(async () => {
    tree = create(<TerminalView hostId="host-1" paneId="w1:p1" controls />);
  });
  await flush();
  const input = tree!.root.find((n) => n.props.accessibilityLabel === "Terminal input" && !!n.props.onChangeText);
  await act(async () => input.props.onChangeText("ls"));
  await act(async () => input.props.onSubmitEditing());
  await flush();
  const sends = mockCalls.filter((c) => c.method !== "pane.read");
  expect(sends).toEqual([
    { method: "pane.send_text", params: { pane_id: "w1:p1", text: "ls" } },
    { method: "pane.send_keys", params: { pane_id: "w1:p1", keys: ["enter"] } },
  ]);
  const after = tree!.root.find((n) => n.props.accessibilityLabel === "Terminal input" && !!n.props.onChangeText);
  expect(after.props.value).toBe("");
});
