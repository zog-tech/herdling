import { DroppedError, SendQueue, Typist, type SendOp } from "./sendQueue";

type Call = { op: SendOp; ok: () => void; fail: (e: unknown) => void };

/** A send function whose calls the test answers by hand. */
function manual() {
  const calls: Call[] = [];
  const send = (op: SendOp) =>
    new Promise<void>((resolve, reject) => calls.push({ op, ok: resolve, fail: reject }));
  return { calls, send };
}
const tick = () => new Promise((r) => setImmediate(r));

test("pipelined_queue_sends_everything_at_once_in_order", async () => {
  const { calls, send } = manual();
  const q = new SendQueue(send, { pipeline: () => true, onError: jest.fn() });
  q.push({ keys: ["up"] });
  q.push({ text: "ls", keys: ["enter"] });
  q.push({ keys: ["tab"] });
  expect(calls.map((c) => c.op)).toEqual([{ keys: ["up"] }, { text: "ls", keys: ["enter"] }, { keys: ["tab"] }]);
  expect(q.size).toBe(3);
  calls.forEach((c) => c.ok());
  await tick();
  expect(q.size).toBe(0);
});

test("serial_queue_waits_for_each_reply", async () => {
  const { calls, send } = manual();
  const q = new SendQueue(send, { pipeline: () => false, onError: jest.fn() });
  const a = q.push({ keys: ["a"] });
  q.push({ keys: ["b"] });
  expect(calls).toHaveLength(1);
  calls[0].ok();
  await a;
  await tick();
  expect(calls.map((c) => c.op.keys)).toEqual([["a"], ["b"]]);
});

test("an_error_drops_the_waiting_items_and_reports_once", async () => {
  const { calls, send } = manual();
  const onError = jest.fn();
  const q = new SendQueue(send, { pipeline: () => false, onError });
  const text = q.push({ text: "rm -rf build" });
  const enter = q.push({ keys: ["enter"] });
  calls[0].fail(new Error("pane gone"));
  await expect(text).rejects.toThrow("pane gone");
  // The Enter never goes out: it would run a half-typed command.
  await expect(enter).rejects.toBeInstanceOf(DroppedError);
  expect(calls).toHaveLength(1);
  expect(onError).toHaveBeenCalledTimes(1);
  // New items after the error go out again.
  q.push({ keys: ["esc"] });
  expect(calls).toHaveLength(2);
});

test("pipelined_failures_of_one_burst_report_once", async () => {
  const { calls, send } = manual();
  const onError = jest.fn();
  const q = new SendQueue(send, { pipeline: () => true, onError });
  q.push({ keys: ["a"] });
  q.push({ keys: ["b"] });
  calls[0].fail(new Error("disconnected"));
  calls[1].fail(new Error("disconnected"));
  await tick();
  expect(onError).toHaveBeenCalledTimes(1);
});

test("a_send_that_throws_at_once_counts_as_a_failure", async () => {
  const onError = jest.fn();
  const q = new SendQueue(
    () => {
      throw new Error("closed");
    },
    { pipeline: () => true, onError },
  );
  await expect(q.push({ keys: ["a"] })).rejects.toThrow("closed");
  expect(onError).toHaveBeenCalledTimes(1);
});

test("dispose_drops_waiting_items", async () => {
  const { calls, send } = manual();
  const q = new SendQueue(send, { pipeline: () => false, onError: jest.fn() });
  q.push({ keys: ["a"] });
  const b = q.push({ keys: ["b"] });
  q.dispose();
  await expect(b).rejects.toBeInstanceOf(DroppedError);
  calls[0].ok();
  await tick();
  expect(calls).toHaveLength(1);
});

describe("Typist", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("text_in_one_window_is_one_item_and_a_key_takes_the_waiting_text", () => {
    const pushed: SendOp[] = [];
    const t = new Typist({ push: async (op) => void pushed.push(op) });
    t.type("g");
    t.type("it");
    jest.advanceTimersByTime(16);
    t.type(" st");
    void t.key("enter");
    jest.advanceTimersByTime(100);
    void t.key("ctrl+c");
    expect(pushed).toEqual([{ text: "git" }, { text: " st", keys: ["enter"] }, { keys: ["ctrl+c"] }]);
  });
});
