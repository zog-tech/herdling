import type { AgentStatus } from "@herdling/protocol";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useBoard } from "./boardStore";
import { BoardTop } from "./BoardTop";
import type { BoardItem, Bucket } from "./buckets";
import { spotlight } from "./spotlight";
import { boardSummary } from "./summary";

jest.mock("@/ui/haptics", () => ({ press: jest.fn(), peek: jest.fn(), tap: jest.fn() }));
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

const STATUS: Record<Bucket, AgentStatus> = { needs_you: "blocked", working: "working", ready: "done", background: "idle", idle: "idle" };
const item = (key: string, bucket: Bucket, title = key, patch: Partial<BoardItem> = {}): BoardItem => ({
  key,
  hostId: "h",
  hostName: "studio.local",
  workspace: "api",
  title,
  subtitle: "studio.local · claude",
  agent: {
    pane_id: key.slice(2),
    tab_id: "t1",
    workspace_id: "w1",
    agent: "claude",
    agent_status: STATUS[bucket],
    state_change_seq: 1,
    cwd: `/home/sam/${title}`,
  },
  bucket,
  ...patch,
});

const NOW = 1_800_000_000_000;
const items = [
  item("h:p1", "needs_you", "api"),
  item("h:p2", "working", "web", { since: NOW - 4 * 60_000, sinceKnown: true }),
  item("h:p3", "idle", "docs"),
];
const counts = { needs_you: 1, ready: 0, working: 1, background: 0, idle: 1 };

let mounted: ReactTestRenderer[] = [];
beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  useBoard.setState({
    previews: {
      "h:p1": { pane_id: "p1", question: "Allow git push?", last_reply: "Done with the tests.", source: "log", status: "blocked" },
      "h:p2": { pane_id: "p2", activity: "Running pnpm test", source: "log", status: "working" },
    },
  });
});
afterEach(() => {
  act(() => mounted.forEach((t) => t.unmount()));
  mounted = [];
  taps.length = 0;
  useBoard.setState({ previews: {} });
  jest.restoreAllMocks();
});

const render = (mode: "dashboard" | "summary", onOpen = jest.fn(), multiHost = false) => {
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
        multiHost={multiHost}
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
const tileLabels = (t: ReactTestRenderer) =>
  t.root
    .findAll((n) => n.props.accessibilityHint === "Opens the session. Long press to peek." && typeof n.props.accessibilityLabel === "string")
    .map((n) => n.props.accessibilityLabel as string);

test("dashboard_shows_the_highlight_tiles_the_summary_line_and_the_menus", () => {
  const t = render("dashboard");
  const all = texts(t);
  expect(all).toContain("Highlights");
  // Needs you and working get a tile; idle does not while there are highlights.
  expect(all).toContain("api");
  expect(all).toContain("web");
  expect(all).not.toContain("docs");
  expect(all).toContain("New session");
  expect(all).toContain("1 needs you");
  expect(all).toContain("All agents");
  expect(t.root.findAll((n) => n.props.accessibilityLabel === "Group: Status" && !!n.props.onPress)).toHaveLength(1);
  expect(t.root.findAll((n) => n.props.accessibilityLabel === "Sort: Status" && !!n.props.onPress)).toHaveLength(1);
});

test("a_tile_shows_the_status_time_and_the_main_text_by_priority", () => {
  const all = texts(render("dashboard"));
  // Needs you: the question wins over the last reply.
  expect(all).toContain("Needs you");
  expect(all).toContain("Allow git push?");
  expect(all).not.toContain("Done with the tests.");
  // Working: the activity and the time.
  expect(all).toContain("Working · 4m");
  expect(all).toContain("Running pnpm test");
});

test("with_one_computer_the_folder_line_shows_only_the_folder", () => {
  const all = texts(render("dashboard"));
  expect(all).toContain("web");
  expect(all).not.toContain("web · studio.local");
});

test("with_more_than_one_computer_the_folder_line_names_the_computer", () => {
  const all = texts(render("dashboard", jest.fn(), true));
  expect(all).toContain("api · studio.local");
  expect(all).toContain("web · studio.local");
});

test("a_tile_label_reads_the_title_the_status_the_folder_and_the_main_text", () => {
  const labels = tileLabels(render("dashboard"));
  expect([...new Set(labels)]).toEqual(["api, Needs you, api, Allow git push?", "web, Working · 4m, web, Running pnpm test"]);
});

test("a_stale_preview_shows_the_quiet_empty_line", () => {
  // The preview was fetched while the agent worked; the agent now needs you.
  useBoard.setState({ previews: { "h:p1": { pane_id: "p1", activity: "Editing a.ts", source: "log", status: "working" } } });
  const all = texts(render("dashboard"));
  expect(all).not.toContain("Editing a.ts");
  expect(all).toContain("No reply yet");
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
