import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { StartOptionsSheet } from "./StartOptionsSheet";
import { useStartOptionsMemory } from "./startOptionsMemory";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

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

function render(kind: string) {
  act(() => {
    tree = create(<StartOptionsSheet kind={kind} onClose={onClose} />);
  });
  return tree!;
}

const input = (t: ReactTestRenderer, label: string) => t.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === label)!;
const pressable = (t: ReactTestRenderer, label: string) =>
  t.root.find(
    (n) =>
      n.props.accessibilityLabel === label &&
      ["button", "tab"].includes(n.props.accessibilityRole) &&
      typeof n.props.onPress === "function",
  );
/** A mode row: its label starts with the mode label. */
const modeRow = (t: ReactTestRenderer, label: string) =>
  t.root.find(
    (n) =>
      n.props.accessibilityRole === "radio" && typeof n.props.onPress === "function" && n.props.accessibilityLabel.startsWith(`${label}. `),
  );
const preview = (t: ReactTestRenderer) =>
  t.root.find((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Command: ")).props.children;
const has = (t: ReactTestRenderer, text: string) => t.root.findAll((n) => n.props.children === text).length > 0;

test("the header names the sheet and the agent, and no field takes the focus", () => {
  const t = render("claude");
  expect(has(t, "Start options")).toBe(true);
  expect(has(t, "Claude Code")).toBe(true);
  expect(t.root.findAllByType(TextInput).some((n) => n.props.autoFocus)).toBe(false);
  act(() => pressable(t, "Close").props.onPress());
  expect(onClose).toHaveBeenCalled();
});

test("a mode row writes the store at once and moves the check mark", () => {
  const t = render("claude");
  expect(modeRow(t, "Default").props.accessibilityState.selected).toBe(true);
  act(() => modeRow(t, "Skip permissions").props.onPress());
  expect(useStartOptionsMemory.getState().byKind.claude).toEqual({
    mode: "skip",
  });
  expect(modeRow(t, "Skip permissions").props.accessibilityState.selected).toBe(true);
  expect(modeRow(t, "Default").props.accessibilityState.selected).toBe(false);
  expect(preview(t)).toBe("$ claude --dangerously-skip-permissions");
  act(() => modeRow(t, "Default").props.onPress());
  expect(useStartOptionsMemory.getState().byKind.claude).toEqual({});
});

test("every mode of every kind has a detail line", () => {
  for (const kind of ["claude", "codex", "gemini", "opencode"]) {
    const t = render(kind);
    const rows = t.root.findAll((n) => n.props.accessibilityRole === "radio" && typeof n.props.onPress === "function");
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(r.props.accessibilityLabel).toMatch(/^[^.]+\. \S.+\.$/);
    act(() => t.unmount());
    tree = undefined;
  }
});

test("Claude model chips write the alias, and the custom field takes any other name", () => {
  const t = render("claude");
  expect(pressable(t, "Default model").props.accessibilityState.selected).toBe(true);
  act(() => pressable(t, "Opus").props.onPress());
  expect(useStartOptionsMemory.getState().byKind.claude).toEqual({
    model: "opus",
  });
  expect(pressable(t, "Opus").props.accessibilityState.selected).toBe(true);
  // An alias does not show in the custom field.
  expect(input(t, "Custom model").props.value).toBe("");
  expect(preview(t)).toBe("$ claude --model opus");
  act(() => input(t, "Custom model").props.onChangeText("claude-opus-4-1"));
  expect(pressable(t, "Opus").props.accessibilityState.selected).toBe(false);
  act(() => input(t, "Custom model").props.onEndEditing());
  expect(useStartOptionsMemory.getState().byKind.claude).toEqual({
    model: "claude-opus-4-1",
  });
  act(() => pressable(t, "Default model").props.onPress());
  expect(useStartOptionsMemory.getState().byKind.claude).toEqual({});
});

test("other kinds have only the model name field, with no chips", () => {
  const t = render("codex");
  expect(t.root.findAll((n) => n.props.accessibilityLabel === "Opus")).toHaveLength(0);
  expect(input(t, "Model").props.placeholder).toBe("Model name");
});

test("model and extra flags show in the preview at once and reach the store when editing ends", () => {
  useStartOptionsMemory.setState({ byKind: { claude: { mode: "plan" } } });
  const t = render("claude");
  expect(preview(t)).toBe("$ claude --permission-mode plan");
  act(() => input(t, "Custom model").props.onChangeText("opus-x "));
  act(() => input(t, "Extra flags").props.onChangeText("--verbose"));
  expect(preview(t)).toBe("$ claude --permission-mode plan --model opus-x --verbose");
  // Not stored while the user types.
  expect(useStartOptionsMemory.getState().byKind.claude).toEqual({
    mode: "plan",
  });
  act(() => input(t, "Extra flags").props.onEndEditing());
  expect(useStartOptionsMemory.getState().byKind.claude).toEqual({
    mode: "plan",
    model: "opus-x",
    extra: "--verbose",
  });
});

test("closing the sheet keeps the typed text", () => {
  const t = render("codex");
  act(() => input(t, "Model").props.onChangeText("o3"));
  act(() => t.unmount());
  tree = undefined;
  expect(useStartOptionsMemory.getState().byKind.codex).toEqual({
    model: "o3",
  });
});

test("Reset to default is off at the default and clears every option of the kind", () => {
  const t0 = render("claude");
  expect(pressable(t0, "Reset to default").props.accessibilityState.disabled).toBe(true);
  act(() => t0.unmount());
  useStartOptionsMemory.setState({
    byKind: {
      claude: { mode: "skip", model: "opus", extra: "--x" },
      codex: { mode: "readOnly" },
    },
  });
  const t = render("claude");
  const reset = () => pressable(t, "Reset to default");
  expect(reset().props.accessibilityState.disabled).toBe(false);
  act(() => reset().props.onPress());
  expect(input(t, "Custom model").props.value).toBe("");
  expect(input(t, "Extra flags").props.value).toBe("");
  expect(preview(t)).toBe("$ claude");
  expect(reset().props.accessibilityState.disabled).toBe(true);
  act(() => t.unmount());
  tree = undefined;
  expect(useStartOptionsMemory.getState().byKind).toEqual({
    claude: {},
    codex: { mode: "readOnly" },
  });
});

test("Pi has the thinking control and no modes, and an agent with no model flag has no model field", () => {
  const t = render("pi");
  expect(t.root.findAll((n) => n.props.accessibilityRole === "radio" && typeof n.props.onPress === "function")).toHaveLength(0);
  act(() => pressable(t, "High").props.onPress());
  expect(useStartOptionsMemory.getState().byKind.pi).toEqual({
    thinking: "high",
  });
  expect(preview(t)).toBe("$ pi --thinking high");
  act(() => t.unmount());
  const other = render("opencode");
  expect(other.root.findAllByType(TextInput).map((n) => n.props.accessibilityLabel)).toEqual(["Extra flags"]);
});
