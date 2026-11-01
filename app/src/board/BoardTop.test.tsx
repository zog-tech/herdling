import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BoardTop } from "./BoardTop";
import type { BoardItem, Bucket } from "./buckets";
import { spotlight } from "./spotlight";
import { boardSummary } from "./summary";

jest.mock("@/ui/haptics", () => ({ press: jest.fn(), peek: jest.fn(), tap: jest.fn() }));
// The tile reads the screen through this hook; the test gives it a fixed screen.
jest.mock("@/thread/useTerminalText", () => ({
  useTerminalText: () => ({ text: "$ pnpm test\nPASS src/a.test.ts\n", refresh: () => {} }),
}));
// The gestures need the native runtime. The test keeps the tap configs and runs them itself.
const taps: { onActivate: () => void }[] = [];
jest.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  useTapGesture: (cfg: { onActivate: () => void }) => {
    taps.push(cfg);
    return {};
  },
  useLongPressGesture: () => ({}),
  useExclusiveGestures: () => ({}),
}));

const item = (key: string, bucket: Bucket, title = key): BoardItem => ({
  key,
  hostId: "h",
  hostName: "studio.local",
  workspace: "api",
  title,
  subtitle: "studio.local · claude",
  agent: { pane_id: key, tab_id: "t1", workspace_id: "w1", agent: "claude", agent_status: "idle", state_change_seq: 1 },
  bucket,
});

const items = [item("h:p1", "needs_you", "api"), item("h:p2", "working", "web"), item("h:p3", "idle", "docs")];
const counts = { needs_you: 1, ready: 0, working: 1, background: 0, idle: 1 };

let mounted: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => mounted.forEach((t) => t.unmount()));
  mounted = [];
  taps.length = 0;
});

const render = (mode: "dashboard" | "summary", onOpen = jest.fn()) => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(
      <BoardTop
        mode={mode}
        items={items}
        summary={boardSummary(counts)}
        spot={spotlight(items)}
        room={390}
        focused
        group="Status"
        sort="Status"
        onGroup={jest.fn()}
        onSort={jest.fn()}
        onOpen={onOpen}
        onPeek={jest.fn()}
        onNew={jest.fn()}
      />,
    );
  });
  mounted.push(t);
  return t;
};
const texts = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);

test("dashboard_shows_the_highlight_tiles_the_summary_line_and_the_menus", () => {
  const t = render("dashboard");
  const all = texts(t);
  expect(all).toContain("Highlights");
  // Needs you and working get a tile; idle does not while there are highlights.
  expect(all).toContain("api");
  expect(all).toContain("web");
  expect(all).not.toContain("docs");
  expect(all).toContain("New session");
  expect(all).toContain("PASS src/a.test.ts");
  expect(all).toContain("1 needs you");
  expect(all).toContain("All agents");
  expect(t.root.findAll((n) => n.props.accessibilityLabel === "Group: Status" && !!n.props.onPress)).toHaveLength(1);
  expect(t.root.findAll((n) => n.props.accessibilityLabel === "Sort: Status" && !!n.props.onPress)).toHaveLength(1);
});

test("a_tap_on_a_tile_opens_the_session", () => {
  const onOpen = jest.fn();
  render("dashboard", onOpen);
  expect(taps.length).toBeGreaterThan(0);
  act(() => taps[0].onActivate());
  expect(onOpen).toHaveBeenCalledWith(items[0]);
});

test("summary_mode_shows_the_large_number_and_no_carousel", () => {
  const t = render("summary");
  const all = texts(t);
  expect(all).toContain("needs you");
  expect(all).not.toContain("Highlights");
  expect(all).not.toContain("All agents");
  expect(t.root.findAll((n) => n.props.variant === "display")).not.toHaveLength(0);
});
