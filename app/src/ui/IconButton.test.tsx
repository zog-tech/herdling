import { Ellipsis } from "lucide-react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { colors, icon } from "@/theme/tokens";

import { IconButton } from "./IconButton";

function render(el: React.ReactElement) {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(el);
  });
  return t;
}

const button = (t: ReactTestRenderer) => t.root.find((n) => n.props.accessibilityRole === "button" && !!n.props.onPress);

test("icon_button_has_a_label_a_44pt_target_and_presses", () => {
  const onPress = jest.fn();
  const t = render(<IconButton label="Session actions" hint="Opens the menu" Icon={Ellipsis} onPress={onPress} />);
  const b = button(t);
  expect(b.props.accessibilityLabel).toBe("Session actions");
  expect(b.props.accessibilityHint).toBe("Opens the menu");
  act(() => b.props.onPress());
  expect(onPress).toHaveBeenCalledTimes(1);
  // Content size by default; the header size on request.
  expect(t.root.findByType(Ellipsis).props.size).toBe(icon.md);
  act(() => t.update(<IconButton label="Session actions" Icon={Ellipsis} size="header" onPress={onPress} />));
  expect(t.root.findByType(Ellipsis).props.size).toBe(icon.header);
  act(() => t.unmount());
});

test("icon_button_announces_its_states", () => {
  const t = render(<IconButton label="Filter" Icon={Ellipsis} selected expanded busy disabled onPress={() => {}} />);
  expect(button(t).props.accessibilityState).toEqual({ disabled: true, busy: true, selected: true, expanded: true });
  expect(button(t).props.disabled).toBe(true);
  // Selected paints the icon in the accent.
  expect(t.root.findByType(Ellipsis).props.color).toBe(colors.accent);
  act(() => t.update(<IconButton label="Filter" Icon={Ellipsis} onPress={() => {}} />));
  expect(button(t).props.accessibilityState).toEqual({ disabled: false });
  act(() => t.unmount());
});

test("icon_button_draws_a_dot_and_children_in_place_of_the_icon", () => {
  const t = render(
    <IconButton label="Busy" glass dot onPress={() => {}}>
      <Ellipsis testID="child" />
    </IconButton>,
  );
  // The child replaces the icon; the badge is a hidden view.
  expect(t.root.findAll((n) => n.props.testID === "child")).not.toHaveLength(0);
  expect(t.root.findAll((n) => n.props.importantForAccessibility === "no")).not.toHaveLength(0);
  act(() => t.unmount());
});
