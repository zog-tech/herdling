/**
 * Custom keys of the key bar: text macros ("/new", "yes", "1") and extra named keys (Home, F5).
 * Settings, "Key bar" edits the list; it stays on this phone. The functions here are the pure
 * rules; the store persists the list like the saved prompts.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

/** A text macro (typed as is, then Enter when `enter`), or a named key. */
export type CustomKey = { kind: "text"; text: string; enter: boolean } | { kind: "key"; key: string };

/** The most custom keys. The keychain keeps small values only. */
export const CUSTOM_KEY_CAP = 16;
/** A longer macro is cut to this length. */
export const MACRO_MAX_CHARS = 200;

export const DEFAULT_CUSTOM_KEYS: readonly CustomKey[] = [
  { kind: "text", text: "/new", enter: true },
  { kind: "text", text: "yes", enter: true },
  { kind: "text", text: "1", enter: false },
];

/** The named keys a custom key can be, with their labels. Each has a herdr 1 fallback or is known to both backends. */
export const KEY_CHOICES: readonly { key: string; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "end", label: "End" },
  { key: "pageup", label: "Page Up" },
  { key: "pagedown", label: "Page Down" },
  { key: "delete", label: "Delete" },
  { key: "backspace", label: "Backspace" },
  ...Array.from({ length: 12 }, (_, i) => ({ key: `f${i + 1}`, label: `F${i + 1}` })),
  { key: "ctrl+d", label: "Ctrl-D" },
  { key: "ctrl+l", label: "Ctrl-L" },
  { key: "ctrl+r", label: "Ctrl-R" },
  { key: "ctrl+z", label: "Ctrl-Z" },
];

/** A macro text as it is kept: cut to the length limit. Spaces stay (a macro can be " "). Null when empty. */
export function cleanMacro(text: string): string | null {
  const t = text.replace(/[\r\n]+/g, " ").slice(0, MACRO_MAX_CHARS);
  return t.trim() === "" && t !== " " ? null : t;
}

/** A valid item, or null. A key must be in `KEY_CHOICES`. */
export function cleanKey(k: unknown): CustomKey | null {
  if (typeof k !== "object" || k === null) return null;
  const o = k as { kind?: unknown; text?: unknown; enter?: unknown; key?: unknown };
  if (o.kind === "text" && typeof o.text === "string") {
    const text = cleanMacro(o.text);
    return text === null ? null : { kind: "text", text, enter: o.enter === true };
  }
  if (o.kind === "key" && KEY_CHOICES.some((c) => c.key === o.key)) return { kind: "key", key: o.key as string };
  return null;
}

const sameKey = (a: CustomKey, b: CustomKey) =>
  a.kind === b.kind && (a.kind === "text" ? a.text === (b as typeof a).text && a.enter === (b as typeof a).enter : a.key === (b as typeof a).key);

/** The list with `k` at the end. An invalid item, one that is already there, or a full list: no change. */
export function addKey(list: readonly CustomKey[], k: CustomKey, cap = CUSTOM_KEY_CAP): readonly CustomKey[] {
  const c = cleanKey(k);
  if (!c || list.length >= cap || list.some((x) => sameKey(x, c))) return list;
  return [...list, c];
}

/** The list with the item at `index` replaced. An invalid item or index: no change. */
export function editKey(list: readonly CustomKey[], index: number, k: CustomKey): readonly CustomKey[] {
  const c = cleanKey(k);
  if (!c || index < 0 || index >= list.length || sameKey(list[index], c)) return list;
  return list.map((x, i) => (i === index ? c : x));
}

export function removeKey(list: readonly CustomKey[], index: number): readonly CustomKey[] {
  return index < 0 || index >= list.length ? list : list.filter((_, i) => i !== index);
}

export function moveKey(list: readonly CustomKey[], from: number, to: number): readonly CustomKey[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = [...list];
  const [k] = out.splice(from, 1);
  out.splice(to, 0, k);
  return out;
}

/** The label on the key bar: the macro text (with "⏎" when it presses Enter), or the key label. */
export function keyLabel(k: CustomKey): string {
  if (k.kind === "key") return KEY_CHOICES.find((c) => c.key === k.key)?.label ?? k.key;
  const t = k.text === " " ? "Space" : k.text.length > 12 ? `${k.text.slice(0, 11)}…` : k.text;
  return k.enter ? `${t} ⏎` : t;
}

/** The words for a screen reader. */
export function keyA11y(k: CustomKey): string {
  if (k.kind === "key") return keyLabel(k);
  return k.enter ? `Type ${k.text} and press Enter` : `Type ${k.text}`;
}

type Store = { keys: readonly CustomKey[] };

/** The custom keys, persisted on this phone. A new install starts with the defaults. */
export const useCustomKeys = create<Store>()(
  persist(() => ({ keys: DEFAULT_CUSTOM_KEYS }) as Store, {
    name: "herdling.custom_keys",
    storage: secureJSONStorage(),
    // A damaged or newer value keeps only the items that this app knows.
    merge: (saved, current) => {
      const keys = (saved as { keys?: unknown } | undefined)?.keys;
      if (!Array.isArray(keys)) return current;
      return { ...current, keys: keys.map(cleanKey).filter((k): k is CustomKey => k !== null).slice(0, CUSTOM_KEY_CAP) };
    },
  }),
);

function update(f: (list: readonly CustomKey[]) => readonly CustomKey[]): void {
  useCustomKeys.setState((s) => {
    const next = f(s.keys);
    return next === s.keys ? s : { keys: next };
  });
}

export const saveNewKey = (k: CustomKey) => update((l) => addKey(l, k));
export const changeKey = (index: number, k: CustomKey) => update((l) => editKey(l, index, k));
export const deleteKey = (index: number) => update((l) => removeKey(l, index));
export const reorderKey = (from: number, to: number) => update((l) => moveKey(l, from, to));
export const restoreDefaultKeys = () => useCustomKeys.setState({ keys: DEFAULT_CUSTOM_KEYS });
