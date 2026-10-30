import { readFileSync } from "fs";
import { join } from "path";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useSnapshots } from "@/herdr/snapshotStore";
import { MicButton } from "@/voice/MicButton";

import { Composer } from "./Composer";

const screen = readFileSync(join(__dirname, "__fixtures__", "claude_bash_permission.txt"), "utf8");

const mockCalls: any[] = [];
const mockRpc = {
  call: async (_method: string, params: any) => {
    mockCalls.push(params);
    return params.method === "pane.read" ? { read: { text: screen } } : {};
  },
};
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc }),
}));
jest.mock("@/voice/MicButton", () => ({ MicButton: () => null }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: "success" },
}));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
const choiceButtons = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && /^\d\. /.test(n.props.accessibilityLabel) && !!n.props.onPress);
const sends = () => mockCalls.filter((c) => c.method === "pane.send_keys");

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  mockCalls.length = 0;
  useSnapshots.setState({ byHost: { "host-1": { agents: [{ pane_id: "w1:p1", agent_status: "blocked" }] } as any }, errors: {} });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

test("a double tap sends one digit and the answered menu hides", async () => {
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  await flush();
  const buttons = choiceButtons(tree!);
  expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual([
    "1. Yes",
    "2. Yes, and don't ask again for git status commands in /home/sam/proj",
    "3. No, and tell Claude what to do differently (esc)",
  ]);

  await act(async () => {
    buttons[0].props.onPress();
    buttons[0].props.onPress();
  });
  await flush();
  expect(sends()).toEqual([{ method: "pane.send_keys", params: { pane_id: "w1:p1", keys: ["1"] } }]);
  expect(choiceButtons(tree!)).toHaveLength(0);

  // The same menu is still on screen at the next poll: the buttons stay hidden, so no second digit can go out.
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
  await flush();
  expect(choiceButtons(tree!)).toHaveLength(0);
  expect(sends()).toHaveLength(1);
});

test("hidden_composer_polls_nothing_and_has_no_mic", async () => {
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} visible={false} />);
  });
  await act(async () => {
    jest.advanceTimersByTime(3_000);
  });
  await flush();
  expect(mockCalls).toHaveLength(0);
  expect(tree!.root.findAll((n) => n.type === MicButton)).toHaveLength(0);

  await act(async () => tree!.update(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} visible />));
  await flush();
  expect(mockCalls.filter((c) => c.method === "pane.read").length).toBeGreaterThan(0);
  expect(tree!.root.findAll((n) => n.type === MicButton)).toHaveLength(1);
});
