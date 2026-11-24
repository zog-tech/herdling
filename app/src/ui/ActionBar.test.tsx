import { ScrollView, Text as RNText } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { space } from "@/theme/tokens";

import { ActionBar } from "./ActionBar";
import { Screen } from "./Screen";

jest.mock("expo-glass-effect", () => ({ GlassView: () => null, isLiquidGlassAvailable: () => false }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 34, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));

const mount = (el: React.ReactElement) => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(el);
  });
  return t;
};
const buttons = (t: ReactTestRenderer) => t.root.findAll((n) => n.props.accessibilityRole === "button" && !!n.props.onPress && typeof n.type !== "string");
/** The `onLayout` view that measures the whole bar: the last absolute view with a layout handler. */
const layoutBar = (t: ReactTestRenderer, height: number) => {
  const measurers = t.root.findAll((n) => typeof n.type === "string" && !!n.props.onLayout);
  act(() => measurers[measurers.length - 1].props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }));
};

test("bar_shows_the_secondary_then_the_primary_and_reports_its_space", () => {
  const onSpace = jest.fn();
  const go = jest.fn();
  const t = mount(
    <ActionBar onSpace={onSpace} primary={{ label: "New agent", onPress: go }} secondary={{ label: "Terminal", onPress: jest.fn() }}>
      <RNText>Above</RNText>
    </ActionBar>,
  );
  expect(buttons(t).map((b) => b.props.accessibilityLabel)).toEqual(["Terminal", "New agent"]);
  act(() => buttons(t)[1].props.onPress());
  expect(go).toHaveBeenCalled();
  layoutBar(t, 92);
  expect(onSpace).toHaveBeenLastCalledWith(92);
});

test("screen_with_a_footer_ends_its_content_above_the_bar", () => {
  const t = mount(
    <Screen footer={<ActionBar primary={{ label: "Pair", onPress: jest.fn() }} />}>
      <RNText>Body</RNText>
    </Screen>,
  );
  const pad = () => t.root.findByType(ScrollView).props.contentContainerStyle.paddingBottom;
  expect(pad()).toBe(space.xl + 34);
  layoutBar(t, 100);
  expect(pad()).toBe(space.xl + 100);
});
