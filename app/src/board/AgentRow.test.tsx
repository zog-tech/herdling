import { act, create, type ReactTestRenderer } from "react-test-renderer";
import Svg from "react-native-svg";

import { AgentRow } from "./AgentRow";
import { BoardHint } from "./BoardHint";
import type { BoardItem } from "./buckets";

jest.mock("@/ui/haptics", () => ({ press: jest.fn(), peek: jest.fn(), tap: jest.fn() }));
// The gestures and the swipeable need the native runtime. The row content is what these tests check.
jest.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  useTapGesture: () => ({}),
  useLongPressGesture: () => ({}),
  useExclusiveGestures: () => ({}),
}));
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { forwardRef } = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    SwipeDirection: { LEFT: "left", RIGHT: "right" },
    default: forwardRef(({ children }: { children: React.ReactNode }, _ref) => <View>{children}</View>),
  };
});

const item = (patch: Partial<BoardItem> = {}): BoardItem => ({
  key: "h:p1",
  hostId: "h",
  hostName: "studio.local",
  workspace: "api",
  title: "api",
  subtitle: "studio.local · claude",
  agent: { pane_id: "p1", tab_id: "t1", workspace_id: "w1", agent: "claude", agent_status: "idle", state_change_seq: 1 },
  bucket: "idle",
  ...patch,
});

const actions = () => ({
  onOpen: jest.fn(),
  onPeek: jest.fn(),
  onMarkRead: jest.fn(),
  onReply: jest.fn(),
  onRestart: jest.fn(),
  onMenu: jest.fn(),
});

let mounted: ReactTestRenderer[] = [];
// Unmount after each test: the card clock is a JS interval.
afterEach(() => {
  act(() => mounted.forEach((t) => t.unmount()));
  mounted = [];
});

const render = (el: React.ReactElement) => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(el);
  });
  mounted.push(t);
  return t;
};
const texts = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);
const menu = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("More actions") && !!n.props.onPress);

test("flat_keeps_the_menu_button_and_shows_no_placeholder", () => {
  const t = render(<AgentRow item={item()} rowStyle="flat" {...actions()} />);
  expect(menu(t)).toHaveLength(1);
  expect(texts(t)).not.toContain("Waiting for your next prompt");
  expect(texts(t)).not.toContain("Open");
});

test("divided_hides_the_menu_button_and_shows_the_idle_placeholder", () => {
  const t = render(<AgentRow item={item()} rowStyle="divided" {...actions()} />);
  expect(menu(t)).toHaveLength(0);
  expect(texts(t)).toContain("Waiting for your next prompt");
  expect(texts(t)).not.toContain("Open");
});

test("cards_show_the_footer_with_open_and_the_time", () => {
  const since = Date.now() - 4 * 60_000;
  const t = render(<AgentRow item={item({ bucket: "working", since, line: "Edit src/a.ts" })} rowStyle="cards" {...actions()} />);
  expect(menu(t)).toHaveLength(0);
  expect(texts(t)).toEqual(expect.arrayContaining(["Open", "4 min", "Edit src/a.ts"]));
  // VoiceOver still gets the same label and actions.
  const row = t.root.find((n) => n.props.accessibilityHint === "Opens the session. Long press to peek.");
  expect(row.props.accessibilityLabel).toContain("api");
});

test("every_row_style_shows_the_agent_mark_before_the_title", () => {
  for (const style of ["flat", "divided", "cards"] as const) {
    const t = render(<AgentRow item={item()} rowStyle={style} {...actions()} />);
    expect(t.root.findAllByType(Svg).length).toBeGreaterThan(0);
  }
  // A kind with no logo shows its letters.
  const t = render(<AgentRow item={item({ agent: { ...item().agent, agent: "amp" } })} {...actions()} />);
  expect(texts(t)).toContain("Am");
});

test("the_hint_close_button_dismisses_it", () => {
  const onClose = jest.fn();
  const t = render(<BoardHint onClose={onClose} />);
  const close = t.root.find((n) => n.props.accessibilityLabel === "Dismiss hint" && !!n.props.onPress);
  expect(texts(t)).toContain("Tap an agent to see its chat and talk to it.");
  act(() => close.props.onPress());
  expect(onClose).toHaveBeenCalledTimes(1);
});
