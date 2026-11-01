import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { AppearanceSection } from "./AppearanceSection";
import { useBoardPrefs } from "./boardPrefs";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("expo-secure-store", () => ({
  getItem: jest.fn(() => null),
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/ui/haptics", () => ({ tap: jest.fn() }));

const render = () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<AppearanceSection />);
  });
  return t;
};
const row = (t: ReactTestRenderer, label: string) =>
  t.root.find((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith(label) && !!n.props.onPress);

test("the_overview_top_rows_show_the_selected_choice_and_change_it", () => {
  const t = render();
  expect(row(t, "Overview top Dashboard").props.accessibilityLabel).toBe("Overview top Dashboard, selected");
  expect(row(t, "Overview top Summary").props.accessibilityLabel).toBe("Overview top Summary");
  act(() => row(t, "Overview top Summary").props.onPress());
  expect(useBoardPrefs.getState().homeTop).toBe("summary");
  expect(row(t, "Overview top Summary").props.accessibilityLabel).toBe("Overview top Summary, selected");
  // The list style rows are still there.
  expect(row(t, "Agent list style Cards").props.accessibilityLabel).toBe("Agent list style Cards, selected");
  act(() => t.unmount());
});
