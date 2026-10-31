import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ThreadLogContext } from "../ThreadLogContext";
import { SubagentCard } from "./SubagentCard";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

const T0 = 1_000_000;
const LOG = { hostId: "studio", logPath: "/Users/sam/.claude/projects/p/s.jsonl" };
const LAUNCH = "Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it";

const texts = (t: ReactTestRenderer) =>
  t.root
    .findAll((n) => (n.type as unknown) === "Text")
    .map((n) => n.props.children)
    .flat()
    .filter((c) => typeof c === "string");
const pressable = (t: ReactTestRenderer) => t.root.find((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Subagent:") && !!n.props.onPress);
const clock = (t: ReactTestRenderer) => t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "ticking-duration");

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0 + 65_000);
  mockPush.mockClear();
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

function render(el: React.ReactElement, log: typeof LOG | null = LOG) {
  act(() => {
    tree = create(<ThreadLogContext.Provider value={log}>{el}</ThreadLogContext.Provider>);
  });
  return tree!;
}

test("running_card_shows_clock_activity_and_tools", () => {
  const t = render(
    <SubagentCard description="Fix the parser" status="running" agentId="a1" startedAt={T0} activity="Read parse.rs" toolCount={3} resultSummary={LAUNCH} />,
  );
  expect(clock(t)[0].props.defaultValue).toBe("1m 5s");
  const shown = texts(t);
  expect(shown).toContain("Running");
  expect(shown).toContain("Read parse.rs");
  expect(shown).toContain("· 3 tools");
  expect(shown.some((s) => s.includes("Async agent"))).toBe(false);
  // VoiceOver: no activity, so it does not change with each step.
  expect(pressable(t).props.accessibilityLabel).toBe("Subagent: Fix the parser. Running, 3 tools");
  expect(pressable(t).props.accessibilityRole).toBe("button");
  act(() => pressable(t).props.onPress());
  expect(mockPush).toHaveBeenCalledWith(
    expect.objectContaining({ params: expect.objectContaining({ agentId: "a1", since: String(T0), title: "Fix the parser" }) }),
  );
});

test("done_card_shows_duration_and_summary", () => {
  const t = render(
    <SubagentCard description="Fix the parser" status="completed" agentId="a1" startedAt={T0} finishedAt={T0 + 125_000} toolCount={1} activity="Read x" resultSummary="Fixed." />,
  );
  const shown = texts(t);
  expect(shown).toContain("2m 5s");
  expect(shown).toContain("Fixed.");
  expect(shown).toContain("· 1 tool");
  expect(shown).not.toContain("Read x");
  expect(clock(t)).toHaveLength(0);
  expect(pressable(t).props.accessibilityLabel).toBe("Subagent: Fix the parser. Completed, took 2 minutes, 1 tool");
});

test("old_host_launch_summary_is_hidden_and_card_waits_for_agent_id", () => {
  const t = render(<SubagentCard description="Bg" status="async_launched" agentId="" resultSummary={LAUNCH} />);
  expect(texts(t).some((s) => s.includes("Async agent"))).toBe(false);
  // Not disabled (the long-press menu still works), but not a button and the tap does nothing.
  expect(pressable(t).props.accessibilityRole).toBeUndefined();
  act(() => pressable(t).props.onPress());
  expect(mockPush).not.toHaveBeenCalled();
});
