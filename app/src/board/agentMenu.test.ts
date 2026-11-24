import { agentMenu } from "./agentMenu";

const noop = () => {};

test("the_full_menu_has_open_change_help_and_restart_last", () => {
  const menu = agentMenu({
    title: "api",
    detail: "studio.local · claude",
    reply: noop,
    peek: noop,
    openSpace: noop,
    markRead: noop,
    renames: [{ label: "Rename session", onPick: noop }],
    move: noop,
    explain: noop,
    restart: noop,
  });
  expect(menu.title).toBe("api");
  expect(menu.detail).toBe("studio.local · claude");
  expect(menu.sections.map((s) => s.items.map((i) => i.label))).toEqual([
    ["Reply", "Peek", "Open space"],
    ["Mark read", "Rename session", "Move to space…"],
    ["Why this status?"],
    ["Restart"],
  ]);
  // Every row has an icon; only Restart is destructive.
  const rows = menu.sections.flatMap((s) => s.items);
  expect(rows.every((r) => r.Icon !== undefined)).toBe(true);
  expect(rows.filter((r) => r.destructive).map((r) => r.label)).toEqual(["Restart"]);
});

test("a_missing_handler_hides_its_row_and_an_empty_section_goes_away", () => {
  const menu = agentMenu({ title: "api", openSpace: noop });
  expect(menu.sections.map((s) => s.items.map((i) => i.label))).toEqual([["Open space"]]);
});

test("a_pick_runs_its_handler", () => {
  const restart = jest.fn();
  const menu = agentMenu({ title: "api", restart });
  menu.sections[0].items[0].onPick();
  expect(restart).toHaveBeenCalledTimes(1);
});
