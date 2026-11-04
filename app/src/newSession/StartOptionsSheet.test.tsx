import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { StartOptionsSheet } from "./StartOptionsSheet";
import { useStartOptionsMemory } from "./startOptionsMemory";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

let tree: ReactTestRenderer | undefined;
const onClose = jest.fn();

beforeEach(() => {
  useStartOptionsMemory.setState({ byKind: {} });
  onClose.mockClear();
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

function render(kind: string, focus?: "model" | "extra") {
  act(() => {
    tree = create(<StartOptionsSheet kind={kind} focus={focus} onClose={onClose} />);
  });
  return tree!;
}

const input = (t: ReactTestRenderer, label: string) => t.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === label)!;
const button = (t: ReactTestRenderer, label: string) =>
  t.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");
const preview = (t: ReactTestRenderer) => t.root.find((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Command: ")).props.children;

test("names the agent and focuses the asked field", () => {
  const t = render("claude", "model");
  expect(t.root.findAll((n) => n.props.children === "Start options · Claude Code").length).toBeGreaterThan(0);
  expect(input(t, "Model").props.autoFocus).toBe(true);
  expect(input(t, "Extra flags").props.autoFocus).toBe(false);
});

test("model and extra flags show in the preview at once and reach the store when editing ends", () => {
  useStartOptionsMemory.setState({ byKind: { claude: { mode: "plan" } } });
  const t = render("claude");
  expect(preview(t)).toBe("claude --permission-mode plan");
  act(() => input(t, "Model").props.onChangeText("opus "));
  act(() => input(t, "Extra flags").props.onChangeText("--verbose"));
  expect(preview(t)).toBe("claude --permission-mode plan --model opus --verbose");
  // Not stored while the user types.
  expect(useStartOptionsMemory.getState().byKind.claude).toEqual({ mode: "plan" });
  act(() => input(t, "Extra flags").props.onEndEditing());
  expect(useStartOptionsMemory.getState().byKind.claude).toEqual({ mode: "plan", model: "opus", extra: "--verbose" });
});

test("closing the sheet keeps the typed text", () => {
  const t = render("codex");
  act(() => input(t, "Model").props.onChangeText("o3"));
  act(() => t.unmount());
  tree = undefined;
  expect(useStartOptionsMemory.getState().byKind.codex).toEqual({ model: "o3" });
});

test("Reset to default clears every option of the kind", () => {
  useStartOptionsMemory.setState({ byKind: { claude: { mode: "skip", model: "opus", extra: "--x" }, codex: { mode: "readOnly" } } });
  const t = render("claude");
  act(() => button(t, "Reset to default").props.onPress());
  expect(input(t, "Model").props.value).toBe("");
  expect(input(t, "Extra flags").props.value).toBe("");
  expect(preview(t)).toBe("claude");
  act(() => t.unmount());
  tree = undefined;
  expect(useStartOptionsMemory.getState().byKind).toEqual({ claude: {}, codex: { mode: "readOnly" } });
});

test("Pi has the thinking control, and an agent with no model flag has no model field", () => {
  const t = render("pi");
  act(() => button(t, "High").props.onPress());
  expect(useStartOptionsMemory.getState().byKind.pi).toEqual({ thinking: "high" });
  expect(preview(t)).toBe("pi --thinking high");
  act(() => t.unmount());
  const other = render("opencode");
  expect(other.root.findAllByType(TextInput).map((n) => n.props.accessibilityLabel)).toEqual(["Extra flags"]);
});
