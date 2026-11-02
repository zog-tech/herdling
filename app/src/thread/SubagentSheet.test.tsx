import type { ThreadItem } from "@herdling/protocol";
import { Modal } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { StatusRow } from "@/ui/StatusRow";
import { subagentList } from "./subagentState";
import { ThreadLogContext } from "./ThreadLogContext";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const T0 = 1_000_000;
const LOG = { hostId: "studio", logPath: "/home/sam/.claude/projects/p/s.jsonl" };

type Sub = Extract<ThreadItem, { kind: "subagent" }>;
const sub = (id: string, status: string, startedAt: number, extra: Partial<Sub> = {}): Sub => ({
  kind: "subagent",
  id,
  ts: startedAt,
  agent_id: `agent-${id}`,
  description: `Task ${id}`,
  status,
  started_at: startedAt,
  ...extra,
});
const user: ThreadItem = { kind: "user", id: "u1", ts: T0 - 1, text: "Go on" };

const texts = (t: ReactTestRenderer) =>
  t.root
    .findAll((n) => (n.type as unknown) === "Text")
    .map((n) => n.props.children)
    .flat()
    .filter((c) => typeof c === "string");
const pill = (t: ReactTestRenderer) => t.root.find((n) => n.props.accessibilityHint === "Shows the subagents" && !!n.props.onPress);
const glyphs = (t: ReactTestRenderer, status: string) =>
  t.root.findAll((n) => typeof n.type === "string" && n.props.testID === `status-glyph-${status}`);

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0 + 30_000);
  mockPush.mockClear();
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

function render(items: ThreadItem[]) {
  const el = (list: ThreadItem[]) => (
    <ThreadLogContext.Provider value={LOG}>
      <StatusRow status="working" subagents={subagentList(list)} />
    </ThreadLogContext.Provider>
  );
  act(() => {
    tree = create(el(items));
  });
  return { t: tree!, update: (list: ThreadItem[]) => act(() => tree!.update(el(list))) };
}

test("sheet_lists_running_then_finished_and_opens_the_subagent_thread", () => {
  const { t } = render([
    user,
    sub("a", "completed", T0, { finished_at: T0 + 12_000 }),
    sub("b", "running", T0 + 5_000, { activity: "Read parse.rs", agent_type: "Explore", model: "haiku", tool_count: 3 }),
  ]);
  expect(t.root.findByType(Modal).props.visible).toBe(false);
  act(() => pill(t).props.onPress());
  expect(t.root.findByType(Modal).props.visible).toBe(true);
  const shown = texts(t);
  expect(shown.indexOf("Running")).toBeLessThan(shown.indexOf("Finished in this turn"));
  expect(shown.indexOf("Task b")).toBeLessThan(shown.indexOf("Task a"));
  expect(shown).toContain("Explore · haiku");
  expect(shown).toContain("Read parse.rs");
  expect(shown).toContain("12s");
  // The running row has the animated indicator, the finished row a static icon.
  expect(glyphs(t, "working").length).toBeGreaterThanOrEqual(2);

  const row = t.root.find((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Task b,") && !!n.props.onPress);
  expect(row.props.accessibilityLabel).toBe("Task b, Running, 3 tools, Explore · haiku");
  act(() => row.props.onPress());
  // iOS: the sheet closes first; the push runs once the sheet is gone.
  expect(t.root.findByType(Modal).props.visible).toBe(false);
  expect(mockPush).not.toHaveBeenCalled();
  act(() => t.root.findByType(Modal).props.onDismiss());
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/subagent/[hostId]/[agentId]",
    params: { hostId: "studio", agentId: "agent-b", log: LOG.logPath, title: "Task b", since: String(T0 + 5_000) },
  });
});
