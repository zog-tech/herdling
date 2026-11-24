import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { colors } from "@/theme/tokens";

import { ListBar } from "./ListBar";

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

const render = (filtered: boolean, onOptions = jest.fn(), onClear = jest.fn()) => {
  act(() => {
    tree = create(
      <ListBar
        title={filtered ? "Needs you" : "All agents"}
        count={filtered ? 2 : 10}
        arrange="Grouped by status · Sorted by status"
        filtered={filtered}
        onOptions={onOptions}
        onClear={onClear}
      />,
    );
  });
  return { onOptions, onClear };
};
const byLabel = (label: string) => tree!.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");
const texts = () => tree!.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);

test("with_no_filter_the_bar_shows_all_agents_the_arrange_line_and_the_options_button", () => {
  const { onOptions } = render(false);
  expect(texts()).toEqual(expect.arrayContaining(["All agents", "Grouped by status · Sorted by status"]));
  expect(byLabel("Show all")).toHaveLength(0);
  const options = byLabel("Agent list options")[0];
  expect(options.props.accessibilityState).toMatchObject({ selected: false });
  act(() => options.props.onPress());
  expect(onOptions).toHaveBeenCalledTimes(1);
});

test("with_a_filter_the_title_names_it_and_show_all_clears_it", () => {
  const { onClear } = render(true);
  expect(texts()).toContain("Needs you");
  const options = byLabel("Agent list options")[0];
  expect(options.props.accessibilityState).toMatchObject({ selected: true });
  // The selected state: the options icon is in the accent.
  expect(tree!.root.findAll((n) => n.props.color === colors.accent).length).toBeGreaterThan(0);
  act(() => byLabel("Show all")[0].props.onPress());
  expect(onClear).toHaveBeenCalledTimes(1);
});
