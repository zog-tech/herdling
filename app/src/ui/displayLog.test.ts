import { DISPLAY_LOG_MAX, displayLogText, keyboardLine, logDisplay, useDisplayLog } from "./displayLog";

beforeEach(() => useDisplayLog.getState().clear());

test("the_log_keeps_the_last_events_only", () => {
  for (let i = 0; i < DISPLAY_LOG_MAX + 5; i++) logDisplay(`e${i}`, i * 1000);
  const events = useDisplayLog.getState().events;
  expect(events).toHaveLength(DISPLAY_LOG_MAX);
  expect(events[0].text).toBe("e5");
});

test("the_text_is_newest_first", () => {
  logDisplay("first", new Date(2026, 0, 1, 9, 0, 1).getTime());
  logDisplay("second", new Date(2026, 0, 1, 9, 0, 2).getTime());
  expect(displayLogText()).toBe("09:00:02 second\n09:00:01 first");
});

test("a_keyboard_line_has_each_value_and_a_question_mark_for_a_missing_one", () => {
  expect(
    keyboardLine({
      event: "keyboardDidShow",
      screenY: 0,
      height: 0,
      window: { width: 402, height: 874 },
      screen: { width: 402, height: 874 },
      top: 367.25,
      note: "empty frame, estimated height",
    }),
  ).toBe("kb keyboardDidShow y=0 h=0 win=402x874 scr=402x874 view=?+? top=367.3 pad=? empty frame, estimated height");
});
