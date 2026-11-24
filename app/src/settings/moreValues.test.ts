import { countValue, notifValue } from "./moreValues";

test("the_notifications_value_names_the_push_kinds_that_are_on", () => {
  expect(notifValue({ finished: true, needs_you: true })).toBe("On");
  expect(notifValue({ finished: false, needs_you: true })).toBe("Needs you only");
  expect(notifValue({ finished: true, needs_you: false })).toBe("Finished only");
  expect(notifValue({ finished: false, needs_you: false })).toBe("Off");
});

test("a_count_value_is_a_whole_number_of_zero_or_more", () => {
  expect(countValue(3)).toBe("3");
  expect(countValue(-1)).toBe("0");
  expect(countValue(2.7)).toBe("2");
});
