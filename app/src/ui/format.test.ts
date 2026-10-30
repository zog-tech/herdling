import { formatBytes, formatDuration, formatResetIn, pct } from "./format";

test("format_bytes", () => {
  expect(formatBytes(17179869184)).toBe("16 GB");
  expect(formatBytes(1610612736)).toBe("1.5 GB");
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1048576)).toBe("1 MB");
});

test("pct_bounds", () => {
  expect(pct(5, 0)).toBe(0);
  expect(pct(0, 10)).toBe(0);
  expect(pct(5, 10)).toBe(50);
  expect(pct(20, 10)).toBe(100);
  expect(pct(-1, 10)).toBe(0);
});

test("format_reset_in", () => {
  const now = 1_000_000;
  expect(formatResetIn(now + 7800, now)).toBe("resets in 2h 10m");
  expect(formatResetIn(now + 59, now)).toBe("resets now");
  expect(formatResetIn(now - 100, now)).toBe("resets now");
  expect(formatResetIn(now + 60, now)).toBe("resets in 1m");
  expect(formatResetIn(now + 3600, now)).toBe("resets in 1h");
  expect(formatResetIn(now + 3 * 86400 + 4 * 3600 + 120, now)).toBe("resets in 3d 4h");
  expect(formatResetIn(now + 2 * 86400, now)).toBe("resets in 2d");
  expect(formatResetIn(null, now)).toBe("");
});

test("format_duration_shows_seconds_under_an_hour", () => {
  expect(formatDuration(0)).toBe("0s");
  expect(formatDuration(12.7)).toBe("12s");
  expect(formatDuration(72)).toBe("1m 12s");
  expect(formatDuration(3720)).toBe("1h 2m");
  expect(formatDuration(-5)).toBe("0s");
});
