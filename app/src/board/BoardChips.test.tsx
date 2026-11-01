import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BoardChips } from "./BoardChips";

const counts = { needs_you: 2, ready: 1, working: 3, background: 0, idle: 0 };
const chip = (t: ReactTestRenderer, label: string) =>
  t.root.find((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith(label) && !!n.props.onPress);

test("chips_show_counts_and_toggle_the_filter", () => {
  const onChange = jest.fn();
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<BoardChips counts={counts} filter={null} onChange={onChange} />);
  });
  expect(chip(t, "Needs you").props.accessibilityLabel).toBe("Needs you, 2");
  expect(chip(t, "All").props.accessibilityState).toEqual({ selected: true });
  // Quiet text tabs: every chip is a tab of one tab list.
  expect(chip(t, "Ready").props.accessibilityRole).toBe("tab");
  act(() => chip(t, "Working").props.onPress());
  expect(onChange).toHaveBeenLastCalledWith("working");

  act(() => t.update(<BoardChips counts={counts} filter="working" onChange={onChange} />));
  expect(chip(t, "Working").props.accessibilityState).toEqual({ selected: true });
  act(() => chip(t, "Working").props.onPress());
  expect(onChange).toHaveBeenLastCalledWith(null);
  act(() => chip(t, "Ready").props.onPress());
  expect(onChange).toHaveBeenLastCalledWith("ready");
  act(() => t.unmount());
});
