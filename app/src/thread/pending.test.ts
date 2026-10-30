import type { ThreadItem } from "@zogssh/protocol";

import { addPending, pendingOf, reconcilePending, removePending, sendWithPending, usePending, PENDING_MAX_AGE_MS } from "./pending";

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
