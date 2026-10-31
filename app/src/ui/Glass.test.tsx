import { View } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const mockAvailable = jest.fn(() => false);
jest.mock("expo-glass-effect", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { GlassView: (p: object) => <MockView testID="glass" {...p} />, isLiquidGlassAvailable: () => mockAvailable() };
});

import { colors } from "@/theme/tokens";

import { GlassSurface, glassAvailable, resetGlassCache } from "./Glass";

const render = (el: React.ReactElement) => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(el);
  });
  return t;
};

beforeEach(() => resetGlassCache());

test("glass_surface_falls_back_to_a_translucent_fill", () => {
  mockAvailable.mockReturnValue(false);
  const t = render(<GlassSurface />);
  expect(t.root.findAll((n) => n.props.testID === "glass")).toHaveLength(0);
  const style = [t.root.findByType(View).props.style].flat(2);
  expect(style).toContainEqual(expect.objectContaining({ backgroundColor: colors.glassFallback }));
});

test("glass_surface_uses_liquid_glass_when_available_unless_solid", () => {
  mockAvailable.mockReturnValue(true);
  expect(glassAvailable()).toBe(true);
  expect(render(<GlassSurface tint={colors.accent} />).root.findAll((n) => n.props.testID === "glass").length).toBeGreaterThan(0);
  expect(render(<GlassSurface solid />).root.findAll((n) => n.props.testID === "glass")).toHaveLength(0);
});

test("glass_available_is_false_when_the_native_module_throws", () => {
  mockAvailable.mockImplementation(() => {
    throw new Error("no module");
  });
  expect(glassAvailable()).toBe(false);
});
