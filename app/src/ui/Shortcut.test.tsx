import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { colors, hitTarget, radius, shortcut } from "@/theme/tokens";

import { Shortcut } from "./Shortcut";

test("shortcut_is_a_raised_rounded_rectangle_with_a_full_touch_target", () => {
  const onPress = jest.fn();
  const onLongPress = jest.fn();
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<Shortcut label="Run the tests" accessibilityLabel="Saved prompt: Run the tests" onPress={onPress} onLongPress={onLongPress} />);
  });
  const p = t.root.find((n) => n.props.accessibilityRole === "button" && typeof n.props.style === "function");
  const rest = p.props.style({ pressed: false });
  expect(rest).toMatchObject({ height: shortcut.height, borderRadius: radius.md, backgroundColor: colors.raised });
  expect(rest.borderWidth).toBeUndefined();
  expect(p.props.style({ pressed: true }).backgroundColor).toBe(colors.raisedHigh);
  expect(shortcut.height + p.props.hitSlop.top + p.props.hitSlop.bottom).toBe(hitTarget);
  expect(p.props.accessibilityLabel).toBe("Saved prompt: Run the tests");
  // A shortcut never shows a selected state.
  expect(p.props.accessibilityState).toEqual({ disabled: false });
  act(() => p.props.onPress());
  act(() => p.props.onLongPress());
  expect(onPress).toHaveBeenCalled();
  expect(onLongPress).toHaveBeenCalled();
});
