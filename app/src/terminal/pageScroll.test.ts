import { fullScreenApp, overflows, PAGE_TEXT, paneScroll } from "./pageScroll";

test("page_text_is_vt220_page_keys", () => {
  expect(PAGE_TEXT.up).toBe("\x1b[5~");
  expect(PAGE_TEXT.down).toBe("\x1b[6~");
});

test("overflows_needs_both_heights", () => {
  expect(overflows(undefined, 500)).toBeUndefined();
  expect(overflows(800, undefined)).toBeUndefined();
  expect(overflows(800, 0)).toBeUndefined();
});

test("overflows_compares_heights_with_slack", () => {
  expect(overflows(800, 500)).toBe(true);
  expect(overflows(400, 500)).toBe(false);
  expect(overflows(500.5, 500)).toBe(false);
  expect(overflows(502, 500)).toBe(true);
});

test("pane_scroll_reads_the_pane_get_result", () => {
  expect(
    paneScroll({ pane: { pane_id: "w1:p1", scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 40 } } }),
  ).toEqual({ max_offset_from_bottom: 0, viewport_rows: 40 });
  expect(paneScroll({ type: "ok" })).toBeUndefined();
  expect(paneScroll({ pane: { scroll: { viewport_rows: "40" } } })).toBeUndefined();
  expect(paneScroll(null)).toBeUndefined();
});

test("full_screen_app_fills_the_screen_with_no_scrollback", () => {
  // less or Claude Code on the alternate screen: no scrollback, 40 of 40 rows.
  expect(fullScreenApp({ max_offset_from_bottom: 0, viewport_rows: 40 }, 40)).toBe(true);
  // A new shell: no scrollback, but one line.
  expect(fullScreenApp({ max_offset_from_bottom: 0, viewport_rows: 40 }, 1)).toBe(false);
  // A shell with scrollback.
  expect(fullScreenApp({ max_offset_from_bottom: 62, viewport_rows: 40 }, 102)).toBe(false);
  // An older herdr with no scroll field, or a strange size.
  expect(fullScreenApp(undefined, 40)).toBe(false);
  expect(fullScreenApp({ max_offset_from_bottom: 0, viewport_rows: 0 }, 0)).toBe(false);
});
