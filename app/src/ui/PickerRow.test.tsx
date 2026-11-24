import { Text as RNText } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useMenuSheet } from "./MenuSheet";
import { initialMenuState } from "./menuMachine";
import { PICKER_SEARCH_MIN } from "./menuRules";
import { PickerRow } from "./PickerRow";
import { showPicker } from "./PickerSheet";

jest.mock("./haptics", () => ({ tap: jest.fn(), press: jest.fn() }));

const mount = (el: React.ReactElement) => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(el);
  });
  return t;
};
const OPTIONS = [
  { value: "claude", label: "Claude Code", leading: <RNText testID="mark-claude">C</RNText> },
  { value: "codex", label: "Codex" },
];
const openMenu = () => {
  const s = useMenuSheet.getState().state;
  if (s.kind !== "open") throw new Error(`menu is ${s.kind}`);
  return s.menu;
};

afterEach(() => useMenuSheet.setState({ state: initialMenuState }));

test("picker_row_shows_the_picked_label_and_its_mark", () => {
  const t = mount(<PickerRow title="Agent" picker={{ options: OPTIONS, value: "claude", onPick: jest.fn() }} />);
  const p = t.root.find((n) => n.props.accessibilityRole === "button" && !!n.props.onPress && typeof n.type !== "string");
  expect(p.props.accessibilityLabel).toBe("Agent");
  expect(p.props.accessibilityValue).toEqual({ text: "Claude Code" });
  expect(t.root.findAll((n) => n.props.testID === "mark-claude").length).toBeGreaterThan(0);
});

test("a_tap_opens_the_picker_with_the_row_title_and_a_check_on_the_value", () => {
  const onPick = jest.fn();
  const t = mount(<PickerRow title="Agent" picker={{ options: OPTIONS, value: "claude", onPick }} />);
  act(() => t.root.find((n) => n.props.accessibilityRole === "button" && !!n.props.onPress && typeof n.type !== "string").props.onPress());
  const menu = openMenu();
  expect(menu.title).toBe("Agent");
  expect(menu.search).toBeUndefined();
  expect(menu.sections[0].items.map((i) => [i.label, i.checked])).toEqual([
    ["Claude Code", true],
    ["Codex", false],
  ]);
  menu.sections[0].items[1].onPick();
  expect(onPick).toHaveBeenCalledWith("codex");
});

test("on_press_row_shows_the_value_or_the_placeholder", () => {
  const onPress = jest.fn();
  const t = mount(<PickerRow title="Folder" placeholder="Choose" mono onPress={onPress} />);
  const p = t.root.find((n) => n.props.accessibilityRole === "button" && !!n.props.onPress && typeof n.type !== "string");
  expect(p.props.accessibilityValue).toEqual({ text: "Choose" });
  act(() => p.props.onPress());
  expect(onPress).toHaveBeenCalled();
  const t2 = mount(<PickerRow title="Folder" value="/home/sam/proj/api" mono onPress={onPress} />);
  expect(t2.root.findAll((n) => n.props.ellipsizeMode === "middle").length).toBeGreaterThan(0);
});

test("long_pickers_get_a_search_field_and_sections_keep_their_titles", () => {
  const many = Array.from({ length: PICKER_SEARCH_MIN }, (_, i) => ({ value: i, label: `Space ${i}` }));
  showPicker({ title: "Space", options: many, value: 3, onPick: jest.fn() });
  expect(openMenu().search).toEqual({ placeholder: "Search space" });
  showPicker({ title: "Space", sections: [{ title: "studio.local", options: many.slice(0, 2) }], value: 0, onPick: jest.fn(), search: false });
  expect(openMenu().search).toBeUndefined();
  expect(openMenu().sections[0].title).toBe("studio.local");
});

test("picker_row_expanded_reports_its_state_and_turns_the_chevron", () => {
  const { ChevronRight } = jest.requireActual("lucide-react-native");
  const button = (t: ReactTestRenderer) => t.root.find((n) => n.props.accessibilityRole === "button" && !!n.props.onPress && typeof n.type !== "string");
  const t = mount(<PickerRow title="Folder" value="~/proj" mono expanded={false} onPress={jest.fn()} />);
  expect(button(t).props.accessibilityState).toEqual({ disabled: false, expanded: false });
  expect(t.root.findByType(ChevronRight).props.style).toBeUndefined();
  act(() => t.update(<PickerRow title="Folder" value="~/proj" mono expanded onPress={jest.fn()} />));
  expect(button(t).props.accessibilityState).toEqual({ disabled: false, expanded: true });
  expect(t.root.findByType(ChevronRight).props.style).toEqual({ transform: [{ rotate: "90deg" }] });
  // A plain row says nothing about expanded.
  act(() => t.update(<PickerRow title="Folder" value="~/proj" onPress={jest.fn()} />));
  expect(button(t).props.accessibilityState).toEqual({ disabled: false });
});
