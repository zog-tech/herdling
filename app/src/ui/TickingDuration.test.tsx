import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { formatDuration, spokenDuration } from "./format";
import { durationText, tick, TickingDuration } from "./TickingDuration";

// One table for both threads: the UI-thread text must equal `formatDuration`.
const SECONDS = [-5, 0, 0.4, 1, 12.7, 59, 59.999, 60, 72, 599, 3599, 3600, 3720, 86_399, 90_061];

test("worklet_text_equals_format_duration", () => {
  const since = 1_700_000_000_000;
  for (const s of SECONDS) {
    expect(durationText(since, since + s * 1000)).toBe(formatDuration(s));
  }
});

test("tick_writes_only_when_the_second_changes", () => {
  const since = 1_000_000;
  const first = tick(since, since + 4_200, -1);
  expect(first).toEqual({ sec: 4, text: "4s" });
  // Frames inside the same second write nothing.
  expect(tick(since, since + 4_900, 4)).toBeUndefined();
  expect(tick(since, since + 4_999, 4)).toBeUndefined();
  expect(tick(since, since + 5_000, 4)).toEqual({ sec: 5, text: "5s" });
  expect(tick(since, since + 72_000, 71)).toEqual({ sec: 72, text: "1m 12s" });
});

test("spoken_duration_uses_whole_minutes", () => {
  expect(spokenDuration(0)).toBe("under a minute");
  expect(spokenDuration(59)).toBe("under a minute");
  expect(spokenDuration(72)).toBe("1 minute");
  expect(spokenDuration(150)).toBe("2 minutes");
  expect(spokenDuration(3600)).toBe("1 hour");
  expect(spokenDuration(3720)).toBe("1 hour 2 minutes");
  expect(spokenDuration(7260)).toBe("2 hours 1 minute");
  expect(spokenDuration(-3)).toBe("under a minute");
});

const input = (t: ReactTestRenderer) => t.root.findByProps({ testID: "ticking-duration" });

test("renders_current_text_with_tabular_nums_and_a_minute_label", () => {
  jest.useFakeTimers();
  const since = Date.now() - 72_000;
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<TickingDuration since={since} />);
  });
  const field = input(t);
  expect(field.props.defaultValue).toBe("1m 12s");
  expect(field.props.editable).toBe(false);
  expect(field.props.accessible).toBe(false);
  const flat = Object.assign({}, ...[field.props.style].flat(3).filter(Boolean));
  expect(flat.fontVariant).toEqual(["tabular-nums"]);
  const box = t.root.findByProps({ accessibilityRole: "text" });
  expect(box.props.accessibilityLabel).toBe("1 minute");
  // The label does not change every second.
  act(() => jest.advanceTimersByTime(1_000));
  expect(box.props.accessibilityLabel).toBe("1 minute");
  act(() => t.unmount());
  jest.useRealTimers();
});

test("hidden_from_voiceover_when_a_parent_speaks_the_time", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<TickingDuration since={Date.now()} accessible={false} />);
  });
  expect(t.root.findAllByProps({ accessibilityRole: "text" })).toHaveLength(0);
  expect(t.root.findByProps({ accessibilityElementsHidden: true })).toBeTruthy();
  act(() => t.unmount());
});
