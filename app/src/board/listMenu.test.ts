import { arrangeLine, listMenu, listTitle, totalCount } from "./listMenu";

const counts = { needs_you: 2, ready: 1, working: 3, background: 0, idle: 4 };

const build = (filter: Parameters<typeof listMenu>[0]["filter"] = null) => {
  const onFilter = jest.fn();
  const onGroup = jest.fn();
  const onSort = jest.fn();
  const menu = listMenu({ counts, filter, groupBy: "host", sortBy: "name", onFilter, onGroup, onSort });
  return { menu, onFilter, onGroup, onSort };
};

test("the_menu_has_show_group_and_sort_with_checks_on_the_current_values", () => {
  const { menu } = build();
  expect(menu.sections.map((s) => s.title)).toEqual(["Show", "Group by", "Sort by"]);
  const [show, group, sort] = menu.sections;
  expect(show.items.map((i) => [i.label, i.value])).toEqual([
    ["All agents", "10"],
    ["Needs you", "2"],
    ["Ready", "1"],
    ["Working", "3"],
    ["Background", "0"],
    ["Idle", "4"],
  ]);
  expect(show.items.filter((i) => i.checked).map((i) => i.label)).toEqual(["All agents"]);
  expect(group.items.filter((i) => i.checked).map((i) => i.label)).toEqual(["Computer"]);
  expect(sort.items.filter((i) => i.checked).map((i) => i.label)).toEqual(["Name"]);
  // No destructive rows and no chips: only checks.
  expect(menu.sections.flatMap((s) => s.items).some((i) => i.destructive)).toBe(false);
});

test("a_filter_checks_its_row_and_picks_send_the_new_values", () => {
  const { menu, onFilter, onGroup, onSort } = build("working");
  const [show, group, sort] = menu.sections;
  expect(show.items.filter((i) => i.checked).map((i) => i.label)).toEqual(["Working"]);
  show.items.find((i) => i.label === "All agents")!.onPick();
  expect(onFilter).toHaveBeenLastCalledWith(null);
  show.items.find((i) => i.label === "Needs you")!.onPick();
  expect(onFilter).toHaveBeenLastCalledWith("needs_you");
  group.items.find((i) => i.label === "None")!.onPick();
  expect(onGroup).toHaveBeenLastCalledWith("none");
  sort.items.find((i) => i.label === "Recent activity")!.onPick();
  expect(onSort).toHaveBeenLastCalledWith("recent");
});

test("the_list_title_names_the_filter_and_its_count", () => {
  expect(totalCount(counts)).toBe(10);
  expect(listTitle(counts, null)).toEqual({ title: "All agents", count: 10 });
  expect(listTitle(counts, "needs_you")).toEqual({ title: "Needs you", count: 2 });
});

test("the_arrange_line_says_the_group_and_the_sort_in_words", () => {
  expect(arrangeLine("status", "status")).toBe("Grouped by status · Sorted by status");
  expect(arrangeLine("host", "longest")).toBe("Grouped by computer · Sorted by running longest");
  expect(arrangeLine("none", "name")).toBe("Not grouped · Sorted by name");
});

test("the_menu_ends_with_jump_to_a_terminal_when_asked", () => {
  const onJump = jest.fn();
  const plain = listMenu({ counts, filter: null, groupBy: "host", sortBy: "name", onFilter: jest.fn(), onGroup: jest.fn(), onSort: jest.fn() });
  expect(plain.sections).toHaveLength(3);
  const menu = listMenu({ counts, filter: null, groupBy: "host", sortBy: "name", onFilter: jest.fn(), onGroup: jest.fn(), onSort: jest.fn(), onJump });
  const last = menu.sections.at(-1)!;
  expect(last.items.map((i) => i.label)).toEqual(["Jump to a terminal"]);
  last.items[0].onPick();
  expect(onJump).toHaveBeenCalledTimes(1);
});
