import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { colors, state } from "@/theme/tokens";

import { Button } from "./Button";

const style = (variant: "primary" | "secondary" | "ghost" | "danger", pressed = false, extra: object = {}) => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<Button label="Go" onPress={jest.fn()} variant={variant} {...extra} />);
  });
  const p = t.root.find((n) => n.props.accessibilityRole === "button" && typeof n.props.style === "function");
  return Object.assign({}, ...[p.props.style({ pressed })].flat(2).filter(Boolean));
};

test("no_variant_draws_a_border", () => {
  for (const v of ["primary", "secondary", "ghost", "danger"] as const) {
    expect(style(v).borderWidth ?? 0).toBe(0);
  }
});

test("each_variant_has_its_fill_and_pressed_state", () => {
  expect(style("primary").backgroundColor).toBe(colors.accent);
  expect(style("primary", true).backgroundColor).toBe(colors.accentPressed);
  expect(style("secondary").backgroundColor).toBe(colors.raised);
  expect(style("secondary", true).backgroundColor).toBe(colors.raisedHigh);
  expect(style("danger").backgroundColor).toBe(colors.raised);
  expect(style("ghost").backgroundColor).toBe("transparent");
  expect(style("ghost", true).opacity).toBe(state.pressedOpacity);
  expect(style("secondary", false, { disabled: true }).opacity).toBe(state.disabledOpacity);
});

test("danger_has_the_danger_label_and_style_places_the_button", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<Button label="Close" onPress={jest.fn()} variant="danger" style={{ flex: 1 }} />);
  });
  expect(t.root.findAll((n) => n.props.children === "Close" && n.props.color === colors.danger).length).toBeGreaterThan(0);
  const p = t.root.find((n) => n.props.accessibilityRole === "button" && typeof n.props.style === "function");
  expect(Object.assign({}, ...[p.props.style({ pressed: false })].flat(2).filter(Boolean)).flex).toBe(1);
});
