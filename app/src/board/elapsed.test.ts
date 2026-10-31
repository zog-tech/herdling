import { formatElapsed, pillText } from "./elapsed";

test("format_elapsed_units", () => {
  expect(formatElapsed(0)).toBe("0s");
  expect(formatElapsed(-5)).toBe("0s");
  expect(formatElapsed(30.9)).toBe("30s");
  expect(formatElapsed(59)).toBe("59s");
  expect(formatElapsed(60)).toBe("1m");
  expect(formatElapsed(240)).toBe("4m");
  expect(formatElapsed(3599)).toBe("59m");
  expect(formatElapsed(7200)).toBe("2h");
  expect(formatElapsed(2 * 86400 + 5)).toBe("2d");
});

test("pill_text_per_bucket", () => {
  const now = 1_000_000;
  expect(pillText("working", now - 240_000, now)).toBe("working 4m");
  expect(pillText("ready", now - 120_000, now)).toBe("ready");
  expect(pillText("needs_you", now - 30_000, now)).toBe("needs you");
  expect(pillText("idle", now - 3_600_000, now)).toBe("idle");
  expect(pillText("working", undefined, now)).toBe("working");
});
