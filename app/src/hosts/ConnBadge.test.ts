import { hostDetail, timeAgo } from "./ConnBadge";

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

test("host_detail_shows_address_and_last_seen", () => {
  const h = { user: "sam", address: "box.example.com", port: 22 };
  expect(hostDetail(h, "online", NOW - 600_000, NOW)).toBe("sam@box.example.com");
  expect(hostDetail({ ...h, port: 2222 }, "offline", undefined, NOW)).toBe("sam@box.example.com:2222");
  expect(hostDetail(h, "offline", NOW - 600_000, NOW)).toBe("sam@box.example.com · seen 10 min ago");
});
