import { formatBytes, pct } from "./format";

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
