import { showMenu } from "./MenuSheet";
import { pickerSearches, pickerSections, type PickerOption, type PickerSection } from "./menuRules";

/**
 * The picker sheet: the menu sheet (`ui/MenuSheet`) with one check on the current value (design
 * rule 2). Use it to choose one of a list that can grow: a computer, a space, a tab, a folder, an
 * agent, a model, a voice. A screen needs no open state: call `showPicker` from a tap.
 *
 * ```tsx
 * showPicker({
 *   title: "Agent",
 *   options: agents.map((a) => ({ value: a.id, label: a.name, leading: <AgentMark kind={a.id} /> })),
 *   value: agent,
 *   onPick: setAgent,
 * });
 * ```
 *
 * - `options` for one list, or `sections` for titled groups (for example spaces per computer).
 * - Each option can have `detail` (one muted line), `leading` (an agent mark, a group tile) or `Icon`.
 * - A search field shows from `PICKER_SEARCH_MIN` (10) options; `search: true` or `false` forces it.
 *   It matches the label, the detail and `keywords`.
 * - A pick of another value calls `onPick(value)` after the sheet is gone. A pick of the current
 *   value only closes the sheet. A close with no pick calls `onClose`.
 *
 * `ui/PickerRow` is the row that shows the current value and opens this sheet.
 */

export type { PickerOption, PickerSection } from "./menuRules";

export type PickerOptions<T> = {
  title: string;
  /** One line of detail under the title. */
  detail?: string;
  /** One list of options. Give this or `sections`. */
  options?: PickerOption<T>[];
  /** Titled groups of options. */
  sections?: PickerSection<T>[];
  /** The current value: its row has the check. */
  value?: T;
  onPick: (value: T) => void;
  /** Show the search field. Default: from 10 options. */
  search?: boolean;
  searchPlaceholder?: string;
  onClose?: () => void;
};

/** Opens the picker sheet. */
export function showPicker<T>({ title, detail, options, sections, value, onPick, search, searchPlaceholder, onClose }: PickerOptions<T>): void {
  const groups = sections ?? [{ options: options ?? [] }];
  const count = groups.reduce((n, s) => n + s.options.length, 0);
  showMenu({
    title,
    detail,
    sections: pickerSections(groups, value, onPick),
    search: pickerSearches(count, search) ? { placeholder: searchPlaceholder ?? `Search ${title.toLowerCase()}` } : undefined,
    onClose,
  });
}

/** The option that has `value`, if any. */
export function pickedOption<T>(groups: readonly PickerSection<T>[], value: T | undefined): PickerOption<T> | undefined {
  for (const s of groups) {
    const hit = s.options.find((o) => Object.is(o.value, value));
    if (hit) return hit;
  }
  return undefined;
}
