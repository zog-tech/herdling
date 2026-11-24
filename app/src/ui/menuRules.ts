import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";

import { sheet } from "@/theme/tokens";

/**
 * The rules of the menu sheet (`ui/MenuSheet`) and the picker sheet (`ui/PickerSheet`), with no
 * React and no I/O: the section order, the mapping from `showActionSheet` options, the search
 * filter, the picker rows and the sheet geometry. `menuRules.test.ts` tests them.
 */

/** One row of a menu. */
export type MenuItem = {
  /** The row text (`body`). It wraps at a large text size. */
  label: string;
  /** A lucide icon at the left (20 pt, `textMuted`; `danger` for a destructive row). */
  Icon?: LucideIcon;
  /** Free content at the left in place of `Icon`, for example an agent mark or a group tile. */
  leading?: ReactNode;
  /** One line under the label in `textMuted`. */
  detail?: string;
  /** A value at the right (`callout`, `textMuted`), for example the current model. */
  value?: string;
  /** A check at the right: the current choice (the selected state, in the accent). */
  checked?: boolean;
  /** A destructive action: `danger` icon and label. The sheet moves it to the last section. */
  destructive?: boolean;
  /**
   * The `danger` tone only: `danger` icon and label, but the row keeps its place. For a choice
   * that is risky but not an action, for example a picker option "Skip permissions".
   */
  danger?: boolean;
  /** Shown dimmed; a tap does nothing. */
  disabled?: boolean;
  /** More words that the search field matches, for example a full path. */
  keywords?: string;
  accessibilityHint?: string;
  /** Runs after the sheet is gone, so the action can open a screen or another sheet. */
  onPick: () => void;
};

/** A group of rows with an optional small uppercase title. */
export type MenuSection = { title?: string; items: MenuItem[] };

/** What `showMenu` shows. */
export type MenuSpec = {
  /** The header title (`headline`). */
  title?: string;
  /** One line of detail under the title. */
  detail?: string;
  sections: MenuSection[];
  /** A search field above the rows. It filters the rows by label, detail, value and keywords. */
  search?: { placeholder?: string };
  /** `haptics.press()` when the sheet opens. Default true. */
  haptic?: boolean;
  /** Runs when the sheet closes with no pick (tap outside, swipe, close button, back, escape). */
  onClose?: () => void;
  /** VoiceOver name of the sheet when it has no title. Default "Menu". */
  accessibilityLabel?: string;
};

type Sectioned<T> = { title?: string; items: T[] };

/**
 * The sections as the sheet shows them. Empty sections go away. Destructive rows leave their
 * section and form one last section, in their order. That section takes the title of the first
 * section that has only destructive rows.
 */
export function arrangeSections<T extends { destructive?: boolean }>(sections: readonly Sectioned<T>[]): Sectioned<T>[] {
  const kept: Sectioned<T>[] = [];
  const danger: T[] = [];
  let dangerTitle: string | undefined;
  for (const s of sections) {
    const safe = s.items.filter((i) => !i.destructive);
    const bad = s.items.filter((i) => i.destructive);
    if (bad.length > 0 && safe.length === 0 && dangerTitle === undefined) dangerTitle = s.title;
    danger.push(...bad);
    if (safe.length > 0) kept.push({ title: s.title, items: safe });
  }
  if (danger.length > 0) kept.push({ title: dangerTitle, items: danger });
  return kept;
}

/** The options of `showActionSheet` (the `ActionSheetIOS` shape that the app uses). */
export type SheetOptions = {
  title?: string;
  message?: string;
  options: string[];
  cancelButtonIndex?: number;
  destructiveButtonIndex?: number | number[];
};

/** The indexes a sheet shows in red. Negative and out-of-range indexes do not count. */
export function destructiveSet(o: SheetOptions): Set<number> {
  const d = o.destructiveButtonIndex;
  const list = d === undefined ? [] : Array.isArray(d) ? d : [d];
  return new Set(list.filter((i) => Number.isInteger(i) && i >= 0 && i < o.options.length));
}

/** One row of a `showActionSheet` menu: the option index that `onPick` gets. */
export type SheetRow = { index: number; label: string; destructive: boolean };

/** How a `showActionSheet` call shows in the menu sheet. */
export type SheetPlan = {
  title?: string;
  detail?: string;
  sections: { items: SheetRow[] }[];
  /** The index a close without a pick reports: `cancelButtonIndex`, or -1 without one. */
  cancelIndex: number;
};

/**
 * Maps `showActionSheet` options to the menu sheet: the title and the message become the header,
 * the cancel option is not a row (the sheet closes with a tap outside, a swipe or its close
 * button), and the destructive options go to a last section.
 */
export function planActionSheet(o: SheetOptions): SheetPlan {
  const cancelIndex = o.cancelButtonIndex ?? -1;
  const red = destructiveSet(o);
  const rows: SheetRow[] = o.options.flatMap((label, index) => (index === cancelIndex ? [] : [{ index, label, destructive: red.has(index) }]));
  const sections = arrangeSections([{ items: rows }]).map((s) => ({ items: s.items }));
  return { title: o.title || undefined, detail: o.message || undefined, sections, cancelIndex };
}

/** Lower case, no accents, single spaces: the form the search compares. */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** True when the row matches every word of the query in its label, detail, value or keywords. */
export function itemMatches(item: Pick<MenuItem, "label" | "detail" | "value" | "keywords">, query: string): boolean {
  const words = fold(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold([item.label, item.detail, item.value, item.keywords].filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
}

/** The sections with only the rows that match the query. Sections with no match go away. */
export function filterSections<T extends Pick<MenuItem, "label" | "detail" | "value" | "keywords">>(
  sections: readonly Sectioned<T>[],
  query: string,
): Sectioned<T>[] {
  if (!fold(query)) return [...sections];
  return sections.map((s) => ({ title: s.title, items: s.items.filter((i) => itemMatches(i, query)) })).filter((s) => s.items.length > 0);
}

/** A picker shows a search field from this many options, unless the caller says otherwise. */
export const PICKER_SEARCH_MIN = 10;

/** One choice of a picker. */
export type PickerOption<T> = {
  value: T;
  label: string;
  detail?: string;
  /** Free content at the left, for example an agent mark or a group tile. */
  leading?: ReactNode;
  Icon?: LucideIcon;
  disabled?: boolean;
  /** A risky choice: the `danger` tone for its icon and label. The option keeps its place. */
  danger?: boolean;
  /** More words that the search matches. */
  keywords?: string;
};

export type PickerSection<T> = { title?: string; options: PickerOption<T>[] };

/** True when the picker shows its search field. `search` undefined: from `PICKER_SEARCH_MIN` options. */
export function pickerSearches(count: number, search: boolean | undefined): boolean {
  return search ?? count >= PICKER_SEARCH_MIN;
}

/**
 * The menu sections of a picker: the current value has the check. A pick of the current value only
 * closes the sheet; a pick of another value calls `onPick` with it.
 */
export function pickerSections<T>(sections: readonly PickerSection<T>[], value: T | undefined, onPick: (v: T) => void): MenuSection[] {
  return sections.map((s) => ({
    title: s.title,
    items: s.options.map((o) => ({
      label: o.label,
      detail: o.detail,
      leading: o.leading,
      Icon: o.Icon,
      disabled: o.disabled,
      danger: o.danger,
      keywords: o.keywords,
      checked: Object.is(o.value, value),
      onPick: () => {
        if (!Object.is(o.value, value)) onPick(o.value);
      },
    })),
  }));
}

/**
 * How far the sheet must rise so that the keyboard does not cover it. `rootHeight` is the height
 * of the full-screen sheet window. When the system already made the window shorter for the
 * keyboard (some Android windows), the result is 0.
 */
export function sheetLift(rootHeight: number, keyboardHeight: number, windowHeight: number): number {
  if (!(keyboardHeight > 0) || !(rootHeight > 0)) return 0;
  return Math.max(0, Math.round(rootHeight - (windowHeight - keyboardHeight)));
}

/**
 * The tallest the sheet can be: `sheet.maxHeightRatio` of the window, and never closer to the top
 * than `sheet.topGap` below the status bar, above the keyboard.
 */
export function sheetMaxHeight({ rootHeight, lift, topInset }: { rootHeight: number; lift: number; topInset: number }): number {
  return Math.max(0, Math.floor(Math.min(rootHeight * sheet.maxHeightRatio, rootHeight - lift - topInset - sheet.topGap)));
}

/**
 * True when a swipe down that ends here closes the sheet: far enough, or fast enough. A worklet:
 * the gesture calls it on the UI thread.
 */
export function swipeCloses(translationY: number, velocityY: number, sheetHeight: number): boolean {
  "worklet";
  if (velocityY > sheet.flingVelocity) return true;
  if (velocityY < -sheet.flingVelocity) return false;
  return sheetHeight > 0 && translationY > sheetHeight * sheet.closeRatio;
}
