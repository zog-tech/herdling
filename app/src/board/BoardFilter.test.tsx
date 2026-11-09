import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { colors } from "@/theme/tokens";

import { FilterButton, FilterField, NoMatch, noMatchText } from "./BoardFilter";

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

const byLabel = (t: ReactTestRenderer, label: string) =>
  t.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");

test("the field sends the query and the close button closes", () => {
  const onQuery = jest.fn();
  const onClose = jest.fn();
  act(() => {
    tree = create(<FilterField query="api" onQuery={onQuery} onClose={onClose} autoFocus />);
  });
  const input = tree!.root.findByType(TextInput);
  expect(input.props.value).toBe("api");
  expect(input.props.autoFocus).toBe(true);
  expect(input.props.accessibilityLabel).toBe("Filter agents");
  act(() => input.props.onChangeText("api-s"));
  expect(onQuery).toHaveBeenCalledWith("api-s");
  act(() => byLabel(tree!, "Close filter").props.onPress());
  expect(onClose).toHaveBeenCalled();
});

test("the button is gold only while the field shows", () => {
  const icon = (open: boolean) => {
    act(() => {
      tree = create(<FilterButton open={open} onPress={() => {}} />);
    });
    const button = byLabel(tree!, "Filter agents");
    expect(button.props.accessibilityState).toEqual({ expanded: open });
    const color = tree!.root.findAll((n) => n.props.color !== undefined)[0].props.color;
    act(() => tree!.unmount());
    tree = undefined;
    return color;
  };
  expect(icon(true)).toBe(colors.accent);
  expect(icon(false)).toBe(colors.text);
});

test("the empty state names the query and clears it", () => {
  expect(noMatchText("  docs ")).toBe("No agent matches “docs”.");
  const onClear = jest.fn();
  act(() => {
    tree = create(<NoMatch query="docs" onClear={onClear} />);
  });
  act(() => byLabel(tree!, "Clear").props.onPress());
  expect(onClear).toHaveBeenCalled();
});
