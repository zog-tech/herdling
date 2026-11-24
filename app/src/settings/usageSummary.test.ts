import type { Usage } from "@herdling/protocol";

import { noteUsage, usageValue, useUsageSummary } from "./usageSummary";

const usage = (claude: number[], codex: number[] = [], codexStatus: "ok" | "not_logged_in" = "ok"): Usage => ({
  providers: [
    { provider: "claude", status: "ok", windows: claude.map((p, i) => ({ label: `w${i}`, used_pct: p, resets_at: null })) },
    { provider: "codex", status: codexStatus, windows: codex.map((p, i) => ({ label: `w${i}`, used_pct: p, resets_at: null })) },
  ],
});

beforeEach(() => useUsageSummary.setState({ byHost: {} }));

test("the_value_is_the_highest_window_use_of_all_computers", () => {
  expect(usageValue({ a: usage([12, 41.6]), b: usage([30], [8]) })).toBe("42% used");
});

test("no_window_gives_no_value", () => {
  expect(usageValue({})).toBeUndefined();
  expect(usageValue({ a: usage([]) })).toBeUndefined();
});

test("a_provider_that_is_not_ok_does_not_count", () => {
  expect(usageValue({ a: usage([10], [90], "not_logged_in") })).toBe("10% used");
});

test("only_the_given_computers_count_and_the_value_stays_in_range", () => {
  const byHost = { a: usage([120]), b: usage([5]) };
  expect(usageValue(byHost, ["b"])).toBe("5% used");
  expect(usageValue(byHost, ["a"])).toBe("100% used");
  expect(usageValue(byHost, ["gone"])).toBeUndefined();
});

test("note_usage_keeps_and_drops_a_reading", () => {
  noteUsage("a", usage([20]));
  expect(usageValue(useUsageSummary.getState().byHost)).toBe("20% used");
  noteUsage("a", undefined);
  expect(useUsageSummary.getState().byHost).toEqual({});
});
