import { ActionSheetIOS, Alert, Platform } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { MenuSheetHost, useMenuSheet } from "./MenuSheet";
import { initialMenuState } from "./menuMachine";
import { destructiveSet, NativeSheetHost, promptText, showActionSheet, useNativeSheet } from "./nativeSheet";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: null,
}));
jest.mock("./haptics", () => ({ tap: jest.fn(), press: jest.fn() }));

const setOS = (os: "ios" | "android") => Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });

/** The menu rows: buttons with a press handler, without the close button. */
const rows = (t: ReactTestRenderer) =>
  t.root.findAll((n) => n.props.accessibilityRole === "button" && !!n.props.onPress && n.props.accessibilityLabel !== "Close" && typeof n.type !== "string");

const mount = (el: React.ReactElement) => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(el);
  });
  return t;
};

/** Runs the exit animation timer, then the window removal timer (each one starts after a render). */
const settle = () => {
  for (let i = 0; i < 3; i++) act(() => jest.runAllTimers());
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  setOS("ios");
  useNativeSheet.setState({ open: null });
  useMenuSheet.setState({ state: initialMenuState });
  jest.useRealTimers();
});

test.each(["ios", "android"] as const)("%s_draws_the_menu_sheet_not_the_system_sheet_and_reports_the_index", (os) => {
  setOS(os);
  const system = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
  const pick = jest.fn();
  const t = mount(<MenuSheetHost />);
  act(() => showActionSheet({ title: "Agent", message: "studio.local", options: ["Restart", "Reply", "Cancel"], cancelButtonIndex: 2, destructiveButtonIndex: [0] }, pick));
  expect(system).not.toHaveBeenCalled();
  // The title and the message are the header; no Cancel row; the destructive row is last.
  const labels = rows(t).map((r) => r.props.accessibilityLabel);
  expect(labels).toEqual(["Reply", "Restart"]);
  expect(t.root.findAll((n) => n.props.children === "studio.local").length).toBeGreaterThan(0);
  act(() => rows(t)[1].props.onPress());
  // The pick runs only after the sheet is gone.
  expect(pick).not.toHaveBeenCalled();
  settle();
  expect(pick).toHaveBeenCalledWith(0);
  expect(useMenuSheet.getState().state.kind).toBe("closed");
  act(() => t.unmount());
});

test("a_close_without_a_pick_reports_the_cancel_index_or_minus_one", () => {
  const pick = jest.fn();
  const t = mount(<MenuSheetHost />);
  act(() => showActionSheet({ options: ["Reply", "Cancel"], cancelButtonIndex: 1 }, pick));
  act(() => t.root.find((n) => n.props.accessibilityLabel === "Close" && !!n.props.onPress).props.onPress());
  settle();
  expect(pick).toHaveBeenLastCalledWith(1);

  act(() => showActionSheet({ options: ["Reply"] }, pick));
  act(() => t.root.find((n) => n.props.testID === "menu-scrim").props.onPress());
  settle();
  expect(pick).toHaveBeenLastCalledWith(-1);
  act(() => t.unmount());
});

test("a_pick_can_open_a_second_sheet_as_a_confirm_does", () => {
  const confirm = jest.fn();
  const t = mount(<MenuSheetHost />);
  act(() =>
    showActionSheet({ options: ["Close agent", "Cancel"], cancelButtonIndex: 1 }, () =>
      showActionSheet({ title: "Close the agent?", options: ["Close it", "Cancel"], destructiveButtonIndex: 0, cancelButtonIndex: 1 }, confirm),
    ),
  );
  act(() => rows(t)[0].props.onPress());
  settle();
  expect(useMenuSheet.getState().state.kind).toBe("open");
  act(() => rows(t)[0].props.onPress());
  settle();
  expect(confirm).toHaveBeenCalledWith(0);
  act(() => t.unmount());
});

test("only_a_cancel_option_reports_the_cancel_at_once", () => {
  const pick = jest.fn();
  showActionSheet({ options: ["Cancel"], cancelButtonIndex: 0 }, pick);
  expect(useMenuSheet.getState().state.kind).toBe("closed");
  jest.runAllTimers();
  expect(pick).toHaveBeenCalledWith(0);
});

test("ios_prompt_uses_the_system_prompt", () => {
  setOS("ios");
  const prompt = jest.spyOn(Alert, "prompt").mockImplementation(() => {});
  promptText("Rename tab", "The tab name.", [{ text: "Save" }], "build");
  expect(prompt).toHaveBeenCalledWith("Rename tab", "The tab name.", [{ text: "Save" }], "plain-text", "build");
  expect(useNativeSheet.getState().open).toBeNull();
});

test("android_prompt_returns_the_text", () => {
  setOS("android");
  const t = mount(<NativeSheetHost />);
  const save = jest.fn();
  act(() => promptText("Rename tab", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Save", onPress: save }], "old"));
  const input = t.root.find((n) => n.props.accessibilityLabel === "Rename tab" && !!n.props.onChangeText);
  act(() => input.props.onChangeText("new name"));
  const saveButton = t.root.findAll((n) => n.props.accessibilityRole === "button" && !!n.props.onPress)[1];
  act(() => saveButton.props.onPress());
  act(() => jest.runAllTimers());
  expect(save).toHaveBeenCalledWith("new name");
  act(() => t.unmount());
});

test("destructive_indexes_accept_a_number_or_a_list", () => {
  expect([...destructiveSet({ options: ["a", "b", "c"], destructiveButtonIndex: 2 })]).toEqual([2]);
  expect([...destructiveSet({ options: ["a", "b", "c", "d"], destructiveButtonIndex: [0, 3] })]).toEqual([0, 3]);
  expect(destructiveSet({ options: [] }).size).toBe(0);
  // `indexOf` of a missing action gives -1: no red row.
  expect(destructiveSet({ options: ["a"], destructiveButtonIndex: -1 }).size).toBe(0);
});
