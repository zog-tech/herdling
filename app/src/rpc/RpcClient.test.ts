import { RpcClient } from "./RpcClient";
import type { LineTransport } from "./transport";

class FakeTransport implements LineTransport {
  sent: any[] = [];
  closed = false;
  private lineCbs = new Set<(l: string) => void>();
  private closeCbs = new Set<(r: string) => void>();
  send(line: string) {
    this.sent.push(JSON.parse(line));
  }
  onLine(cb: (l: string) => void) {
    this.lineCbs.add(cb);
    return () => this.lineCbs.delete(cb);
  }
  onClose(cb: (r: string) => void) {
    this.closeCbs.add(cb);
    return () => this.closeCbs.delete(cb);
  }
  close() {
    this.closed = true;
  }
  // test helpers
  receive(obj: unknown) {
    this.receiveRaw(JSON.stringify(obj));
  }
  receiveRaw(line: string) {
    this.lineCbs.forEach((cb) => cb(line));
  }
  drop(reason = "gone") {
    this.closeCbs.forEach((cb) => cb(reason));
  }
}

const flush = () => Promise.resolve().then(() => Promise.resolve());

describe("RpcClient", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("call_resolves_matching_id", async () => {
    const t = new FakeTransport();
    const c = new RpcClient(t);
    const a = c.call<string>("a", { x: 1 });
    const b = c.call<string>("b");
    expect(t.sent).toHaveLength(2);
    expect(t.sent[0]).toMatchObject({ method: "a", params: { x: 1 } });
    t.receive({ id: t.sent[1].id, result: "B" });
    t.receive({ id: t.sent[0].id, result: "A" });
    await expect(a).resolves.toBe("A");
    await expect(b).resolves.toBe("B");
  });

  it("call_rejects_error_with_code", async () => {
    const t = new FakeTransport();
    const c = new RpcClient(t);
    const p = c.call("x");
    t.receive({ id: t.sent[0].id, error: { code: "not_found", message: "nope" } });
    await expect(p).rejects.toMatchObject({ code: "not_found", message: "nope" });
  });

  it("call_times_out", async () => {
    jest.useFakeTimers();
    const t = new FakeTransport();
    const c = new RpcClient(t, { timeoutMs: 1000 });
    const p = c.call("slow");
    const assertion = expect(p).rejects.toMatchObject({ code: "timeout" });
    jest.advanceTimersByTime(1000);
    await assertion;
    // late response is ignored
    t.receive({ id: t.sent[0].id, result: 1 });
  });

  it("stream_routes_events_by_stream_id", async () => {
    const t = new FakeTransport();
    const c = new RpcClient(t);
    const got1: number[] = [];
    const got2: number[] = [];
    const p1 = c.stream<number>("sub", {}, (d) => got1.push(d));
    const p2 = c.stream<number>("sub", {}, (d) => got2.push(d));
    t.receive({ id: t.sent[0].id, result: { stream: "s1" } });
    t.receive({ id: t.sent[1].id, result: { stream: "s2" } });
    await Promise.all([p1, p2]);
    t.receive({ method: "event", params: { stream: "s2", data: 2 } });
    t.receive({ method: "event", params: { stream: "s1", data: 1 } });
    t.receive({ method: "event", params: { stream: "other", data: 9 } });
    expect(got1).toEqual([1]);
    expect(got2).toEqual([2]);
  });

  it("stream_buffers_events_that_arrive_before_result", async () => {
    const t = new FakeTransport();
    const c = new RpcClient(t);
    const got: number[] = [];
    const p = c.stream<number>("sub", {}, (d) => got.push(d));
    t.receive({ method: "event", params: { stream: "s1", data: 1 } });
    t.receive({ method: "event", params: { stream: "s1", data: 2 } });
    expect(got).toEqual([]);
    t.receive({ id: t.sent[0].id, result: { stream: "s1" } });
    expect(got).toEqual([1, 2]);
    await p;
    t.receive({ method: "event", params: { stream: "s1", data: 3 } });
    expect(got).toEqual([1, 2, 3]);
  });

  it("close_rejects_pending_with_disconnected", async () => {
    const t = new FakeTransport();
    const c = new RpcClient(t);
    const p = c.call("x");
    expect(c.closed).toBe(false);
    t.drop("eof");
    await expect(p).rejects.toMatchObject({ code: "disconnected" });
    expect(c.closed).toBe(true);
    await expect(c.call("y")).rejects.toMatchObject({ code: "disconnected" });
  });

  it("unsubscribe_sends_rpc_cancel", async () => {
    const t = new FakeTransport();
    const c = new RpcClient(t);
    const got: number[] = [];
    const p = c.stream<number>("sub", {}, (d) => got.push(d));
    t.receive({ id: t.sent[0].id, result: { stream: "s1" } });
    const unsub = await p;
    unsub();
    expect(t.sent[1]).toMatchObject({ method: "rpc.cancel", params: { stream: "s1" } });
    t.receive({ id: t.sent[1].id, result: {} });
    await flush();
    t.receive({ method: "event", params: { stream: "s1", data: 5 } });
    expect(got).toEqual([]);
  });

  it("ignores_invalid_json_and_null_id_errors", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const t = new FakeTransport();
    const c = new RpcClient(t);
    const p = c.call<string>("x");
    t.receiveRaw("not json {");
    t.receive({ id: null, error: { code: "parse_error", message: "bad" } });
    t.receive({ id: t.sent[0].id, result: "ok" });
    await expect(p).resolves.toBe("ok");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
