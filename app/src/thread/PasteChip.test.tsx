import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { showActionSheet } from "@/ui/nativeSheet";

import { openPasteMenu, PasteChip, PasteViewer } from "./PasteChip";
import { makePaste } from "./pastedText";

jest.mock("@/ui/nativeSheet", () => ({ showActionSheet: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const text = Array.from({ length: 240 }, (_, i) => `row ${i}`).join("\n");
const byLabel = (t: ReactTestRenderer, l: string) => t.root.findAll((n) => n.props.accessibilityLabel === l && !!n.props.onPress);
const hasText = (t: ReactTestRenderer, s: string) => t.root.findAll((n) => n.props.children === s).length > 0;

test("the chip shows the number and the size, and its buttons call back", () => {
  const onPress = jest.fn();
  const onRemove = jest.fn();
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<PasteChip paste={makePaste(1, text)} onPress={onPress} onRemove={onRemove} />);
  });
  expect(hasText(t, "240 lines")).toBe(true);
  act(() => byLabel(t, "Pasted text #1 · 240 lines")[0].props.onPress());
  expect(onPress).toHaveBeenCalledTimes(1);
  act(() => byLabel(t, "Remove pasted text 1")[0].props.onPress());
  expect(onRemove).toHaveBeenCalledTimes(1);
});

test("the chip menu runs View and Insert as text", () => {
  const onView = jest.fn();
  const onInsert = jest.fn();
  openPasteMenu(makePaste(2, "x".repeat(1200)), onView, onInsert);
  const [opts, pick] = (showActionSheet as jest.Mock).mock.calls[0];
  expect(opts).toEqual(
    expect.objectContaining({ title: "Pasted text #2 · 1,200 chars", options: ["View", "Insert as text", "Cancel"], cancelButtonIndex: 2 }),
  );
  pick(0);
  pick(1);
  pick(2);
  expect(onView).toHaveBeenCalledTimes(1);
  expect(onInsert).toHaveBeenCalledTimes(1);
});

test("the viewer shows the full text", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<PasteViewer paste={makePaste(1, text)} visible onClose={() => {}} />);
  });
  expect(t.root.findAll((n) => n.props.children === text && n.props.selectable).length).toBeGreaterThan(0);
});
