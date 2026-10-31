import * as Clipboard from "expo-clipboard";
import { Platform, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SelectTextScreen from "@/app/select-text";

import { useSelectText } from "./selectText";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
const mockOptions = jest.fn();
jest.mock("expo-router", () => ({ Stack: { Screen: ({ options }: { options: unknown }) => (mockOptions(options), null) } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const TEXT = "Run **this** first.\n\nThen the tests.";
const os = Platform.OS;

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  useSelectText.setState({ current: { title: "Reply", text: TEXT } });
  mockOptions.mockClear();
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  Platform.OS = os;
});

function render() {
  act(() => {
    tree = create(<SelectTextScreen />);
  });
  return tree!;
}

test("ios_shows_a_read_only_text_view_with_range_selection", () => {
  Platform.OS = "ios";
  const t = render();
  const input = t.root.findByType(TextInput);
  expect(input.props.value).toBe(TEXT);
  expect(input.props.editable).toBe(false);
  expect(input.props.multiline).toBe(true);
  expect(mockOptions).toHaveBeenCalledWith(expect.objectContaining({ title: "Reply" }));
});

test("android_shows_selectable_text", () => {
  Platform.OS = "android";
  const t = render();
  expect(t.root.findAllByType(TextInput)).toHaveLength(0);
  const text = t.root.findAll((n) => n.type === Text && n.props.selectable === true);
  expect(text[0].props.children).toBe(TEXT);
});

test("copy_all_copies_the_full_text", async () => {
  render();
  const opts = mockOptions.mock.calls.at(-1)[0] as { headerRight: () => React.ReactElement };
  let header: ReactTestRenderer;
  act(() => {
    header = create(opts.headerRight());
  });
  await act(async () => header!.root.findByProps({ accessibilityLabel: "Copy all" }).props.onPress());
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(TEXT);
  expect(header!.root.findByProps({ accessibilityLabel: "Copied" })).toBeTruthy();
  act(() => header!.unmount());
});
