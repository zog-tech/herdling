import { AccessibilityInfo } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { announcement, isStatusShown, StatusRow } from "./StatusRow";

const label = (t: ReactTestRenderer) => t.root.findByProps({ accessibilityRole: "text" }).props.accessibilityLabel;

const clock = (t: ReactTestRenderer) => t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "ticking-duration");

test("status_row_shows_the_clock_and_keeps_its_label", () => {
  jest.useFakeTimers();
  const since = Date.now() - 71_000;
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="working" since={since} />);
  });
  expect(clock(t)[0].props.defaultValue).toBe("1m 11s");
  // VoiceOver hears whole minutes, so the label does not change every second.
  expect(label(t)).toBe("Working, 1 minute");
  act(() => jest.advanceTimersByTime(1000));
  expect(label(t)).toBe("Working, 1 minute");
  act(() => jest.advanceTimersByTime(60_000));
  expect(label(t)).toBe("Working, 2 minutes");
  act(() => t.update(<StatusRow status="blocked" since={since} />));
  expect(label(t)).toBe("Needs you");
  act(() => t.update(<StatusRow status="offline" />));
  expect(label(t)).toBe("Offline");
  act(() => t.unmount());
  jest.useRealTimers();
});

test("status_row_hides_from_voiceover_when_idle", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="done" />);
  });
  expect(t.root.findByProps({ accessibilityRole: "text" }).props.accessible).toBe(false);
  act(() => t.update(<StatusRow status="working" since={Date.now()} />));
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
    t = create(<StatusRow status="working" since={Date.now()} />);
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

test("status_row_adds_running_subagents_while_working", () => {
  jest.useFakeTimers();
  const since = Date.now() - 5_000;
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="working" since={since} subagents={2} />);
  });
  const texts = () => t.root.findAll((n) => (n.type as unknown) === "Text").map((n) => n.props.children);
  expect(texts()).toContain("· 2 subagents");
  expect(label(t)).toBe("Working, under a minute, 2 subagents");
  act(() => t.update(<StatusRow status="working" since={since} subagents={1} />));
  expect(label(t)).toBe("Working, under a minute, 1 subagent");
  act(() => t.update(<StatusRow status="working" since={since} subagents={0} />));
  expect(texts().some((c) => typeof c === "string" && c.includes("subagent"))).toBe(false);
  act(() => t.update(<StatusRow status="blocked" since={since} subagents={2} />));
  expect(label(t)).toBe("Needs you");
  act(() => t.unmount());
  jest.useRealTimers();
});
