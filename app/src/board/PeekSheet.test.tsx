import * as Haptics from "expo-haptics";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useSeen } from "@/herdr/seen";
import { useSnapshots } from "@/herdr/snapshotStore";
import { Composer } from "@/thread/Composer";
import { AssistantMessage } from "@/thread/items/AssistantMessage";

import { PeekSheet } from "./PeekSheet";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light" },
}));
jest.mock("./BucketStatus", () => ({ BucketStatus: () => null }));
jest.mock("@/thread/Composer", () => ({ Composer: () => null }));
jest.mock("@/thread/items/AssistantMessage", () => ({ AssistantMessage: () => null }));
jest.mock("@/thread/useThread", () => ({
  useThread: () => ({
    items: [
      { kind: "user", id: "u", ts: 0, text: "go" },
      { kind: "assistant", id: "a1", ts: 1, markdown: "first" },
      { kind: "assistant", id: "a2", ts: 2, markdown: "**All tests pass.**" },
    ],
    status: "live",
    loadOlder: () => {},
    loadingOlder: false,
    hasOlder: false,
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const snapshot = (seq: number, status = "idle") =>
  ({
    agents: [{ pane_id: "w1:p1", tab_id: "t1", workspace_id: "w1", agent: "claude", agent_status: status, state_change_seq: seq }],
    workspaces: [{ workspace_id: "w1", label: "api", number: 1, agent_status: status }],
    tabs: [],
    panes: [],
  }) as any;

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  useSeen.setState({ seen: {} });
  useSnapshots.setState({ byHost: { "host-1": snapshot(7) }, errors: {} });
  (Haptics.impactAsync as jest.Mock).mockClear();
});

test("peek_shows_last_reply_and_composer_and_marks_seen_on_close", () => {
  act(() => {
    tree = create(<PeekSheet hostId="host-1" paneId="w1:p1" onOpenSession={() => {}} />);
  });
  // The haptic comes from the long press on the card, not from the sheet.
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  expect(tree!.root.findByType(AssistantMessage).props.markdown).toBe("**All tests pass.**");
  expect(tree!.root.findByType(Composer).props).toMatchObject({ hostId: "host-1", paneId: "w1:p1" });
  // Still open: not seen yet. A newer status while open is what gets marked.
  expect(useSeen.getState().seen["host-1:w1:p1"]).toBeUndefined();
  act(() => useSnapshots.setState({ byHost: { "host-1": snapshot(9) } }));
  act(() => tree!.unmount());
  expect(useSeen.getState().seen["host-1:w1:p1"]).toBe(9);
});

test("reply_action_focuses_the_composer", () => {
  act(() => {
    tree = create(<PeekSheet hostId="host-1" paneId="w1:p1" focusComposer onOpenSession={() => {}} />);
  });
  expect(tree!.root.findByType(Composer).props.autoFocus).toBe(true);
  act(() => tree!.unmount());
});

test("open_session_button_calls_back", () => {
  const open = jest.fn();
  act(() => {
    tree = create(<PeekSheet hostId="host-1" paneId="w1:p1" onOpenSession={open} />);
  });
  act(() => tree!.root.find((n) => n.props.accessibilityLabel === "Open session" && !!n.props.onPress).props.onPress());
  expect(open).toHaveBeenCalled();
  act(() => tree!.unmount());
});
