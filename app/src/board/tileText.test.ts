import type { AgentPreview } from "@herdling/protocol";

import type { BoardItem, PreviewEntry } from "./buckets";
import {
  compactElapsed,
  currentPreview,
  folderName,
  showsTime,
  statusLine,
  TILE_EMPTY,
  tileLabel,
  tileMain,
  tilePlace,
  tileTitle,
} from "./tileText";

const preview = (patch: Partial<AgentPreview> = {}): AgentPreview => ({ pane_id: "p1", source: "log", ...patch });
const agent = (patch: Partial<BoardItem["agent"]> = {}): BoardItem["agent"] => ({
  pane_id: "p1",
  tab_id: "t1",
  workspace_id: "w1",
  agent: "claude",
  agent_status: "idle",
  state_change_seq: 1,
  ...patch,
});

test("needs_you_shows_the_question_first", () => {
  const p = preview({ question: "Allow git push?", activity: "Thinking", last_reply: "Done." });
  expect(tileMain("needs_you", p)).toEqual({ kind: "question", text: "Allow git push?" });
});

test("needs_you_without_a_question_shows_the_last_reply", () => {
  expect(tileMain("needs_you", preview({ last_reply: "Done." }))).toEqual({ kind: "reply", text: "Done." });
});

test("a_question_shows_only_when_the_agent_needs_you", () => {
  expect(tileMain("working", preview({ question: "Allow git push?" }))).toEqual({ kind: "empty", text: TILE_EMPTY });
});

test("working_shows_the_activity_before_the_last_reply", () => {
  const p = preview({ activity: "Running pnpm test", last_reply: "Done." });
  expect(tileMain("working", p)).toEqual({ kind: "activity", text: "Running pnpm test" });
  expect(tileMain("working", preview({ last_reply: "Done." }))).toEqual({ kind: "reply", text: "Done." });
});

test("an_activity_shows_only_while_the_agent_works", () => {
  expect(tileMain("ready", preview({ activity: "Thinking", last_reply: "Done." }))).toEqual({ kind: "reply", text: "Done." });
});

test("background_shows_the_last_reply_then_the_first_command", () => {
  const background = { count: 2, commands: ["  ", "pnpm dev", "tail -f log"] };
  expect(tileMain("background", preview({ last_reply: "Started.", background }))).toEqual({ kind: "reply", text: "Started." });
  expect(tileMain("background", preview({ background }))).toEqual({ kind: "background", text: "pnpm dev" });
  // No command known: the count of background work.
  expect(tileMain("background", preview({ background: { count: 0, agents: 1 } }))).toEqual({
    kind: "background",
    text: "1 subagent running",
  });
});

test("with_nothing_to_show_the_main_text_is_the_quiet_empty_line", () => {
  expect(tileMain("idle", undefined)).toEqual({ kind: "empty", text: TILE_EMPTY });
  expect(tileMain("idle", preview({ last_reply: "   " }))).toEqual({ kind: "empty", text: TILE_EMPTY });
  // A background command shows only for a background agent.
  expect(tileMain("idle", preview({ background: { count: 1, commands: ["pnpm dev"] } }))).toEqual({ kind: "empty", text: TILE_EMPTY });
});

test("a_preview_of_an_old_status_is_ignored", () => {
  const entry: PreviewEntry = { ...preview({ activity: "Thinking" }), status: "working" };
  expect(currentPreview({ agent: agent({ agent_status: "working" }) }, entry)).toBe(entry);
  expect(currentPreview({ agent: agent({ agent_status: "blocked" }) }, entry)).toBeUndefined();
  expect(currentPreview({ agent: agent() }, undefined)).toBeUndefined();
});

test("the_title_is_the_own_name_then_the_terminal_title_then_the_board_title", () => {
  expect(tileTitle({ title: "api", agent: agent({ name: "reviewer", terminal_title_stripped: "claude: fix" }) })).toBe("reviewer");
  expect(tileTitle({ title: "api", agent: agent({ name: " ", terminal_title_stripped: "claude: fix" }) })).toBe("claude: fix");
  expect(tileTitle({ title: "api", agent: agent({ name: null }) })).toBe("api");
});

test("the_folder_is_the_last_part_of_the_path", () => {
  expect(folderName("/home/sam/proj")).toBe("proj");
  expect(folderName("/home/sam/proj/")).toBe("proj");
  expect(folderName("/")).toBe("/");
  expect(folderName(undefined)).toBeUndefined();
  expect(folderName("  ")).toBeUndefined();
});

test("the_place_names_the_computer_only_with_more_than_one_computer", () => {
  const item = { hostName: "studio.local", agent: agent({ cwd: "/home/sam/proj" }) };
  expect(tilePlace(item, false)).toBe("proj");
  expect(tilePlace(item, true)).toBe("proj · studio.local");
  expect(tilePlace({ hostName: "studio.local", agent: agent() }, true)).toBe("studio.local");
  expect(tilePlace({ hostName: "studio.local", agent: agent() }, false)).toBeUndefined();
});

test("the_status_line_has_a_compact_time", () => {
  expect(compactElapsed(-5)).toBe("<1m");
  expect(compactElapsed(59)).toBe("<1m");
  expect(compactElapsed(4 * 60 + 30)).toBe("4m");
  expect(compactElapsed(3600)).toBe("1h");
  expect(compactElapsed(2 * 3600 + 5 * 60)).toBe("2h 5m");
  expect(statusLine("working", 240)).toBe("Working · 4m");
  expect(statusLine("needs_you", undefined)).toBe("Needs you");
});

test("the_time_shows_for_work_and_waits_and_for_other_statuses_only_when_the_host_knows_it", () => {
  expect(showsTime({ bucket: "working", since: 1 })).toBe(true);
  expect(showsTime({ bucket: "needs_you", since: 1 })).toBe(true);
  expect(showsTime({ bucket: "idle", since: 1 })).toBe(false);
  expect(showsTime({ bucket: "idle", since: 1, sinceKnown: true })).toBe(true);
  expect(showsTime({ bucket: "working" })).toBe(false);
});

test("the_label_reads_title_status_place_main_text_and_unread", () => {
  expect(tileLabel("api", "Ready · 2m", "proj", { kind: "reply", text: "Done." }, "ready")).toBe("api, Ready · 2m, proj, Done., unread");
  expect(tileLabel("api", "Idle", undefined, { kind: "empty", text: TILE_EMPTY }, "idle")).toBe(`api, Idle, ${TILE_EMPTY}`);
});
