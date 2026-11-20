import type { FileImage, FileText } from "@herdling/protocol";

import { base64Bytes, failText, initialViewer, viewerReducer, type ViewerState } from "./viewerMachine";

const text: FileText = { path: "/home/sam/proj/a.md", name: "a.md", kind: "text", size: 3, text: "hi\n", truncated: false };
const img = (offset: number, data: string, eof: boolean, size = 6): FileImage => ({
  path: "/home/sam/proj/s.png",
  name: "s.png",
  kind: "image",
  size,
  mime: "image/png",
  offset,
  data_b64: data,
  eof,
});

function load(): ViewerState {
  return viewerReducer(initialViewer, { type: "load" }).state;
}

describe("viewerReducer", () => {
  it("load asks for the path with a new generation", () => {
    const r = viewerReducer(initialViewer, { type: "load" });
    expect(r.state).toEqual({ kind: "loading", gen: 1 });
    expect(r.effects).toEqual([{ type: "fetch", gen: 1, offset: 0 }]);
  });

  it("a text result is ready", () => {
    const r = viewerReducer(load(), { type: "result", gen: 1, result: text });
    expect(r.state).toEqual({ kind: "ready", gen: 1, file: text });
    expect(r.effects).toEqual([]);
  });

  it("ignores a reply of an old generation", () => {
    const s = viewerReducer(load(), { type: "load" }).state;
    expect(viewerReducer(s, { type: "result", gen: 1, result: text }).state).toBe(s);
    expect(viewerReducer(s, { type: "error", gen: 1, code: "io_error", message: "x" }).state).toBe(s);
  });

  it("an error fails the load, and a retry starts again", () => {
    const failed = viewerReducer(load(), { type: "error", gen: 1, code: "not_found", message: "no such file" }).state;
    expect(failed).toEqual({ kind: "failed", gen: 1, code: "not_found", message: "no such file" });
    const r = viewerReducer(failed, { type: "load" });
    expect(r.state).toEqual({ kind: "loading", gen: 2 });
    expect(r.effects).toEqual([{ type: "fetch", gen: 2, offset: 0 }]);
  });

  it("asks for the parts of an image and joins them", () => {
    // "AAAA" is 3 bytes; the image has 6.
    let r = viewerReducer(load(), { type: "result", gen: 1, result: img(0, "AAAA", false) });
    expect(r.state.kind).toBe("parts");
    expect(r.effects).toEqual([{ type: "fetch", gen: 1, offset: 3 }]);
    r = viewerReducer(r.state, { type: "result", gen: 1, result: img(3, "BBBB", true) });
    expect(r.state).toMatchObject({ kind: "ready", file: { kind: "image", data_b64: "AAAABBBB", eof: true } });
    expect(r.effects).toEqual([]);
  });

  it("a one-part image is ready at once", () => {
    const r = viewerReducer(load(), { type: "result", gen: 1, result: img(0, "AAAABBBB", true) });
    expect(r.state).toMatchObject({ kind: "ready", file: { data_b64: "AAAABBBB" } });
  });

  it("a too large image is ready with no bytes", () => {
    const big: FileImage = { path: "/a/b.png", name: "b.png", kind: "image", size: 30 << 20, mime: "image/png", too_large: true };
    expect(viewerReducer(load(), { type: "result", gen: 1, result: big }).state).toEqual({ kind: "ready", gen: 1, file: big });
  });

  it("a size change or an empty part fails", () => {
    const parts = viewerReducer(load(), { type: "result", gen: 1, result: img(0, "AAAA", false) }).state;
    expect(viewerReducer(parts, { type: "result", gen: 1, result: img(3, "BBBB", true, 9) }).state).toMatchObject({ kind: "failed", code: "changed" });
    expect(viewerReducer(parts, { type: "result", gen: 1, result: img(3, "", false) }).state).toMatchObject({ kind: "failed", code: "changed" });
    expect(viewerReducer(parts, { type: "result", gen: 1, result: text }).state).toMatchObject({ kind: "failed", code: "changed" });
  });

  it("an error while the parts come fails", () => {
    const parts = viewerReducer(load(), { type: "result", gen: 1, result: img(0, "AAAA", false) }).state;
    expect(viewerReducer(parts, { type: "error", gen: 1, code: "io_error", message: "gone" }).state).toMatchObject({ kind: "failed", code: "io_error" });
  });

  it("a reply after ready or failed changes nothing", () => {
    const ready = viewerReducer(load(), { type: "result", gen: 1, result: text }).state;
    expect(viewerReducer(ready, { type: "result", gen: 1, result: text }).state).toBe(ready);
    expect(viewerReducer(ready, { type: "error", gen: 1, code: "x", message: "" }).state).toBe(ready);
  });
});

describe("helpers", () => {
  it("base64Bytes", () => {
    expect(base64Bytes("")).toBe(0);
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AA==")).toBe(1);
    expect(base64Bytes("AAA=")).toBe(2);
  });

  it("failText", () => {
    expect(failText("not_found", "x")).toMatch(/does not exist/);
    expect(failText("unknown_method", "x")).toMatch(/Update herdlingd/);
    expect(failText("io_error", "permission denied")).toBe("permission denied");
  });
});
