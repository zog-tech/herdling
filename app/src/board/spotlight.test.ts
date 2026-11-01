import type { BoardItem, Bucket } from "./buckets";
import { hostBadges, lastLines, spotlight, spotlightLabel, tileWidth } from "./spotlight";

const item = (key: string, bucket: Bucket, patch: Partial<BoardItem> = {}): BoardItem => ({
  key,
  hostId: "h1",
  hostName: "studio.local",
  workspace: "api",
  title: key,
  subtitle: "studio.local · claude",
  agent: { pane_id: key, tab_id: "t1", workspace_id: "w1", agent: "claude", agent_status: "idle", state_change_seq: 1 },
  bucket,
  ...patch,
});
const keys = (l: { key: string }[]) => l.map((i) => i.key);

test("highlights_are_needs_you_then_working_then_ready_without_idle", () => {
  // The Board order puts ready before working; the carousel puts working first.
  const l = [item("n", "needs_you"), item("r", "ready"), item("w1", "working"), item("w2", "working"), item("i", "idle")];
  const s = spotlight(l);
  expect(s.kind).toBe("highlights");
  expect(keys(s.items)).toEqual(["n", "w1", "w2", "r"]);
  expect(spotlightLabel(s.kind)).toBe("Highlights");
});

test("highlights_stop_at_8", () => {
  const l = Array.from({ length: 12 }, (_, i) => item(`w${i}`, "working"));
  expect(spotlight(l).items).toHaveLength(8);
});

test("with_no_highlights_the_4_most_recent_idle_agents_show", () => {
  const l = [
    item("a", "idle", { since: 1 }),
    item("b", "idle", { since: 5 }),
    item("c", "idle"),
    item("d", "idle", { since: 3 }),
    item("e", "idle", { since: 4 }),
    item("f", "idle", { since: 2 }),
  ];
  const s = spotlight(l);
  expect(s.kind).toBe("recent");
  expect(keys(s.items)).toEqual(["b", "e", "d", "f"]);
  expect(spotlightLabel(s.kind)).toBe("Recent");
  expect(spotlight([]).items).toEqual([]);
});

test("tile_width_is_78_percent_up_to_340", () => {
  expect(tileWidth(390)).toBe(304);
  expect(tileWidth(1024)).toBe(340);
});

test("host_badges_show_3_online_first_and_count_the_rest", () => {
  const hosts = [
    { id: "1", name: "studio.local" },
    { id: "2", name: "build" },
    { id: "3", name: "nova" },
    { id: "4", name: "laptop" },
    { id: "5", name: "" },
  ];
  const r = hostBadges(hosts, new Set(["3", "4"]));
  expect(r.badges).toEqual([
    { id: "3", letter: "N", online: true },
    { id: "4", letter: "L", online: true },
    { id: "1", letter: "S", online: false },
  ]);
  expect(r.more).toBe(2);
  expect(r.label).toBe("Computers, 2 of 5 online");
  expect(hostBadges(hosts.slice(0, 2), new Set()).more).toBe(0);
  expect(hostBadges([], new Set()).label).toBe("Computers, none added");
});

test("last_lines_drop_the_blank_end_and_keep_n", () => {
  expect(lastLines("a\nb\nc\n\n  \n", 2)).toEqual(["b", "c"]);
  expect(lastLines(undefined, 3)).toEqual([]);
  expect(lastLines("one  ", 3)).toEqual(["one"]);
});
