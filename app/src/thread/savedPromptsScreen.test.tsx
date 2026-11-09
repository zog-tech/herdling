import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SavedPromptsScreen from "@/app/saved-prompts";
import { promptText, showActionSheet } from "@/ui/nativeSheet";

import { DEFAULT_PROMPTS, restoreDefaultPrompts, useSavedPrompts } from "./savedPrompts";

jest.mock("@/secureStorage", () => {
  const { createJSONStorage } = jest.requireActual("zustand/middleware");
  const mem = new Map<string, string>();
  return {
    secureJSONStorage: () =>
      createJSONStorage(() => ({
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      })),
  };
});
jest.mock("@/ui/nativeSheet", () => ({ showActionSheet: jest.fn(), promptText: jest.fn() }));
jest.mock("@/ui/haptics", () => ({ tap: jest.fn(), commit: jest.fn(), warn: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.clearAllMocks();
  restoreDefaultPrompts();
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

function render() {
  act(() => {
    tree = create(<SavedPromptsScreen />);
  });
  return tree!;
}
const row = (t: ReactTestRenderer, label: string) =>
  t.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");

test("lists the prompts and a tap opens the menu that moves one", () => {
  const t = render();
  act(() => row(t, "Saved prompt 1 of 5: Continue").props.onPress());
  const [opts, pick] = (showActionSheet as jest.Mock).mock.calls[0];
  expect(opts.options).toEqual(["Edit", "Move down", "Delete", "Cancel"]);
  expect(opts.destructiveButtonIndex).toBe(2);
  act(() => pick(1));
  expect(useSavedPrompts.getState().prompts.slice(0, 2)).toEqual(["Yes, go ahead", "Continue"]);
});

test("the VoiceOver actions delete and move", () => {
  const t = render();
  act(() => row(t, "Saved prompt 5 of 5: Commit and push").props.onAccessibilityAction({ nativeEvent: { actionName: "up" } }));
  expect(useSavedPrompts.getState().prompts[3]).toBe("Commit and push");
  act(() => row(t, "Saved prompt 1 of 5: Continue").props.onAccessibilityAction({ nativeEvent: { actionName: "delete" } }));
  expect(useSavedPrompts.getState().prompts).toEqual(["Yes, go ahead", "Run the tests", "Commit and push", "Explain the change"]);
});

test("add asks for the text and saves it at the end", () => {
  const t = render();
  act(() => row(t, "Add a prompt").props.onPress());
  const [title, , buttons] = (promptText as jest.Mock).mock.calls[0];
  expect(title).toBe("New saved prompt");
  act(() => buttons[1].onPress("Fix the lint errors"));
  expect(useSavedPrompts.getState().prompts).toEqual([...DEFAULT_PROMPTS, "Fix the lint errors"]);
});

test("edit starts with the current text", () => {
  const t = render();
  act(() => row(t, "Saved prompt 3 of 5: Run the tests").props.onPress());
  act(() => (showActionSheet as jest.Mock).mock.calls[0][1](0));
  const [title, , buttons, value] = (promptText as jest.Mock).mock.calls[0];
  expect(title).toBe("Edit saved prompt");
  expect(value).toBe("Run the tests");
  act(() => buttons[1].onPress("Run the unit tests"));
  expect(useSavedPrompts.getState().prompts[2]).toBe("Run the unit tests");
});
