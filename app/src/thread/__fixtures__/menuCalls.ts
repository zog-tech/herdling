import type { MenuSpec } from "@/ui/MenuSheet";

/**
 * Test help: reads the calls of a mocked `showMenu` in the shape of the old action sheet, so a test
 * can check the row labels in order and pick a row by its index.
 * `options` has the labels of all sections in order, then "Cancel"; a pick of the "Cancel" index
 * runs `onClose`, as a close of the sheet with no pick does.
 */
export type SheetView = {
  title?: string;
  message?: string;
  options: string[];
  cancelButtonIndex: number;
  destructiveButtonIndex: number[];
  spec: MenuSpec;
};

export function asSheet(spec: MenuSpec): [SheetView, (i: number) => void] {
  const items = spec.sections.flatMap((s) => s.items);
  const view: SheetView = {
    title: spec.title,
    message: spec.detail,
    options: [...items.map((i) => i.label), "Cancel"],
    cancelButtonIndex: items.length,
    destructiveButtonIndex: items.flatMap((it, i) => (it.destructive ? [i] : [])),
    spec,
  };
  const pick = (i: number) => {
    const it = items[i];
    if (it) it.onPick();
    else spec.onClose?.();
  };
  return [view, pick];
}

/** The calls of a mocked `showMenu`, each as `[SheetView, pick]`. */
export function menuCalls(fn: jest.Mock) {
  return {
    mockClear: () => fn.mockClear(),
    get mock() {
      return { calls: fn.mock.calls.map((c) => asSheet(c[0] as MenuSpec)) };
    },
  };
}
