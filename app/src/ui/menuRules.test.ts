import { sheet } from "@/theme/tokens";

import {
  arrangeSections,
  filterSections,
  itemMatches,
  PICKER_SEARCH_MIN,
  pickerSearches,
  pickerSections,
  planActionSheet,
  sheetLift,
  sheetMaxHeight,
  swipeCloses,
} from "./menuRules";

const item = (label: string, destructive = false) => ({ label, destructive });

test("arrange_moves_destructive_rows_to_one_last_section_in_their_order", () => {
  const out = arrangeSections([
    { title: "This session", items: [item("Rename"), item("Restart", true)] },
    { items: [] },
    { title: "Work", items: [item("Close", true), item("Changes")] },
  ]);
  expect(out).toEqual([
    { title: "This session", items: [item("Rename")] },
    { title: "Work", items: [item("Changes")] },
    { title: undefined, items: [item("Restart", true), item("Close", true)] },
  ]);
});

test("arrange_keeps_the_title_of_an_all_destructive_section", () => {
  const out = arrangeSections([{ title: "Danger", items: [item("Close", true)] }, { items: [item("Rename")] }]);
  expect(out).toEqual([{ items: [item("Rename")], title: undefined }, { title: "Danger", items: [item("Close", true)] }]);
  expect(arrangeSections([{ items: [] }])).toEqual([]);
});

test("plan_drops_the_cancel_row_and_maps_the_header", () => {
  const p = planActionSheet({ title: "api", message: "Pick one", options: ["Restart", "Reply", "Cancel"], cancelButtonIndex: 2, destructiveButtonIndex: 0 });
  expect(p.title).toBe("api");
  expect(p.detail).toBe("Pick one");
  expect(p.cancelIndex).toBe(2);
  expect(p.sections).toEqual([{ items: [{ index: 1, label: "Reply", destructive: false }] }, { items: [{ index: 0, label: "Restart", destructive: true }] }]);
});

test("plan_without_cancel_reports_minus_one_and_ignores_bad_destructive_indexes", () => {
  const p = planActionSheet({ title: "", options: ["A", "B"], destructiveButtonIndex: [-1, 7] });
  expect(p.cancelIndex).toBe(-1);
  expect(p.title).toBeUndefined();
  expect(p.sections).toEqual([{ items: [{ index: 0, label: "A", destructive: false }, { index: 1, label: "B", destructive: false }] }]);
  // A cancel index out of range keeps every option as a row.
  expect(planActionSheet({ options: ["A"], cancelButtonIndex: 4 }).sections[0].items).toHaveLength(1);
});

test("search_matches_every_word_in_label_detail_value_and_keywords", () => {
  const row = { label: "Café api", detail: "~/dev/apps", keywords: "/home/sam/dev/apps/api" };
  expect(itemMatches(row, "")).toBe(true);
  expect(itemMatches(row, "cafe")).toBe(true);
  expect(itemMatches(row, "API  sam")).toBe(true);
  expect(itemMatches(row, "web")).toBe(false);
  const sections = [
    { title: "studio.local", items: [{ label: "api" }, { label: "web" }] },
    { title: "laptop", items: [{ label: "docs" }] },
  ];
  expect(filterSections(sections, "we")).toEqual([{ title: "studio.local", items: [{ label: "web" }] }]);
  expect(filterSections(sections, "  ")).toEqual(sections);
  expect(filterSections(sections, "zzz")).toEqual([]);
});

test("picker_checks_the_current_value_and_skips_a_pick_of_it", () => {
  const onPick = jest.fn();
  const [s] = pickerSections([{ options: [{ value: "a", label: "A" }, { value: "b", label: "B", detail: "two" }] }], "a", onPick);
  expect(s.items.map((i) => i.checked)).toEqual([true, false]);
  expect(s.items[1].detail).toBe("two");
  s.items[0].onPick();
  expect(onPick).not.toHaveBeenCalled();
  s.items[1].onPick();
  expect(onPick).toHaveBeenCalledWith("b");
});

test("picker_danger_option_keeps_its_place_with_the_danger_tone", () => {
  const options = [
    { value: "ask", label: "Ask" },
    { value: "skip", label: "Skip permissions", danger: true },
    { value: "plan", label: "Plan" },
  ];
  const [s] = pickerSections([{ options }], "ask", () => {});
  expect(s.items.map((i) => i.label)).toEqual(["Ask", "Skip permissions", "Plan"]);
  expect(s.items.map((i) => !!i.danger)).toEqual([false, true, false]);
  // A danger tone is not a destructive action: the section order rule leaves it in place.
  expect(arrangeSections([s])[0].items.map((i) => i.label)).toEqual(["Ask", "Skip permissions", "Plan"]);
});

test("picker_search_shows_from_the_threshold_unless_forced", () => {
  expect(pickerSearches(PICKER_SEARCH_MIN - 1, undefined)).toBe(false);
  expect(pickerSearches(PICKER_SEARCH_MIN, undefined)).toBe(true);
  expect(pickerSearches(3, true)).toBe(true);
  expect(pickerSearches(50, false)).toBe(false);
});

test("lift_is_the_keyboard_part_of_a_full_window_and_zero_for_a_shrunk_window", () => {
  expect(sheetLift(800, 0, 800)).toBe(0);
  expect(sheetLift(800, 300, 800)).toBe(300);
  // Android window already made shorter for the keyboard.
  expect(sheetLift(500, 300, 800)).toBe(0);
  expect(sheetLift(0, 300, 800)).toBe(0);
});

test("max_height_is_the_ratio_of_the_window_and_stays_below_the_status_bar", () => {
  expect(sheetMaxHeight({ rootHeight: 800, lift: 0, topInset: 50 })).toBe(Math.floor(800 * sheet.maxHeightRatio));
  // With the keyboard up the free space above it is the limit.
  expect(sheetMaxHeight({ rootHeight: 800, lift: 400, topInset: 50 })).toBe(800 - 400 - 50 - sheet.topGap);
  expect(sheetMaxHeight({ rootHeight: 100, lift: 400, topInset: 50 })).toBe(0);
});

test("swipe_closes_past_the_ratio_or_on_a_fling", () => {
  expect(swipeCloses(10, 0, 400)).toBe(false);
  expect(swipeCloses(400 * sheet.closeRatio + 1, 0, 400)).toBe(true);
  expect(swipeCloses(5, sheet.flingVelocity + 1, 400)).toBe(true);
  // A fling back up keeps the sheet.
  expect(swipeCloses(300, -sheet.flingVelocity - 1, 400)).toBe(false);
  expect(swipeCloses(300, 0, 0)).toBe(false);
});
