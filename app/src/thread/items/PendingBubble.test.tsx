import { act, create, type ReactTestRenderer } from "react-test-renderer";

const mockCall = jest.fn(async (..._a: unknown[]) => ({}));
let mockRpc: { call: typeof mockCall } | undefined = { call: mockCall };
jest.mock("@/hosts/connection", () => ({ useHostConn: () => ({ status: "online", rpc: mockRpc }) }));
jest.mock("@/ui/haptics", () => ({ tap: jest.fn(), press: jest.fn(), commit: jest.fn(), warn: jest.fn(), fail: jest.fn() }));

import { useSnapshots } from "@/herdr/snapshotStore";

import { addPending, setPendingState, usePending } from "../pending";
import { useSendNowStore } from "../sendNow";
import { PendingBubbles } from "./PendingBubble";

const H = "studio";
const P = "w1:p1";
let tree: ReactTestRenderer | undefined;

const agent = (agent_status: string) =>
  useSnapshots.setState({ byHost: { [H]: { agents: [{ pane_id: P, agent: "claude", agent_status }] } as any }, errors: {} });
const queue = (...texts: string[]) =>
  texts.forEach((t) => {
    const id = addPending(H, P, t);
    setPendingState(H, P, id, "queued");
  });
const mount = async () => {
  await act(async () => {
    tree = create(<PendingBubbles hostId={H} paneId={P} />);
  });
};
const buttons = () =>
  tree!.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.endsWith("Send now") && !!n.props.onPress);
const texts = () => tree!.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);

beforeEach(() => {
  // The "sent" hold and the error line end on timers.
  jest.useFakeTimers();
  mockRpc = { call: mockCall };
  mockCall.mockClear();
  usePending.setState({ byPane: {} });
  useSendNowStore.setState({ byPane: {} });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("the newest queued bubble has one Send now button, and the state line keeps only Queued", async () => {
  agent("working");
  queue("First", "Second");
  await mount();
  expect(buttons()).toHaveLength(1);
  const [b] = buttons();
  expect(b.props.accessibilityRole).toBe("button");
  expect(b.props.accessibilityHint).toBe("Stops the current turn. The agent then gets the queued messages.");
  // The button is in the bubble row of the second bubble, not in its state line.
  const lines = tree!.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityLabel === "Your message, Queued");
  expect(lines).toHaveLength(2);
  for (const l of lines) expect(l.findAll((n) => n.props.accessibilityLabel === "Send now")).toHaveLength(0);
  const row = tree!.root.findAll((n) => typeof n.type === "string" && n.props.style?.flexDirection === "row-reverse");
  expect(row).toHaveLength(1);
  expect(row[0].findAll((n) => n.props.text === "Second")).not.toHaveLength(0);
});

test("no Send now while the agent does not work", async () => {
  agent("idle");
  queue("First");
  await mount();
  expect(buttons()).toHaveLength(0);
  expect(texts()).not.toContain("Send now");
});

test("a tap presses Esc once and shows Sending now in the same place", async () => {
  agent("working");
  queue("First");
  await mount();
  await act(async () => buttons()[0].props.onPress());
  expect(mockCall).toHaveBeenCalledTimes(1);
  expect(buttons()).toHaveLength(0);
  expect(texts()).toContain("Sending now…");
  const row = tree!.root.findAll((n) => n.props.style?.flexDirection === "row-reverse");
  expect(row[0].findAll((n) => n.props.children === "Sending now…")).not.toHaveLength(0);
  // The "sent" hold ends on a timer, then the button comes back.
  act(() => jest.runOnlyPendingTimers());
  expect(buttons()).toHaveLength(1);
});

test("a failed key shows the error and Retry on the button", async () => {
  agent("working");
  queue("First");
  mockCall.mockRejectedValueOnce(new Error("Host offline"));
  await mount();
  await act(async () => buttons()[0].props.onPress());
  const [b] = buttons();
  expect(b.props.accessibilityLabel).toBe("Can't send now: Host offline. Send now");
  expect(texts()).toContain("Can't send now: Host offline · Retry");
});

test("the button is off with no connection", async () => {
  agent("working");
  queue("First");
  mockRpc = undefined;
  await mount();
  const [b] = buttons();
  expect(b.props.disabled).toBe(true);
  expect(b.props.accessibilityState).toEqual({ disabled: true });
});
