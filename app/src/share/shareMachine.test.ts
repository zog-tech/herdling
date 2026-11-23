import { CANCELED_MESSAGE, initialShareState, shareReducer, type ShareState } from "./shareMachine";

const target = { hostId: "h1", paneId: "p1" };

describe("shareReducer", () => {
  it("delivers at once when there is nothing to upload", () => {
    const r = shareReducer(initialShareState, { type: "send", target, uploads: false });
    expect(r.state).toEqual({ phase: "done", gen: 0, target });
    expect(r.effects).toEqual([{ type: "deliver", target, paths: [] }]);
  });

  it("uploads first, then delivers with the paths", () => {
    const up = shareReducer(initialShareState, { type: "send", target, uploads: true });
    expect(up.state).toEqual({ phase: "uploading", gen: 1, target });
    expect(up.effects).toEqual([{ type: "upload", gen: 1, target }]);
    const done = shareReducer(up.state, { type: "uploaded", gen: 1, paths: ["/up/a.jpg"] });
    expect(done.state).toEqual({ phase: "done", gen: 1, target });
    expect(done.effects).toEqual([{ type: "deliver", target, paths: ["/up/a.jpg"] }]);
  });

  it("goes back to editing with the error when the upload fails", () => {
    const up = shareReducer(initialShareState, { type: "send", target, uploads: true }).state;
    const r = shareReducer(up, { type: "uploadFailed", gen: 1, message: "Upload failed, nothing sent: disk full" });
    expect(r.state).toEqual({ phase: "editing", gen: 1, error: "Upload failed, nothing sent: disk full" });
    expect(r.effects).toEqual([]);
  });

  it("cancels the upload and ignores its late result", () => {
    const up = shareReducer(initialShareState, { type: "send", target, uploads: true }).state;
    const canceled = shareReducer(up, { type: "cancel" });
    expect(canceled.state).toEqual({ phase: "editing", gen: 1, error: CANCELED_MESSAGE });
    expect(canceled.effects).toEqual([{ type: "abort" }]);
    expect(shareReducer(canceled.state, { type: "uploaded", gen: 1, paths: ["/x"] }).state).toBe(canceled.state);
    // A second send starts a new generation: the result of the first upload does nothing.
    const again = shareReducer(canceled.state, { type: "send", target, uploads: true }).state;
    expect(again).toEqual({ phase: "uploading", gen: 2, target });
    expect(shareReducer(again, { type: "uploaded", gen: 1, paths: ["/x"] }).state).toBe(again);
    expect(shareReducer(again, { type: "uploadFailed", gen: 1, message: "old" }).state).toBe(again);
  });

  it("ignores events that cannot happen in a state", () => {
    const editing: ShareState = initialShareState;
    expect(shareReducer(editing, { type: "cancel" })).toEqual({ state: editing, effects: [] });
    expect(shareReducer(editing, { type: "uploaded", gen: 0, paths: [] }).state).toBe(editing);
    const uploading = shareReducer(editing, { type: "send", target, uploads: true }).state;
    // A second tap during the upload does nothing.
    expect(shareReducer(uploading, { type: "send", target, uploads: true })).toEqual({ state: uploading, effects: [] });
    const done: ShareState = { phase: "done", gen: 1, target };
    expect(shareReducer(done, { type: "send", target, uploads: false }).state).toBe(done);
    expect(shareReducer(done, { type: "cancel" }).state).toBe(done);
  });
});
