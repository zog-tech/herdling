import { columnAction, layoutClass, REGULAR_MIN_WIDTH, selectionFromParams, sessionFromPath, stepKey } from "./layout";

describe("layoutClass", () => {
  it("is compact below the breakpoint and regular from it", () => {
    expect(layoutClass(0)).toBe("compact");
    expect(layoutClass(375)).toBe("compact");
    // The largest iPhone in portrait.
    expect(layoutClass(440)).toBe("compact");
    // Split View 1/3 on a 13" iPad.
    expect(layoutClass(507)).toBe("compact");
    expect(layoutClass(REGULAR_MIN_WIDTH - 0.5)).toBe("compact");
    expect(layoutClass(REGULAR_MIN_WIDTH)).toBe("regular");
    // An 11" iPad in portrait, a 13" iPad in landscape.
    expect(layoutClass(834)).toBe("regular");
    expect(layoutClass(1376)).toBe("regular");
    // A Pro Max iPhone in landscape.
    expect(layoutClass(956)).toBe("regular");
  });
});

describe("sessionFromPath", () => {
  it("reads the pane of a session path", () => {
    expect(sessionFromPath("/session/h1/p1")).toEqual({ hostId: "h1", paneId: "p1" });
    expect(sessionFromPath("/session/h%201/p%3A2?from=push")).toEqual({ hostId: "h 1", paneId: "p:2" });
  });

  it("is null for other paths", () => {
    expect(sessionFromPath(undefined)).toBeNull();
    expect(sessionFromPath("/")).toBeNull();
    expect(sessionFromPath("/session/h1")).toBeNull();
    expect(sessionFromPath("/peek/h1/p1")).toBeNull();
    expect(sessionFromPath("/session/h1/p1/extra")).toBeNull();
  });
});

describe("selectionFromParams", () => {
  it("needs a host and a pane", () => {
    expect(selectionFromParams({ host: "h", pane: "p" })).toEqual({ hostId: "h", paneId: "p" });
    expect(selectionFromParams({ host: "h" })).toBeNull();
    expect(selectionFromParams({ host: "", pane: "p" })).toBeNull();
    expect(selectionFromParams({ host: ["h"], pane: "p" })).toBeNull();
  });
});

describe("columnAction", () => {
  const pane = { hostId: "h", paneId: "p" };

  it("moves a session route into the column in regular width", () => {
    expect(columnAction("regular", "compact", "/session/h/p", null)).toEqual({ type: "toColumn", pane });
    // A push or a deep link with no layout change.
    expect(columnAction("regular", "regular", "/session/h/p", null)).toEqual({ type: "toColumn", pane });
    // The first check after launch.
    expect(columnAction("regular", undefined, "/session/h/p", null)).toEqual({ type: "toColumn", pane });
  });

  it("does nothing else in regular width", () => {
    expect(columnAction("regular", "compact", "/", pane)).toEqual({ type: "none" });
    expect(columnAction("regular", "regular", "/usage", null)).toEqual({ type: "none" });
    expect(columnAction("regular", "regular", "/changes/h/p", null)).toEqual({ type: "none" });
  });

  it("pushes the selected session when regular becomes compact on Overview", () => {
    expect(columnAction("compact", "regular", "/", pane)).toEqual({ type: "toRoute", pane });
  });

  it("does nothing in compact width otherwise", () => {
    // A phone: the session route stays as it is.
    expect(columnAction("compact", "compact", "/session/h/p", null)).toEqual({ type: "none" });
    expect(columnAction("compact", undefined, "/", pane)).toEqual({ type: "none" });
    expect(columnAction("compact", "compact", "/", pane)).toEqual({ type: "none" });
    // No selection, or another tab on screen.
    expect(columnAction("compact", "regular", "/", null)).toEqual({ type: "none" });
    expect(columnAction("compact", "regular", "/usage", pane)).toEqual({ type: "none" });
  });
});

describe("stepKey", () => {
  const keys = ["a", "b", "c"];

  it("moves one step and stops at the ends", () => {
    expect(stepKey(keys, "b", 1)).toBe("c");
    expect(stepKey(keys, "b", -1)).toBe("a");
    expect(stepKey(keys, "c", 1)).toBe("c");
    expect(stepKey(keys, "a", -1)).toBe("a");
  });

  it("starts at an end with no current key", () => {
    expect(stepKey(keys, undefined, 1)).toBe("a");
    expect(stepKey(keys, undefined, -1)).toBe("c");
    expect(stepKey(keys, "gone", 1)).toBe("a");
    expect(stepKey([], undefined, 1)).toBeUndefined();
  });
});
