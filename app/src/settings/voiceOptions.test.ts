import { clampRate, SYSTEM_VOICE, voiceOptions, voiceValue } from "./voiceOptions";

const flo = { identifier: "flo-gb", name: "Flo", language: "en-GB", quality: "Enhanced" };
const sam = { identifier: "sam-us", name: "Sam", language: "en-US", quality: "Default" };

test("the_picker_lists_system_default_first_then_the_voices_with_accent_and_quality", () => {
  const opts = voiceOptions([flo, sam]);
  expect(opts.map((o) => o.value)).toEqual([SYSTEM_VOICE, "flo-gb", "sam-us"]);
  expect(opts[0].label).toBe("System default");
  expect(opts[1]).toMatchObject({ label: "Flo · UK", detail: "Enhanced" });
  expect(opts[2].detail).toBeUndefined();
  // The search matches the accent in words, as the old VoiceOver label said it.
  expect(opts[1].keywords).toContain("UK English");
});

test("the_row_value_is_the_stored_voice_or_system_default", () => {
  expect(voiceValue([flo, sam], "sam-us")).toBe("Sam · US");
  expect(voiceValue([flo, sam], undefined)).toBe("System default");
  // A stored voice that the device does not list (yet) shows the default, as before.
  expect(voiceValue([], "gone")).toBe("System default");
});

test("the_speed_stays_in_range_and_on_a_step", () => {
  expect(clampRate(1.0 + 0.1)).toBe(1.1);
  expect(clampRate(0.4)).toBe(0.5);
  expect(clampRate(2.1)).toBe(2);
  expect(clampRate(0.30000000000000004 + 0.9)).toBe(1.2);
});
