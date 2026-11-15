import {
  chunkB64,
  encodeToWeb,
  MAX_OUTBOX_B64,
  OUTBOX_START,
  outboxReducer,
  parseFromWeb,
  VT_START,
  vtNewStream,
  vtReducer,
  type Outbox,
  type ToWeb,
  type VtState,
} from "./bridge";

describe("parseFromWeb", () => {
  it("reads each known message", () => {
    expect(parseFromWeb('{"type":"ready"}')).toEqual({ type: "ready" });
    expect(parseFromWeb('{"type":"buffer","alternate":true,"atBottom":false}')).toEqual({ type: "buffer", alternate: true, atBottom: false });
    expect(parseFromWeb('{"type":"search","index":2,"count":5}')).toEqual({ type: "search", index: 2, count: 5 });
    expect(parseFromWeb('{"type":"text","text":"a\\nb"}')).toEqual({ type: "text", text: "a\nb" });
    expect(
      parseFromWeb('{"type":"metrics","cellWidth":7.2,"cellHeight":16,"fontSize":12,"width":390,"height":600}'),
    ).toEqual({ type: "metrics", cellWidth: 7.2, cellHeight: 16, fontSize: 12, width: 390, height: 600 });
  });

  it("drops bad or unknown messages", () => {
    expect(parseFromWeb("not json")).toBeNull();
    expect(parseFromWeb("null")).toBeNull();
    expect(parseFromWeb('{"type":"keys","data":"rm -rf"}')).toBeNull();
    expect(parseFromWeb('{"type":"buffer","alternate":"yes","atBottom":true}')).toBeNull();
    expect(parseFromWeb('{"type":"metrics","cellWidth":0,"cellHeight":16,"fontSize":12,"width":1,"height":1}')).toBeNull();
    expect(parseFromWeb('{"type":"text"}')).toBeNull();
  });
});

describe("chunkB64", () => {
  it("keeps a short text in one part", () => {
    expect(chunkB64("QUJD", 8)).toEqual(["QUJD"]);
  });
  it("cuts on whole base64 groups", () => {
    const parts = chunkB64("QUJDREVGR0hJSktM", 10);
    expect(parts).toEqual(["QUJDREVG", "R0hJSktM"]);
    parts.forEach((p) => expect(p.length % 4).toBe(0));
  });
});

const reset = (gen: number, cols = 80, rows = 24) => ({ vt: "reset" as const, gen, seq: 0, cols, rows });
const data = (gen: number, seq: number, d = "QQ==") => ({ vt: "data" as const, gen, seq, data: d });

describe("vtReducer", () => {
  it("a reset starts an epoch and data follows in order", () => {
    let s: VtState = VT_START;
    let r = vtReducer(s, reset(1));
    expect(r.out).toEqual([{ type: "reset", e: 1, cols: 80, rows: 24 }]);
    s = r.state;
    r = vtReducer(s, data(1, 1));
    expect(r.out).toEqual([{ type: "data", e: 1, b64: "QQ==" }]);
    r = vtReducer(r.state, { vt: "resize", gen: 1, seq: 2, cols: 45, rows: 30 });
    expect(r.out).toEqual([{ type: "resize", e: 1, cols: 45, rows: 30 }]);
    expect(r.restart).toBe(false);
  });

  it("drops bytes before the first reset", () => {
    expect(vtReducer(VT_START, data(1, 1)).out).toEqual([]);
  });

  it("drops stale bytes of an old attach after a reattach", () => {
    let s = vtReducer(VT_START, reset(1)).state;
    s = vtReducer(s, reset(2)).state;
    expect(s.epoch).toBe(2);
    const r = vtReducer(s, data(1, 1));
    expect(r.out).toEqual([]);
    expect(r.restart).toBe(false);
    // A late reset of the old attach changes nothing.
    expect(vtReducer(s, reset(1)).out).toEqual([]);
  });

  it("a gap in seq asks for a new stream", () => {
    const s = vtReducer(VT_START, reset(1)).state;
    const r = vtReducer(s, data(1, 2));
    expect(r.restart).toBe(true);
    expect(r.out).toEqual([]);
  });

  it("a new stream starts its gens again but keeps the epoch growing", () => {
    let s = vtReducer(VT_START, reset(3)).state;
    s = vtNewStream(s);
    const r = vtReducer(s, reset(1));
    expect(r.out).toEqual([{ type: "reset", e: 2, cols: 80, rows: 24 }]);
  });

  it("cuts a big data event", () => {
    const s = vtReducer(VT_START, reset(1)).state;
    const r = vtReducer(s, data(1, 1, "A".repeat(600 * 1024)));
    expect(r.out.length).toBe(3);
    expect(r.out.every((m) => m.type === "data" && m.e === 1)).toBe(true);
  });

  it("an error or close ends the stream", () => {
    expect(vtReducer(VT_START, { error: "pane_not_found", message: "gone" }).end).toEqual({ error: "pane_not_found", message: "gone" });
    expect(vtReducer(VT_START, { closed: true }).end).toEqual({});
  });
});

const send = (box: Outbox, msg: ToWeb) => outboxReducer(box, { type: "send", msg });

describe("outboxReducer", () => {
  it("keeps messages in order until the page is ready", () => {
    let box = OUTBOX_START;
    box = send(box, { type: "theme", theme: { background: "#000000" } }).box;
    box = send(box, { type: "reset", e: 1, cols: 80, rows: 24 }).box;
    box = send(box, { type: "data", e: 1, b64: "QQ==" }).box;
    box = send(box, { type: "data", e: 1, b64: "Qg==" }).box;
    const r = outboxReducer(box, { type: "ready" });
    expect(r.post.map((p) => JSON.parse(p).type)).toEqual(["theme", "reset", "data", "data"]);
    expect(JSON.parse(r.post[3]).b64).toBe("Qg==");
    expect(r.restart).toBe(false);
    // Ready: the next message goes at once.
    expect(send(r.box, { type: "scrollToBottom" }).post).toEqual([encodeToWeb({ type: "scrollToBottom" })]);
  });

  it("a reset drops the stream messages before it; a theme replaces the waiting one", () => {
    let box = OUTBOX_START;
    box = send(box, { type: "theme", theme: { background: "#000000" } }).box;
    box = send(box, { type: "reset", e: 1, cols: 80, rows: 24 }).box;
    box = send(box, { type: "data", e: 1, b64: "QQ==" }).box;
    box = send(box, { type: "reset", e: 2, cols: 40, rows: 10 }).box;
    box = send(box, { type: "theme", theme: { background: "#ffffff" } }).box;
    box = send(box, { type: "scrollPages", n: -1 }).box;
    const msgs = outboxReducer(box, { type: "ready" }).post.map((p) => JSON.parse(p));
    expect(msgs).toEqual([
      { type: "reset", e: 2, cols: 40, rows: 10 },
      { type: "theme", theme: { background: "#ffffff" } },
    ]);
  });

  it("too much waiting data overflows and asks for a new stream on ready", () => {
    let box = send(OUTBOX_START, { type: "reset", e: 1, cols: 80, rows: 24 }).box;
    const big = "A".repeat(256 * 1024);
    for (let i = 0; i * big.length <= MAX_OUTBOX_B64; i++) box = send(box, { type: "data", e: 1, b64: big }).box;
    expect(box.overflow).toBe(true);
    box = send(box, { type: "data", e: 1, b64: "QQ==" }).box;
    const r = outboxReducer(box, { type: "ready" });
    expect(r.restart).toBe(true);
    expect(r.post).toEqual([]);
  });

  it("a page reload empties the outbox and asks for a new stream", () => {
    const ready = outboxReducer(OUTBOX_START, { type: "ready" }).box;
    const r = outboxReducer(ready, { type: "unload" });
    expect(r.box).toEqual(OUTBOX_START);
    expect(r.restart).toBe(true);
  });
});
