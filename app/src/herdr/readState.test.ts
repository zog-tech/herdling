import { bucketOf } from "@/board/buckets";

import { hostCovers, hostSeenTurn, isRead, pendingMarks } from "./readState";

describe("isRead", () => {
  it("uses the local mark like before when the host sends no turns (older herdlingd)", () => {
    expect(isRead({ state_change_seq: 5 }, 5)).toBe(true);
    expect(isRead({ state_change_seq: 5 }, 6)).toBe(true);
    expect(isRead({ state_change_seq: 5 }, 4)).toBe(false);
    expect(isRead({ state_change_seq: 5 }, undefined)).toBe(false);
    expect(isRead({}, undefined)).toBe(true);
  });

  it("is read after a reset when the Herdling label covers the turn", () => {
    expect(isRead({ state_change_seq: 900, turn: 7, seen_turn: 7 }, undefined)).toBe(true);
    expect(isRead({ state_change_seq: 900, turn: 8, seen_turn: 7 }, undefined)).toBe(false);
  });

  it("is read when the desktop label covers the turn", () => {
    expect(isRead({ state_change_seq: 900, turn: 53, herdr_seen_turn: 53 }, undefined)).toBe(true);
    expect(isRead({ state_change_seq: 900, turn: 38, herdr_seen_turn: 29 }, undefined)).toBe(false);
  });

  it("takes the higher of the two host values", () => {
    expect(hostSeenTurn({ seen_turn: 3, herdr_seen_turn: 5 })).toBe(5);
    expect(hostSeenTurn({ seen_turn: 6 })).toBe(6);
    expect(hostSeenTurn({})).toBeUndefined();
    expect(isRead({ state_change_seq: 9, turn: 5, seen_turn: 3, herdr_seen_turn: 5 }, undefined)).toBe(true);
  });

  it("has nothing to read at turn 0", () => {
    expect(isRead({ state_change_seq: 9, turn: 0 }, undefined)).toBe(true);
  });

  it("needs the turn for a host mark", () => {
    expect(hostCovers({ seen_turn: 5 })).toBe(false);
    expect(isRead({ state_change_seq: 9, seen_turn: 5 }, undefined)).toBe(false);
  });

  it("drives the board bucket", () => {
    expect(bucketOf({ agent_status: "done", state_change_seq: 9, turn: 4, herdr_seen_turn: 4 }, undefined)).toBe("idle");
    expect(bucketOf({ agent_status: "done", state_change_seq: 9, turn: 5, herdr_seen_turn: 4 }, undefined)).toBe("ready");
    expect(bucketOf({ agent_status: "blocked", state_change_seq: 9, turn: 4, seen_turn: 4 }, undefined)).toBe("needs_you");
    expect(bucketOf({ agent_status: "working", state_change_seq: 9, turn: 4, seen_turn: 4 }, undefined)).toBe("working");
  });
});

describe("pendingMarks", () => {
  const agent = (pane_id: string, o: Partial<Parameters<typeof pendingMarks>[1][number]> = {}) => ({
    pane_id,
    agent_status: "done" as const,
    state_change_seq: 100,
    turn: 4,
    ...o,
  });

  it("sends the turn of a finished agent that this phone saw", () => {
    expect(pendingMarks("h", [agent("t1")], { "h:t1": 100 }, new Map())).toEqual([{ paneId: "t1", turn: 4 }]);
  });

  it("sends nothing when the local mark is older than the current status", () => {
    expect(pendingMarks("h", [agent("t1")], { "h:t1": 99 }, new Map())).toEqual([]);
    expect(pendingMarks("h", [agent("t1")], {}, new Map())).toEqual([]);
  });

  it("sends nothing for a working or blocked agent", () => {
    const seen = { "h:t1": 100 };
    expect(pendingMarks("h", [agent("t1", { agent_status: "working" })], seen, new Map())).toEqual([]);
    expect(pendingMarks("h", [agent("t1", { agent_status: "blocked" })], seen, new Map())).toEqual([]);
  });

  it("sends nothing when the host already covers the turn", () => {
    const seen = { "h:t1": 100 };
    expect(pendingMarks("h", [agent("t1", { seen_turn: 4 })], seen, new Map())).toEqual([]);
    expect(pendingMarks("h", [agent("t1", { herdr_seen_turn: 4 })], seen, new Map())).toEqual([]);
    expect(pendingMarks("h", [agent("t1", { seen_turn: 3 })], seen, new Map())).toEqual([{ paneId: "t1", turn: 4 }]);
  });

  it("sends nothing without a turn, or at turn 0", () => {
    const seen = { "h:t1": 100 };
    expect(pendingMarks("h", [agent("t1", { turn: undefined })], seen, new Map())).toEqual([]);
    expect(pendingMarks("h", [agent("t1", { turn: 0 })], seen, new Map())).toEqual([]);
  });

  it("sends a mark once per turn", () => {
    const seen = { "h:t1": 100 };
    expect(pendingMarks("h", [agent("t1")], seen, new Map([["h:t1", 4]]))).toEqual([]);
    expect(pendingMarks("h", [agent("t1", { turn: 5, state_change_seq: 100 })], seen, new Map([["h:t1", 4]]))).toEqual([
      { paneId: "t1", turn: 5 },
    ]);
  });

  it("keeps hosts apart", () => {
    expect(pendingMarks("h2", [agent("t1")], { "h:t1": 100 }, new Map())).toEqual([]);
  });
});
