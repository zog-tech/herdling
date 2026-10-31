import type { AgentInfo } from "@/herdr/snapshot";

import { CARD_ACTIONS, cardLabel, runCardAction } from "./a11y";
import type { BoardItem } from "./buckets";

const item = (over: Partial<BoardItem>): BoardItem => ({
  key: "h:p1",
  hostId: "h",
  hostName: "studio",
  workspace: "api",
  title: "api",
  subtitle: "studio · claude",
  terminalTitle: "api-auth",
  agent: { pane_id: "p1", tab_id: "t", workspace_id: "w1", agent: "claude", agent_status: "blocked", state_change_seq: 1, terminal_title_stripped: "api-auth" } as AgentInfo,
  bucket: "needs_you",
  since: 970_000,
  line: "Allow git push?",
  ...over,
});

test("card_label_reads_status_place_preview_and_unread", () => {
  expect(cardLabel(item({}), 1_000_000)).toBe("api, needs you, studio · claude, Allow git push?");
  expect(cardLabel(item({ bucket: "ready", line: "Done.", since: undefined }), 1_000_000)).toBe("api, ready, studio · claude, Done., unread");
  // No preview: the terminal title takes its place.
  expect(cardLabel(item({ line: undefined }), 1_000_000)).toBe("api, needs you, studio · claude, api-auth");
  expect(cardLabel(item({ line: undefined, terminalTitle: undefined }), 1_000_000)).toBe("api, needs you, studio · claude");
});

test("voiceover_actions_mirror_tap_peek_and_swipes", () => {
  expect(CARD_ACTIONS.map((a) => a.name)).toEqual(["activate", "longpress", "markRead", "reply", "restart"]);
  const h = { onOpen: jest.fn(), onPeek: jest.fn(), onMarkRead: jest.fn(), onReply: jest.fn(), onRestart: jest.fn() };
  const i = item({});
  for (const name of ["activate", "longpress", "markRead", "reply", "restart", "magicTap"]) runCardAction(name, i, h);
  for (const fn of Object.values(h)) expect(fn).toHaveBeenCalledWith(i);
  expect(Object.values(h).every((f) => f.mock.calls.length === 1)).toBe(true);
});
