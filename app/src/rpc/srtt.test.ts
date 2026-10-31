import { RpcClient } from "./RpcClient";
import { isSmallCall, nextSrtt, SRTT_ALPHA } from "./srtt";
import type { LineTransport } from "./transport";

test("first_sample_sets_srtt_then_ewma", () => {
  expect(nextSrtt(undefined, 100)).toBe(100);
  expect(nextSrtt(100, 180)).toBe(100 + SRTT_ALPHA * 80);
  let s = 100;
  for (let i = 0; i < 200; i++) s = nextSrtt(s, 40);
  expect(s).toBeCloseTo(40, 3);
});

test("only_small_calls_are_samples", () => {
  expect(isSmallCall("ping")).toBe(true);
  expect(isSmallCall("herdr.call", { method: "pane.send_input" })).toBe(true);
  expect(isSmallCall("herdr.call", { method: "pane.read" })).toBe(false);
  expect(isSmallCall("herdr.call", { method: "agent.start" })).toBe(false);
  expect(isSmallCall("stt.make", {})).toBe(false);
});

/** A transport that answers each request after `delay` ms. */
class EchoTransport implements LineTransport {
  private cb?: (line: string) => void;
  constructor(private readonly delay: () => number) {}
  send(line: string) {
    const { id } = JSON.parse(line);
    setTimeout(() => this.cb?.(JSON.stringify({ id, result: {} })), this.delay());
  }
  onLine(cb: (line: string) => void) {
    this.cb = cb;
    return () => {};
  }
  onClose() {
    return () => {};
  }
  close() {}
}

test("rpc_client_tracks_srtt_of_small_calls", async () => {
  jest.useFakeTimers();
  let delay = 120;
  const rpc = new RpcClient(new EchoTransport(() => delay));
  const seen: number[] = [];
  rpc.onSrtt((ms) => seen.push(ms));
  expect(rpc.srttMs).toBeUndefined();
  const ping = rpc.call("ping");
  await jest.advanceTimersByTimeAsync(120);
  await ping;
  expect(rpc.srttMs).toBe(120);
  // A big call is not a sample.
  delay = 2000;
  const read = rpc.call("herdr.call", { method: "pane.read" });
  await jest.advanceTimersByTimeAsync(2000);
  await read;
  expect(rpc.srttMs).toBe(120);
  delay = 40;
  const send = rpc.call("herdr.call", { method: "pane.send_input" });
  await jest.advanceTimersByTimeAsync(40);
  await send;
  expect(rpc.srttMs).toBe(120 + SRTT_ALPHA * (40 - 120));
  expect(seen).toHaveLength(2);
  rpc.close();
  jest.useRealTimers();
});
