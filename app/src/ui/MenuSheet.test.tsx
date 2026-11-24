import { Pencil, X } from "lucide-react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { colors, sheet } from "@/theme/tokens";

import * as haptics from "./haptics";
import { closeMenu, MenuRow, MenuSheetHost, showMenu, useMenuSheet } from "./MenuSheet";
import { initialMenuState } from "./menuMachine";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  initialWindowMetrics: null,
}));
jest.mock("./haptics", () => ({ tap: jest.fn(), press: jest.fn() }));

const mount = (el: React.ReactElement) => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(el);
  });
  return t;
};
const settle = () => {
  for (let i = 0; i < 3; i++) act(() => jest.runAllTimers());
};
/** The composite rows (`Pressable` with a role), without the close button. */
const rows = (t: ReactTestRenderer) =>
  t.root.findAll((n) => n.props.accessibilityRole === "button" && !!n.props.onPress && n.props.accessibilityLabel !== "Close" && typeof n.type !== "string");
const row = (t: ReactTestRenderer, label: string) => rows(t).find((r) => String(r.props.accessibilityLabel).startsWith(label))!;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  useMenuSheet.setState({ state: initialMenuState });
  jest.useRealTimers();
});

test("menu_shows_the_header_sections_and_the_destructive_rows_last", () => {
  const t = mount(<MenuSheetHost />);
  act(() =>
    showMenu({
      title: "api",
      detail: "studio.local · Claude Code",
      sections: [
        { title: "This session", items: [{ label: "Close session", Icon: X, destructive: true, onPick: jest.fn() }, { label: "Rename", Icon: Pencil, onPick: jest.fn() }] },
        { title: "Work", items: [{ label: "Preview", value: "2", onPick: jest.fn() }] },
      ],
    }),
  );
  expect(haptics.press).toHaveBeenCalledTimes(1);
  expect(t.root.findAll((n) => n.props.accessibilityRole === "header" && n.props.children === "api").length).toBeGreaterThan(0);
  expect(t.root.findAll((n) => n.props.children === "studio.local · Claude Code").length).toBeGreaterThan(0);
  expect(rows(t).map((r) => r.props.accessibilityLabel)).toEqual(["Rename", "Preview, 2", "Close session"]);
  expect(t.root.findAll((n) => n.props.children === "THIS SESSION" || n.props.children === "This session").length).toBeGreaterThan(0);
  // The destructive label is red.
  const red = t.root.findAll((n) => n.props.children === "Close session" && n.props.color === colors.danger);
  expect(red.length).toBeGreaterThan(0);
  act(() => t.unmount());
});

test("a_pick_gives_the_tap_haptic_and_runs_after_the_sheet_is_gone", () => {
  const rename = jest.fn();
  const onClose = jest.fn();
  const t = mount(<MenuSheetHost />);
  act(() => showMenu({ sections: [{ items: [{ label: "Rename", onPick: rename }] }], onClose }));
  act(() => row(t, "Rename").props.onPress());
  expect(haptics.tap).toHaveBeenCalledTimes(1);
  expect(rename).not.toHaveBeenCalled();
  settle();
  expect(rename).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  act(() => t.unmount());
});

test("close_paths_run_on_close_and_an_empty_menu_does_not_open", () => {
  const onClose = jest.fn();
  const t = mount(<MenuSheetHost />);
  showMenu({ sections: [{ items: [] }] });
  expect(useMenuSheet.getState().state.kind).toBe("closed");
  act(() => showMenu({ sections: [{ items: [{ label: "A", onPick: jest.fn() }] }], onClose }));
  act(() => closeMenu());
  settle();
  expect(onClose).toHaveBeenCalledTimes(1);
  // The escape gesture of VoiceOver closes too.
  act(() => showMenu({ sections: [{ items: [{ label: "A", onPick: jest.fn() }] }], onClose }));
  act(() => t.root.find((n) => !!n.props.onAccessibilityEscape).props.onAccessibilityEscape());
  settle();
  expect(onClose).toHaveBeenCalledTimes(2);
  act(() => t.unmount());
});

test("checked_and_disabled_rows_report_their_state", () => {
  const off = jest.fn();
  const t = mount(<MenuSheetHost />);
  act(() =>
    showMenu({
      title: "Sort by",
      sections: [{ items: [{ label: "Status", checked: true, onPick: jest.fn() }, { label: "Name", checked: false, onPick: jest.fn() }, { label: "Old", disabled: true, onPick: off }] }],
    }),
  );
  expect(row(t, "Status").props.accessibilityState).toEqual({ selected: true, disabled: false });
  expect(row(t, "Name").props.accessibilityState).toEqual({ selected: false, disabled: false });
  expect(row(t, "Old").props.accessibilityState).toEqual({ selected: false, disabled: true });
  act(() => row(t, "Old").props.onPress());
  settle();
  expect(off).not.toHaveBeenCalled();
  act(() => t.unmount());
});

test("search_filters_the_rows_and_says_when_nothing_matches", () => {
  const t = mount(<MenuSheetHost />);
  act(() => showMenu({ title: "Folder", search: { placeholder: "Search folders" }, sections: [{ items: [{ label: "api", onPick: jest.fn() }, { label: "web", onPick: jest.fn() }] }] }));
  const field = t.root.find((n) => n.props.accessibilityLabel === "Search folders" && !!n.props.onChangeText);
  act(() => field.props.onChangeText("we"));
  expect(rows(t).map((r) => r.props.accessibilityLabel)).toEqual(["web"]);
  act(() => field.props.onChangeText("zzz"));
  expect(rows(t)).toHaveLength(0);
  expect(t.root.findAll((n) => n.props.children === "No match.").length).toBeGreaterThan(0);
  act(() => t.unmount());
});

test("a_new_menu_replaces_the_open_one_and_cancels_it", () => {
  const first = jest.fn();
  const t = mount(<MenuSheetHost />);
  act(() => showMenu({ sections: [{ items: [{ label: "A", onPick: jest.fn() }] }], onClose: first }));
  act(() => showMenu({ sections: [{ items: [{ label: "B", onPick: jest.fn() }] }] }));
  expect(first).toHaveBeenCalledTimes(1);
  expect(rows(t).map((r) => r.props.accessibilityLabel)).toEqual(["B"]);
  act(() => t.unmount());
});

test("the_sheet_clears_the_home_indicator_and_has_the_card_surface", () => {
  const t = mount(<MenuSheetHost />);
  act(() => showMenu({ sections: [{ items: [{ label: "A", onPick: jest.fn() }] }] }));
  const surface = t.root.find((n) => typeof n.type !== "string" && [n.props.style].flat(3).some((s) => s && s.backgroundColor === colors.card && s.borderTopLeftRadius));
  const style = Object.assign({}, ...[surface.props.style].flat(3).filter(Boolean));
  expect(style.paddingBottom).toBeGreaterThanOrEqual(34);
  expect(style.maxHeight).toBeGreaterThan(0);
  act(() => t.unmount());
});

test("menu_row_is_at_least_the_row_height_and_names_its_value", () => {
  const t = mount(<MenuRow item={{ label: "Model", value: "Opus", detail: "Claude Code" }} onPress={jest.fn()} />);
  const p = t.root.find((n) => n.props.accessibilityRole === "button" && typeof n.props.style === "function");
  expect(p.props.accessibilityLabel).toBe("Model, Opus, Claude Code");
  expect(p.props.style({ pressed: false }).minHeight).toBe(sheet.rowHeight);
  expect(p.props.style({ pressed: true }).backgroundColor).toBe(colors.raised);
});
