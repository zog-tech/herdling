import type { ThreadItem } from "@herdling/protocol";
import { AccessibilityInfo, Modal } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { space, threadGap } from "@/theme/tokens";
import { subagentList } from "@/thread/subagentState";
import { announcement, isStatusShown, pillContent, PILL_GAP, StatusRow } from "./StatusRow";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const sub = (id: string, status: string): ThreadItem => ({ kind: "subagent", id, ts: 1, agent_id: `agent-${id}`, description: `Task ${id}`, status, started_at: 1 });
const listOf = (...statuses: string[]) => subagentList(statuses.map((st, i) => sub(String(i), st)));

const label = (t: ReactTestRenderer) => t.root.findByProps({ accessibilityRole: "text" }).props.accessibilityLabel;

const clock = (t: ReactTestRenderer) => t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "ticking-duration");

test("status_row_shows_no_clock_and_keeps_its_label", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="working" />);
  });
  expect(clock(t)).toHaveLength(0);
  expect(label(t)).toBe("Working");
  act(() => t.update(<StatusRow status="blocked" />));
  expect(label(t)).toBe("Needs you");
  act(() => t.update(<StatusRow status="offline" />));
  expect(label(t)).toBe("Offline");
  act(() => t.unmount());
});

test("status_row_hides_from_voiceover_when_idle", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="done" />);
  });
  expect(t.root.findByProps({ accessibilityRole: "text" }).props.accessible).toBe(false);
  act(() => t.update(<StatusRow status="working" />));
  expect(t.root.findByProps({ accessibilityRole: "text" }).props.accessible).toBe(true);
  act(() => t.unmount());
});

test("announces_only_finish_and_needs_you", () => {
  expect(announcement("working", "done")).toBe("Finished");
  expect(announcement("working", "idle")).toBe("Finished");
  expect(announcement("idle", "blocked")).toBe("Needs you");
  expect(announcement("blocked", "blocked")).toBeUndefined();
  expect(announcement("idle", "working")).toBeUndefined();
  expect(announcement("working", "offline")).toBeUndefined();
  expect(announcement("done", "idle")).toBeUndefined();
});

test("status_row_announces_on_change", () => {
  const spy = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  spy.mockClear();
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="working" />);
  });
  expect(spy).not.toHaveBeenCalled();
  act(() => t.update(<StatusRow status="done" />));
  expect(spy).toHaveBeenCalledWith("Finished");
  act(() => t.unmount());
  spy.mockRestore();
});

test("status_pill_shows_only_for_working_blocked_and_offline", () => {
  expect(["working", "blocked", "offline"].every((s) => isStatusShown(s as never))).toBe(true);
  expect(["idle", "done", "unknown"].some((s) => isStatusShown(s as never))).toBe(false);
});

test("pill_content_covers_the_four_states", () => {
  // Working, no subagents.
  expect(pillContent("working")).toMatchObject({ status: "working", label: "Working", detail: undefined, tappable: false, spoken: "Working" });
  // Working with running subagents.
  expect(pillContent("working", undefined, 2)).toMatchObject({ label: "Working", detail: "2 subagents", tappable: true, spoken: "Working, 2 subagents" });
  expect(pillContent("working", undefined, 1).spoken).toBe("Working, 1 subagent");
  // Quiet agent with running subagents: the working indicator and the count.
  expect(pillContent("idle", undefined, 2)).toMatchObject({ status: "working", label: "2 subagents running", tappable: true });
  expect(pillContent("done", "1 shell running", 1)).toMatchObject({ status: "working", label: "1 subagent running" });
  // Nothing running: no subagent text.
  expect(pillContent("idle", "1 shell running")).toMatchObject({ label: "Idle", detail: "1 shell running", tappable: false });
  // Needs you and Offline keep their text and are not tappable.
  expect(pillContent("blocked", undefined, 2)).toMatchObject({ label: "Needs you", tappable: false, spoken: "Needs you" });
  expect(isStatusShown("idle")).toBe(false);
  expect(isStatusShown("idle", undefined, 1)).toBe(true);
  expect(isStatusShown("unknown", undefined, 1)).toBe(true);
});

const isButton = (n: { props: Record<string, unknown> }) => n.props.accessibilityHint === "Shows the subagents" && !!n.props.onPress;

test("status_row_working_with_subagents_is_one_tappable_pill", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="working" subagents={listOf("running", "running", "completed")} />);
  });
  const texts = () => t.root.findAll((n) => (n.type as unknown) === "Text").map((n) => n.props.children);
  expect(texts()).toContain("· 2 subagents");
  const button = t.root.find(isButton);
  expect(button.props.accessibilityRole).toBe("button");
  expect(button.props.accessibilityLabel).toBe("Working, 2 subagents");
  expect(t.root.findAllByProps({ accessibilityRole: "text" })).toHaveLength(0);
  // One working indicator only.
  expect(t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "status-glyph-working")).toHaveLength(1);
  // The running ones stop: a plain pill with no button.
  act(() => t.update(<StatusRow status="working" subagents={listOf("completed")} />));
  expect(label(t)).toBe("Working");
  expect(t.root.findAll(isButton)).toHaveLength(0);
  act(() => t.unmount());
});

test("status_row_shows_background_subagents_of_a_quiet_agent", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="idle" subagents={listOf("running", "running")} />);
  });
  const button = t.root.find(isButton);
  expect(button.props.accessible).toBe(true);
  expect(button.props.accessibilityLabel).toBe("2 subagents running");
  expect(t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "status-glyph-working")).toHaveLength(1);
  act(() => t.unmount());
});

test("status_row_hides_when_nothing_runs_and_does_not_show_finished_subagents", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="idle" subagents={listOf("completed", "error")} />);
  });
  expect(t.root.findByProps({ accessibilityRole: "text" }).props.accessible).toBe(false);
  expect(t.root.findAll(isButton).every((n) => n.props.accessible === false)).toBe(true);
  act(() => t.unmount());
});

test("status_row_tap_opens_the_subagent_sheet", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="working" subagents={listOf("running", "completed")} />);
  });
  expect(t.root.findByType(Modal).props.visible).toBe(false);
  act(() => t.root.find(isButton).props.onPress());
  expect(t.root.findByType(Modal).props.visible).toBe(true);
  const shown = t.root.findAll((n) => (n.type as unknown) === "Text").map((n) => n.props.children);
  expect(shown).toContain("Task 0");
  expect(shown).toContain("Task 1");
  act(() => t.unmount());
});

test("status_row_shows_background_work_of_an_idle_agent", () => {
  expect(isStatusShown("idle", "1 shell running")).toBe(true);
  expect(isStatusShown("done", "1 shell running")).toBe(true);
  expect(isStatusShown("unknown", "1 shell running")).toBe(false);
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="idle" background="1 shell running" />);
  });
  const texts = () => t.root.findAll((n) => (n.type as unknown) === "Text").map((n) => n.props.children);
  expect(texts()).toContain("Idle");
  expect(texts()).toContain("· 1 shell running");
  expect(label(t)).toBe("Idle, 1 shell running");
  expect(t.root.findByProps({ accessibilityRole: "text" }).props.accessible).toBe(true);
  // While working, the background text does not show.
  act(() => t.update(<StatusRow status="working" background="1 shell running" />));
  expect(label(t)).toBe("Working");
  act(() => t.unmount());
});

test("status_pill_gap_equals_the_thread_row_gap", () => {
  // The pill sits below the newest row at the same rhythm as two rows: 12 pt.
  expect(PILL_GAP).toBe(threadGap);
  expect(PILL_GAP).toBe(space.md);
  expect(PILL_GAP).toBe(12);
});
