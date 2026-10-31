import { act, create, type ReactTestRenderer } from "react-test-renderer";

import * as haptics from "./haptics";
import { Segmented } from "./Segmented";

jest.mock("./haptics", () => ({ tap: jest.fn() }));

const OPTIONS = [
  { id: "full", label: "Full text" },
  { id: "summary", label: "Summary" },
] as const;
const tab = (t: ReactTestRenderer, label: string) =>
  t.root.find((n) => n.props.accessibilityRole === "tab" && n.props.accessibilityLabel === label && !!n.props.onPress);

test("segmented_marks_the_selected_tab_and_reports_a_change", () => {
  const onChange = jest.fn();
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<Segmented options={OPTIONS} value="full" onChange={onChange} label="What to read" />);
  });
  expect(t.root.findByProps({ accessibilityRole: "tablist" }).props.accessibilityLabel).toBe("What to read");
  expect(tab(t, "Full text").props.accessibilityState).toEqual({ selected: true });
  expect(tab(t, "Summary").props.accessibilityState).toEqual({ selected: false });

  act(() => tab(t, "Summary").props.onPress());
  expect(onChange).toHaveBeenLastCalledWith("summary");
  expect(haptics.tap).toHaveBeenCalledTimes(1);

  // A tap on the selected segment gives no haptic.
  act(() => tab(t, "Full text").props.onPress());
  expect(haptics.tap).toHaveBeenCalledTimes(1);
  act(() => t.unmount());
});
