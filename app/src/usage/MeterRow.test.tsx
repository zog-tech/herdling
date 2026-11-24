import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { Group } from "@/ui/Group";

import { MeterRow } from "./MeterRow";

const render = (el: React.ReactElement): ReactTestRenderer => {
  let t: ReactTestRenderer | undefined;
  act(() => {
    t = create(el);
  });
  return t!;
};
const bar = (t: ReactTestRenderer) => t.root.find((n) => n.props.accessibilityRole === "progressbar" && n.props.accessible);

test("reads as one progress bar with the label, the detail and the value", () => {
  const t = render(<MeterRow label="Claude · 5-hour" value={42.4} detail="Resets in 3h" />);
  const b = bar(t);
  expect(b.props.accessibilityLabel).toBe("Claude · 5-hour, Resets in 3h");
  expect(b.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42, text: "42%" });
});

test("clamps the value to 0..100 and shows a given value text", () => {
  const t = render(<MeterRow label="Memory" value={180} valueText="9 GB of 8 GB" />);
  expect(bar(t).props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100, text: "9 GB of 8 GB" });
  const low = render(<MeterRow label="CPU" value={Number.NaN} />);
  expect(bar(low).props.accessibilityValue.now).toBe(0);
});

test("pads itself to the band inset inside a Group", () => {
  const t = render(
    <Group>
      <MeterRow label="CPU" value={10} />
    </Group>,
  );
  const style = bar(t).props.style;
  expect(style.paddingHorizontal).toBeGreaterThan(0);
});
