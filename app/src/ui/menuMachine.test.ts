import { initialMenuState, menuReducer, type MenuState } from "./menuMachine";
import type { MenuItem, MenuSpec } from "./menuRules";

const row = (label: string, extra: Partial<MenuItem> = {}): MenuItem => ({ label, onPick: jest.fn(), ...extra });
const menu = (extra: Partial<MenuSpec> = {}): MenuSpec => ({ sections: [{ items: [row("A")] }], onClose: jest.fn(), ...extra });

const open = (m = menu()): MenuState => menuReducer(initialMenuState, { type: "show", menu: m }).state;

test("show_opens_with_a_new_generation_and_the_press_haptic", () => {
  const r = menuReducer(initialMenuState, { type: "show", menu: menu() });
  expect(r.state).toMatchObject({ kind: "open", gen: 1 });
  expect(r.effects).toEqual([{ kind: "haptic", feel: "press" }]);
  expect(menuReducer(initialMenuState, { type: "show", menu: menu({ haptic: false }) }).effects).toEqual([]);
});

test("show_over_an_open_menu_cancels_the_old_one", () => {
  const first = menu();
  const r = menuReducer(open(first), { type: "show", menu: menu({ haptic: false }) });
  expect(r.state).toMatchObject({ kind: "open", gen: 2 });
  expect(r.effects).toEqual([{ kind: "run", outcome: { kind: "cancel" }, menu: first }]);
});

test("pick_leaves_with_the_tap_haptic_and_runs_after_exit_and_dismiss", () => {
  const m = menu();
  const item = m.sections[0].items[0];
  let r = menuReducer(open(m), { type: "pick", item });
  expect(r.state).toMatchObject({ kind: "leaving", byGesture: false, outcome: { kind: "pick", item } });
  expect(r.effects).toEqual([{ kind: "haptic", feel: "tap" }]);
  r = menuReducer(r.state, { type: "exitDone", gen: 1 });
  expect(r.state.kind).toBe("hiding");
  expect(r.effects).toEqual([]);
  r = menuReducer(r.state, { type: "dismissed", gen: 1 });
  expect(r.state).toEqual({ kind: "closed", gen: 1 });
  expect(r.effects).toEqual([{ kind: "run", outcome: { kind: "pick", item }, menu: m }]);
});

test("a_disabled_row_does_not_pick", () => {
  const s = open();
  expect(menuReducer(s, { type: "pick", item: row("Off", { disabled: true }) }).state).toBe(s);
});

test("cancel_and_swipe_leave_with_a_cancel_outcome", () => {
  expect(menuReducer(open(), { type: "cancel" }).state).toMatchObject({ kind: "leaving", byGesture: false, outcome: { kind: "cancel" } });
  expect(menuReducer(open(), { type: "swiped" }).state).toMatchObject({ kind: "leaving", byGesture: true, outcome: { kind: "cancel" } });
});

test("old_generations_and_events_in_the_wrong_state_do_nothing", () => {
  const leaving = menuReducer(open(), { type: "cancel" }).state;
  expect(menuReducer(leaving, { type: "exitDone", gen: 99 }).state).toBe(leaving);
  expect(menuReducer(leaving, { type: "dismissed", gen: 1 }).state).toBe(leaving);
  expect(menuReducer(leaving, { type: "pick", item: row("B") }).state).toBe(leaving);
  expect(menuReducer(leaving, { type: "cancel" }).state).toBe(leaving);
  expect(menuReducer(initialMenuState, { type: "cancel" }).state).toBe(initialMenuState);
  expect(menuReducer(initialMenuState, { type: "exitDone", gen: 0 }).state).toBe(initialMenuState);
  const hiding = menuReducer(leaving, { type: "exitDone", gen: 1 }).state;
  expect(menuReducer(hiding, { type: "dismissed", gen: 0 }).state).toBe(hiding);
});

test("show_while_a_menu_leaves_still_runs_its_outcome", () => {
  const m = menu();
  const item = m.sections[0].items[0];
  const leaving = menuReducer(open(m), { type: "pick", item }).state;
  const r = menuReducer(leaving, { type: "show", menu: menu({ haptic: false }) });
  expect(r.state).toMatchObject({ kind: "open", gen: 2 });
  expect(r.effects).toEqual([{ kind: "run", outcome: { kind: "pick", item }, menu: m }]);
});
