import { encode, modReducer, NO_MOD, padStep, pageCount, pageOf, PAD_STEP, type ModState } from "./keyRules";

const ctrl: ModState = { mod: "ctrl", locked: false };
const alt: ModState = { mod: "alt", locked: false };

describe("modReducer", () => {
  test("tap_arms_and_a_second_tap_turns_off", () => {
    expect(modReducer(NO_MOD, { type: "tap", mod: "ctrl" })).toEqual(ctrl);
    expect(modReducer(ctrl, { type: "tap", mod: "ctrl" })).toEqual(NO_MOD);
    expect(modReducer(ctrl, { type: "tap", mod: "alt" })).toEqual(alt);
  });
  test("hold_locks_until_the_next_tap", () => {
    const locked = modReducer(NO_MOD, { type: "hold", mod: "alt" });
    expect(locked).toEqual({ mod: "alt", locked: true });
    expect(modReducer(locked, { type: "used" })).toBe(locked);
    expect(modReducer(locked, { type: "tap", mod: "alt" })).toEqual(NO_MOD);
  });
  test("used_turns_a_one_shot_off_and_ignores_no_mod", () => {
    expect(modReducer(ctrl, { type: "used" })).toEqual(NO_MOD);
    expect(modReducer(NO_MOD, { type: "used" })).toBe(NO_MOD);
  });
});

describe("encode", () => {
  test("no_mod_sends_as_is", () => {
    expect(encode(NO_MOD, { kind: "key", key: "tab" })).toEqual({ op: { keys: ["tab"] }, state: NO_MOD });
    expect(encode(NO_MOD, { kind: "char", ch: "x" }).op).toEqual({ text: "x" });
  });
  test("ctrl_with_letters_keys_and_symbols", () => {
    expect(encode(ctrl, { kind: "char", ch: "c" })).toEqual({ op: { keys: ["ctrl+c"] }, state: NO_MOD });
    // A capital letter from the keyboard is the same Ctrl key.
    expect(encode(ctrl, { kind: "char", ch: "D" }).op).toEqual({ keys: ["ctrl+d"] });
    // A symbol has no Ctrl key here: it goes as plain text, and Ctrl turns off.
    expect(encode(ctrl, { kind: "char", ch: "%" })).toEqual({ op: { text: "%" }, state: NO_MOD });
    expect(encode(ctrl, { kind: "key", key: "left" }).op).toEqual({ keys: ["ctrl+left"] });
  });
  test("alt_sends_escape_first", () => {
    expect(encode(alt, { kind: "char", ch: "b" })).toEqual({ op: { text: "\x1bb" }, state: NO_MOD });
    expect(encode(alt, { kind: "key", key: "left" }).op).toEqual({ keys: ["esc", "left"] });
  });
  test("a_locked_mod_stays_and_a_macro_ignores_it", () => {
    const locked: ModState = { mod: "ctrl", locked: true };
    expect(encode(locked, { kind: "char", ch: "a" }).state).toBe(locked);
    expect(encode(ctrl, { kind: "text", text: "yes", enter: true })).toEqual({ op: { text: "yes", keys: ["enter"] }, state: NO_MOD });
    expect(encode(NO_MOD, { kind: "text", text: "1", enter: false }).op).toEqual({ text: "1" });
  });
});

describe("padStep", () => {
  test("one_key_per_step_on_the_larger_axis", () => {
    const r = padStep({ x: 0, y: 0 }, PAD_STEP * 2 + 5, 3);
    expect(r.keys).toEqual(["right", "right"]);
    expect(r.acc).toEqual({ x: 5, y: 0 });
    expect(padStep({ x: 0, y: 0 }, 2, -PAD_STEP).keys).toEqual(["up"]);
    expect(padStep({ x: 0, y: 10 }, 0, 10).keys).toEqual(["down"]);
  });
  test("small_moves_add_up", () => {
    let acc = { x: 0, y: 0 };
    const keys: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = padStep(acc, -5, 0);
      acc = r.acc;
      keys.push(...r.keys);
    }
    expect(keys).toEqual(["left"]);
    expect(acc.x).toBe(-2);
  });
});

test("pages_of_the_bar", () => {
  expect(pageCount(300, 320)).toBe(1);
  expect(pageCount(650, 320)).toBe(3);
  expect(pageCount(640, 320)).toBe(2);
  expect(pageCount(100, 0)).toBe(1);
  expect(pageOf(330, 320)).toBe(1);
  expect(pageOf(0, 0)).toBe(0);
});
