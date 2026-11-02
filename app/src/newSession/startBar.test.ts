import { startBarAtScreenBottom, startBarBottomMargin } from "./startBar";

describe("startBarAtScreenBottom", () => {
  test("an_iphone_page_sheet_ends_at_the_screen_bottom", () => {
    expect(startBarAtScreenBottom("ios", false)).toBe(true);
  });
  test("an_ipad_page_sheet_uses_the_measured_frame", () => {
    expect(startBarAtScreenBottom("ios", true)).toBe(false);
  });
  test("android_uses_the_measured_frame", () => {
    expect(startBarAtScreenBottom("android", false)).toBe(false);
  });
});

describe("startBarBottomMargin", () => {
  test("with_the_keyboard_down_the_bar_stays_above_the_home_indicator", () => {
    expect(startBarBottomMargin(34, false, 8)).toBe(34);
  });
  test("with_no_home_indicator_the_bar_keeps_the_small_gap", () => {
    expect(startBarBottomMargin(0, false, 8)).toBe(8);
  });
  test("with_the_keyboard_up_the_inset_is_not_counted_again", () => {
    expect(startBarBottomMargin(34, true, 8)).toBe(8);
  });
});
