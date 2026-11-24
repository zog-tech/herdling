import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { AppearanceSection } from "./AppearanceSection";
import { useBoardPrefs } from "./boardPrefs";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("expo-secure-store", () => ({
  getItem: jest.fn(() => null),
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/ui/haptics", () => ({ tap: jest.fn(), press: jest.fn() }));

const render = () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<AppearanceSection />);
  });
  return t;
};
/** The segment `label` of the segmented control named `control`. */
const segment = (t: ReactTestRenderer, control: string, label: string) =>
  t.root
    .find((n) => n.props.accessibilityRole === "tablist" && n.props.accessibilityLabel === control)
    .find((n) => n.props.accessibilityRole === "tab" && n.props.accessibilityLabel === label && !!n.props.onPress);
const texts = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);

test("the_top_of_the_agents_tab_is_a_segmented_control_that_shows_and_changes_the_choice", () => {
  const t = render();
  expect(segment(t, "Top of the Agents tab", "Dashboard").props.accessibilityState).toEqual({ selected: true });
  expect(segment(t, "Top of the Agents tab", "Summary").props.accessibilityState).toEqual({ selected: false });
  act(() => segment(t, "Top of the Agents tab", "Summary").props.onPress());
  expect(useBoardPrefs.getState().homeTop).toBe("summary");
  expect(segment(t, "Top of the Agents tab", "Summary").props.accessibilityState).toEqual({ selected: true });
  // The detail line follows the choice.
  expect(texts(t)).toContain("One large number, then a line with the other counts.");
  act(() => t.unmount());
});

test("the_agent_list_style_has_short_segments_and_the_full_name_in_the_detail", () => {
  const t = render();
  expect(segment(t, "Agent list style", "Cards").props.accessibilityState).toEqual({ selected: true });
  act(() => segment(t, "Agent list style", "Arrows").props.onPress());
  expect(useBoardPrefs.getState().rowStyle).toBe("divided");
  expect(texts(t)).toContain("Rows with arrows: Rows with a line between them and an arrow.");
  act(() => t.unmount());
});

test("the_theme_row_opens_the_theme_screen", () => {
  const t = render();
  const row = t.root.find((n) => n.props.accessibilityLabel === "Theme" && !!n.props.onPress);
  expect(row.props.accessibilityValue).toEqual({ text: "Night Watch, Lantern" });
  act(() => row.props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/theme");
  act(() => t.unmount());
});
