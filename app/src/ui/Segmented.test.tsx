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

test("segmented_attention_mark_is_part_of_the_name", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(
      <Segmented
        options={[
          { id: "a", label: "api", attention: "needs you" },
          { id: "b", label: "web" },
        ]}
        value="a"
        onChange={() => {}}
        label="Tabs"
      />,
    );
  });
  // The dot is hidden from VoiceOver; its meaning is in the tab name.
  expect(tab(t, "api, needs you")).toBeTruthy();
  expect(tab(t, "web")).toBeTruthy();
  expect(t.root.findAll((n) => n.props.importantForAccessibility === "no")).not.toHaveLength(0);
  // The label text shows without a symbol suffix.
  const texts = t.root.findAll((n) => (n.type as unknown) === "Text").map((n) => n.props.children);
  expect(texts).toEqual(expect.arrayContaining(["api", "web"]));
  act(() => t.unmount());
});

test("segmented_icon_form_shows_icons_and_keeps_the_names", () => {
  const { MessageSquare, SquareTerminal } = jest.requireActual("lucide-react-native");
  let t!: ReactTestRenderer;
  act(() => {
    t = create(
      <Segmented
        options={[
          { id: "thread", label: "Thread", Icon: MessageSquare },
          { id: "terminal", label: "Terminal", Icon: SquareTerminal },
        ]}
        value="terminal"
        onChange={() => {}}
        label="View"
      />,
    );
  });
  expect(tab(t, "Terminal").props.accessibilityState).toEqual({ selected: true });
  // No label text in the icon form.
  expect(t.root.findAll((n) => (n.type as unknown) === "Text")).toHaveLength(0);
  expect(t.root.findAllByType(MessageSquare)).toHaveLength(1);
  act(() => t.unmount());
});
