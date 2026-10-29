import { timeAgo } from "./ConnBadge";

const NOW = 1_000_000_000_000;
const ago = (s: number) => timeAgo(NOW - s * 1000, NOW);

test("time_ago_boundaries", () => {
  expect(ago(0)).toBe("just now");
  expect(ago(29)).toBe("just now");
  expect(ago(30)).toBe("1 min ago");
  expect(ago(89)).toBe("1 min ago");
  expect(ago(3599)).toBe("60 min ago");
  expect(ago(3600)).toBe("1 h ago");
  expect(ago(86399)).toBe("24 h ago");
  expect(ago(86400)).toBe("1 d ago");
  expect(ago(-50)).toBe("just now");
});
