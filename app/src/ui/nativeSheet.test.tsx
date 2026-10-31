import { ActionSheetIOS, Alert, Platform } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { destructiveSet, NativeSheetHost, promptText, showActionSheet, useNativeSheet } from "./nativeSheet";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const setOS = (os: "ios" | "android") => Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });

afterEach(() => {
  setOS("ios");
  useNativeSheet.setState({ open: null });
  jest.useRealTimers();
});

test("ios_uses_the_system_action_sheet_and_prompt", () => {
  setOS("ios");
  const sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
  const prompt = jest.spyOn(Alert, "prompt").mockImplementation(() => {});
  const pick = jest.fn();
  showActionSheet({ options: ["Rename", "Cancel"], cancelButtonIndex: 1 }, pick);
  expect(sheet).toHaveBeenCalledWith({ options: ["Rename", "Cancel"], cancelButtonIndex: 1 }, pick);
  promptText("Rename tab", "The tab name.", [{ text: "Save" }], "build");
  expect(prompt).toHaveBeenCalledWith("Rename tab", "The tab name.", [{ text: "Save" }], "plain-text", "build");
  expect(useNativeSheet.getState().open).toBeNull();
});

test("android_shows_the_sheet_and_reports_the_picked_index", () => {
  setOS("android");
  jest.useFakeTimers();
  const pick = jest.fn();
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<NativeSheetHost />);
  });
  act(() => showActionSheet({ title: "Agent", options: ["Reply", "Restart", "Cancel"], cancelButtonIndex: 2, destructiveButtonIndex: [1] }, pick));
  const buttons = t.root.findAll((n) => n.props.accessibilityRole === "button" && !!n.props.onPress);
  expect(buttons).toHaveLength(3);
  act(() => buttons[1].props.onPress());
  act(() => jest.runAllTimers());
  expect(pick).toHaveBeenCalledWith(1);
  expect(useNativeSheet.getState().open).toBeNull();
  act(() => t.unmount());
});

test("android_dismiss_picks_cancel_and_prompt_returns_the_text", () => {
  setOS("android");
  jest.useFakeTimers();
  const pick = jest.fn();
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<NativeSheetHost />);
  });
  act(() => showActionSheet({ options: ["Reply", "Cancel"], cancelButtonIndex: 1 }, pick));
  act(() => t.root.find((n) => n.props.accessibilityLabel === "Close" && !!n.props.onPress).props.onPress());
  act(() => jest.runAllTimers());
  expect(pick).toHaveBeenCalledWith(1);

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
  expect([...destructiveSet({ options: [], destructiveButtonIndex: 2 })]).toEqual([2]);
  expect([...destructiveSet({ options: [], destructiveButtonIndex: [0, 3] })]).toEqual([0, 3]);
  expect(destructiveSet({ options: [] }).size).toBe(0);
});
