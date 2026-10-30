import type { AgentInfo } from "@/herdr/snapshot";

import { announcement, bucketChanges, makeThrottle } from "./announce";
import type { BoardItem, Bucket } from "./buckets";

jest.mock("@/ui/haptics", () => ({ status: jest.fn() }));

const item = (key: string, title: string, bucket: Bucket): BoardItem => ({
  key,
  hostId: "studio",
  hostName: "studio",
  workspace: "api",
  title,
  subtitle: "studio · claude",
  agent: {} as AgentInfo,
  bucket,
});

test("changes_skip_new_cards_and_the_users_own_seen", () => {
  const prev: Record<string, Bucket> = { a: "working", b: "ready", c: "idle" };
  const now = [item("a", "api", "needs_you"), item("b", "web", "idle"), item("c", "docs", "idle"), item("d", "new", "working")];
  expect(bucketChanges(prev, now)).toEqual([{ key: "a", title: "api", from: "working", to: "needs_you" }]);
});

test("announcement_text", () => {
  expect(announcement([])).toBeUndefined();
  expect(announcement([{ key: "a", title: "api", from: "working", to: "needs_you" }])).toBe("api moved to Needs you");
  expect(
    announcement([
      { key: "a", title: "api", from: "working", to: "ready" },
      { key: "b", title: "web", from: "working", to: "ready" },
    ]),
  ).toBe("api moved to Ready, and 1 more");
});

test("throttle_says_one_per_2s_and_keeps_the_newest", () => {
  jest.useFakeTimers();
  const said: string[] = [];
  const t = makeThrottle((x) => said.push(x));
  t.push("one", Date.now());
  t.push("two", Date.now());
  t.push("three", Date.now());
  expect(said).toEqual(["one"]);
  jest.advanceTimersByTime(2_000);
  expect(said).toEqual(["one", "three"]);
  t.cancel();
  jest.useRealTimers();
});
