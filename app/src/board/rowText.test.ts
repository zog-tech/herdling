import { cardSubtitle, footerMeta, IDLE_PLACEHOLDER, placeholderLine, shortAgo, shortElapsed, statusWithAge, titleParts } from "./rowText";

test("idle_rows_without_a_line_get_the_placeholder_in_divided_and_cards_only", () => {
  const idle = { bucket: "idle" as const };
  expect(placeholderLine(idle, "cards")).toBe(IDLE_PLACEHOLDER);
  expect(placeholderLine(idle, "divided")).toBe("Waiting for your next prompt");
  expect(placeholderLine(idle, "flat")).toBeUndefined();
  // A line or a terminal title wins over the placeholder.
  expect(placeholderLine({ ...idle, line: "Done." }, "cards")).toBeUndefined();
  expect(placeholderLine({ ...idle, terminalTitle: "vim" }, "cards")).toBeUndefined();
  // Only idle agents wait for a prompt.
  expect(placeholderLine({ bucket: "ready" }, "cards")).toBeUndefined();
  expect(placeholderLine({ bucket: "working" }, "cards")).toBeUndefined();
});

test("short_elapsed_shows_whole_minutes_and_hours", () => {
  expect(shortElapsed(-5)).toBe("Less than 1 min");
  expect(shortElapsed(59)).toBe("Less than 1 min");
  expect(shortElapsed(4 * 60 + 30)).toBe("4 min");
  expect(shortElapsed(3600)).toBe("1 h");
  expect(shortElapsed(2 * 3600 + 5 * 60)).toBe("2 h 5 min");
});

test("footer_meta_follows_the_bucket", () => {
  expect(footerMeta("working", 4 * 60, false)).toBe("4 min");
  expect(footerMeta("needs_you", 4 * 60, true)).toBe("Waiting 4 min");
  expect(footerMeta("needs_you", 10, true)).toBe("Waiting less than 1 min");
  expect(footerMeta("idle", 2 * 3600, true)).toBe("Last active 2 h ago");
  expect(footerMeta("ready", 5 * 60, true)).toBe("Last active 5 min ago");
  // The app's own first sighting is not the last activity: no text.
  expect(footerMeta("idle", 2 * 3600, false)).toBeUndefined();
  // No start time: no text.
  expect(footerMeta("working", undefined, true)).toBeUndefined();
});

test("short_ages_and_status_words", () => {
  expect(shortAgo(30)).toBe("now");
  expect(shortAgo(190)).toBe("3m");
  expect(shortAgo(2 * 3600 + 5)).toBe("2h");
  expect(shortAgo(3 * 86400)).toBe("3d");
  expect(statusWithAge("working", 190)).toBe("Working · 3m");
  expect(statusWithAge("needs_you", undefined)).toBe("Needs you");
});

test("card_title_and_subtitle_show_the_group_repo_and_helpers", () => {
  expect(titleParts({ group: "Payments", title: "Fix the login form" })).toEqual({ group: "Payments", task: "Fix the login form" });
  expect(titleParts({ group: "api", title: "API" })).toEqual({ task: "API" });
  expect(titleParts({ title: "api" })).toEqual({ task: "api" });
  expect(cardSubtitle({ subtitle: "studio · claude", repoLine: "api · main", helpers: [{ paneId: "hc:t2", title: "x", status: "working" }] })).toBe(
    "studio · claude · api · main · 1 helper · 1 working",
  );
  expect(cardSubtitle({ subtitle: "studio · claude" })).toBe("studio · claude");
});
