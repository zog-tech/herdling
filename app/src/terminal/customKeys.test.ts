import { addKey, cleanKey, cleanMacro, CUSTOM_KEY_CAP, DEFAULT_CUSTOM_KEYS, editKey, keyA11y, keyLabel, moveKey, removeKey, type CustomKey } from "./customKeys";

jest.mock("@/secureStorage", () => ({ secureJSONStorage: () => undefined }));

const t = (text: string, enter = false): CustomKey => ({ kind: "text", text, enter });

test("defaults_are_the_examples", () => {
  expect(DEFAULT_CUSTOM_KEYS.map(keyLabel)).toEqual(["/new ⏎", "yes ⏎", "1"]);
});

test("clean_rules", () => {
  expect(cleanMacro("")).toBeNull();
  expect(cleanMacro("  ")).toBeNull();
  expect(cleanMacro(" ")).toBe(" ");
  expect(cleanMacro("a\nb")).toBe("a b");
  expect(cleanKey({ kind: "key", key: "f5" })).toEqual({ kind: "key", key: "f5" });
  expect(cleanKey({ kind: "key", key: "rm -rf" })).toBeNull();
  expect(cleanKey({ kind: "text", text: "yes", enter: "x" })).toEqual(t("yes"));
  expect(cleanKey(null)).toBeNull();
});

test("add_edit_remove_move", () => {
  let l: readonly CustomKey[] = [];
  l = addKey(l, t("yes", true));
  l = addKey(l, { kind: "key", key: "home" });
  expect(addKey(l, t("yes", true))).toBe(l);
  expect(addKey(l, t(""))).toBe(l);
  expect(editKey(l, 0, t("no", true))[0]).toEqual(t("no", true));
  expect(editKey(l, 9, t("no"))).toBe(l);
  expect(moveKey(l, 0, 1).map(keyLabel)).toEqual(["Home", "yes ⏎"]);
  expect(removeKey(l, 0).map(keyLabel)).toEqual(["Home"]);
  const full = Array.from({ length: CUSTOM_KEY_CAP }, (_, i) => t(String(i)));
  expect(addKey(full, t("x"))).toBe(full);
});

test("labels_and_a11y", () => {
  expect(keyLabel(t(" "))).toBe("Space");
  expect(keyLabel(t("a very long macro text"))).toBe("a very long…");
  expect(keyA11y(t("yes", true))).toBe("Type yes and press Enter");
  expect(keyA11y({ kind: "key", key: "pageup" })).toBe("Page Up");
});
