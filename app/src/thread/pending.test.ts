import type { ThreadItem } from "@herdling/protocol";

import { RpcError } from "@/rpc/RpcClient";

import { addPending, pendingLabel, pendingOf, reconcilePending, removePending, sendWithPending, usePending, PENDING_MAX_AGE_MS, matchKey, splitUploads } from "./pending";

const H = "studio";
const P = "w1:p1";
const user = (id: string, text: string): ThreadItem => ({ kind: "user", id, ts: 0, text });
const states = () => pendingOf(H, P).map((p) => `${p.text}:${p.state}`);

beforeEach(() => usePending.setState({ byPane: {} }));

test("send_adds_a_bubble_at_once_then_queued", async () => {
  let done!: () => void;
  const rpc = { call: jest.fn(() => new Promise<void>((r) => (done = r))) } as any;
  const sending = sendWithPending(rpc, H, P, "run the tests");
  expect(states()).toEqual(["run the tests:sending"]);
  expect(rpc.call).toHaveBeenCalledWith("herdr.call", { method: "agent.prompt", params: { target: P, text: "run the tests" } });
  done();
  await sending;
  expect(states()).toEqual(["run the tests:queued"]);
});

test("a_failed_send_shows_not_sent_and_a_retry_sends_the_same_bubble", async () => {
  const rpc = { call: jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({}) } as any;
  await expect(sendWithPending(rpc, H, P, "deploy")).rejects.toThrow("offline");
  const [p] = pendingOf(H, P);
  expect(p).toMatchObject({ state: "failed", error: "offline" });
  await sendWithPending(rpc, H, P, "deploy", p.id);
  expect(pendingOf(H, P)).toHaveLength(1);
  expect(pendingOf(H, P)[0]).toMatchObject({ id: p.id, state: "queued", error: undefined });
});

test("a_timeout_marks_the_prompt_unconfirmed_and_the_log_copy_still_removes_it", async () => {
  const rpc = { call: jest.fn().mockRejectedValueOnce(new RpcError("timeout", "herdr.call timed out after 15000ms")) };
  await expect(sendWithPending(rpc, H, P, "run the tests")).rejects.toThrow("timed out");
  expect(states()).toEqual(["run the tests:unconfirmed"]);
  // The host got the prompt after all: the log shows it, so the bubble goes and no retry sends it twice.
  reconcilePending(H, P, [user("u1", "older")]);
  reconcilePending(H, P, [user("u1", "older"), user("u2", "run the tests")]);
  expect(states()).toEqual([]);
});

test("a_hard_error_stays_failed_and_a_matching_log_item_does_not_remove_it", async () => {
  const rpc = { call: jest.fn().mockRejectedValueOnce(new RpcError("agent_blocked", "blocked")) };
  await expect(sendWithPending(rpc, H, P, "go")).rejects.toThrow("blocked");
  reconcilePending(H, P, []);
  reconcilePending(H, P, [user("u1", "go")]);
  expect(states()).toEqual(["go:failed"]);
});

test("a_retry_while_the_bubble_is_sending_does_nothing", async () => {
  let done!: () => void;
  const rpc = {
    call: jest.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(() => new Promise<void>((r) => (done = r))),
  };
  await expect(sendWithPending(rpc, H, P, "deploy")).rejects.toThrow("offline");
  const [p] = pendingOf(H, P);
  // Two taps on "Retry" before the bubble re-renders.
  const first = sendWithPending(rpc, H, P, "deploy", p.id);
  const second = sendWithPending(rpc, H, P, "deploy", p.id);
  done();
  await Promise.all([first, second]);
  expect(rpc.call).toHaveBeenCalledTimes(2);
  expect(states()).toEqual(["deploy:queued"]);
});

test("the_bubble_labels", () => {
  expect(pendingLabel({ state: "sending" })).toBe("Sending…");
  expect(pendingLabel({ state: "queued" })).toBe("Queued");
  expect(pendingLabel({ state: "failed" })).toBe("Not sent · Retry");
  expect(pendingLabel({ state: "unconfirmed" })).toBe("No reply · Retry");
});

test("the_log_copy_removes_the_bubble_but_an_older_copy_does_not", () => {
  const old = [user("u1", "continue")];
  addPending(H, P, "continue");
  // First compare: the same text already in the log is an older prompt.
  reconcilePending(H, P, old);
  expect(states()).toEqual(["continue:sending"]);
  reconcilePending(H, P, old);
  expect(states()).toEqual(["continue:sending"]);
  reconcilePending(H, P, [...old, user("u2", "  continue \n")]);
  expect(states()).toEqual([]);
});

test("several_bubbles_keep_send_order_and_one_log_item_matches_one", () => {
  addPending(H, P, "a");
  addPending(H, P, "b");
  addPending(H, P, "a");
  reconcilePending(H, P, []);
  expect(states()).toEqual(["a:sending", "b:sending", "a:sending"]);
  reconcilePending(H, P, [user("x1", "a")]);
  expect(states()).toEqual(["b:sending", "a:sending"]);
});

test("compare_uses_the_first_200_chars", () => {
  const long = "x".repeat(250);
  addPending(H, P, long);
  reconcilePending(H, P, []);
  reconcilePending(H, P, [user("u", `${"x".repeat(200)}y`)]);
  expect(pendingOf(H, P)).toHaveLength(0);
});

test("old_bubbles_go_away_and_remove_works", () => {
  addPending(H, P, "stale", 0);
  const id = addPending(H, P, "fresh", PENDING_MAX_AGE_MS);
  reconcilePending(H, P, [], PENDING_MAX_AGE_MS + 1);
  expect(states()).toEqual(["fresh:sending"]);
  removePending(H, P, id);
  expect(usePending.getState().byPane).toEqual({});
});

describe("photo prompts", () => {
  const path = "/Users/sam/.cache/herdling/uploads/1793412598805-pasted-1.jpg";

  it("hides the upload paths and counts them", () => {
    expect(splitUploads(`Why is there 2 of some?\n${path}`)).toEqual({ text: "Why is there 2 of some?", images: 1 });
    expect(splitUploads("no photos")).toEqual({ text: "no photos", images: 0 });
  });

  it("matches the log text where Claude Code put [Image #N] for the path", () => {
    expect(matchKey(`Why is there 2 of some?\n${path}`)).toBe(matchKey("[Image #12]Why is there 2 of some?"));
    expect(matchKey(`Look\n${path}\n${path}`)).toBe(matchKey("[Image #1] [Image #2]Look"));
  });
});

test("prompts_that_claude_code_joins_into_one_item_all_go_away", () => {
  addPending(H, P, "Fix it\n/home/sam/.cache/herdling/uploads/1-shot.jpg");
  addPending(H, P, "Okay so what changed?");
  reconcilePending(H, P, [user("u1", "older")]);
  reconcilePending(H, P, [user("u1", "older")]);
  expect(pendingOf(H, P)).toHaveLength(2);
  reconcilePending(H, P, [user("u1", "older"), user("u2", "Fix it [Image #3]Okay so what changed?")]);
  expect(states()).toEqual([]);
});

test("an_older_item_that_contains_the_prompt_does_not_match", () => {
  const old = [user("u1", "please continue now")];
  addPending(H, P, "continue");
  reconcilePending(H, P, old);
  reconcilePending(H, P, old);
  expect(states()).toEqual(["continue:sending"]);
});
