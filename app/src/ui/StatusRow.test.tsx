import { AccessibilityInfo } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { announcement, StatusRow } from "./StatusRow";

const label = (t: ReactTestRenderer) => t.root.findByProps({ accessibilityRole: "text" }).props.accessibilityLabel;

test("status_row_ticks_and_keeps_its_label", () => {
  jest.useFakeTimers();
  const since = Date.now() - 71_000;
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusRow status="working" since={since} />);
  });
  expect(label(t)).toBe("Working 1m 11s");
  act(() => jest.advanceTimersByTime(1000));
  expect(label(t)).toBe("Working 1m 12s");
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
