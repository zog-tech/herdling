import {
  confirmedCount,
  endEpoch,
  expire,
  GLITCH_MS,
  GOOD_TO_RESUME,
  initialPrediction,
  onBackspace,
  onScreen,
  onSrtt,
  onType,
  visiblePrediction,
  type Prediction,
} from "./predict";

/** Prediction on a slow link, with the prompt "$ " on screen. */
const slow = (): Prediction => onScreen(onSrtt(initialPrediction, 150), "$ ", 0);

test("srtt_hysteresis_for_showing_and_underlining", () => {
  let p = onSrtt(initialPrediction, 25);
  expect([p.shown, p.flagged]).toEqual([false, false]);
  p = onSrtt(p, 31);
  expect([p.shown, p.flagged]).toEqual([true, false]);
  p = onSrtt(p, 25);
  expect(p.shown).toBe(true);
  p = onSrtt(p, 19);
  expect(p.shown).toBe(false);
  p = onSrtt(p, 81);
  expect([p.shown, p.flagged]).toEqual([true, true]);
  p = onSrtt(p, 60);
  expect(p.flagged).toBe(true);
  p = onSrtt(p, 49);
  expect(p.flagged).toBe(false);
  expect(onSrtt(p, undefined)).toBe(p);
});

test("typed_keys_append_and_show_until_confirmed", () => {
  let p = onType(slow(), "ls", 10);
  expect(visiblePrediction(p)).toEqual({ text: "ls", underline: true });
  p = onScreen(p, "$ l", 50);
  expect(visiblePrediction(p).text).toBe("s");
  p = onScreen(p, "$ ls", 60);
  expect(visiblePrediction(p).text).toBe("");
});

test("fast_link_shows_nothing", () => {
  const p = onType(onScreen(onSrtt(initialPrediction, 10), "$ ", 0), "ls", 0);
  expect(visiblePrediction(p).text).toBe("");
});

test("a_screen_with_the_same_line_as_the_epoch_start_confirms_nothing", () => {
  // The prompt already ends with "a": typing "a" is not confirmed until the line changes.
  let p = onType(onScreen(onSrtt(initialPrediction, 150), "~/a", 0), "a", 10);
  p = onScreen(p, "~/a", 20);
  expect(visiblePrediction(p).text).toBe("a");
});

test("backspace_removes_the_last_prediction_or_ends_the_epoch", () => {
  let p = onBackspace(onType(slow(), "lx", 0));
  expect(visiblePrediction(p).text).toBe("l");
  p = onScreen(p, "$ l", 10);
  // Nothing predicted is left: the screen is the truth again.
  p = onBackspace(p);
  expect(p.typed).toBe("");
});

test("epoch_end_clears_all_predictions", () => {
  const p = endEpoch(onType(slow(), "git st", 0));
  expect(visiblePrediction(p).text).toBe("");
  expect(endEpoch(p)).toBe(p);
});

test("glitch_clears_and_hides_until_good_confirmations", () => {
  let p = onType(slow(), "abc", 0);
  p = expire(p, GLITCH_MS - 1);
  expect(visiblePrediction(p).text).toBe("abc");
  p = expire(p, GLITCH_MS + 1);
  expect(p.typed).toBe("");
  expect(p.glitch).toBe(GOOD_TO_RESUME);
  // Typing goes on: predictions stay hidden while the screen confirms the characters.
  p = onType(p, "0123456", 2000);
  expect(visiblePrediction(p).text).toBe("");
  p = onScreen(p, "$ 0123456", 2050);
  expect(p.glitch).toBe(GOOD_TO_RESUME - 7);
  p = onType(p, "789", 2100);
  p = onScreen(p, "$ 0123456789", 2150);
  expect(p.glitch).toBe(0);
  p = onType(p, "x", 2200);
  expect(visiblePrediction(p).text).toBe("x");
});

test("confirmed_count_reads_the_end_of_the_line", () => {
  expect(confirmedCount("$ git st", "git status")).toBe(6);
  expect(confirmedCount("$ git ", "git status")).toBe(4);
  expect(confirmedCount("$ ", "git")).toBe(0);
  expect(confirmedCount("$ ls", "")).toBe(0);
});
