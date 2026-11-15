import { searchOp } from "./search";

describe("searchOp", () => {
  it("a new query looks up from the end", () => {
    expect(searchOp(undefined, { term: "err", index: -1 }, 0)).toBe("prev");
    expect(searchOp({ term: "er", index: -1 }, { term: "err", index: -1 }, 4)).toBe("prev");
  });
  it("an empty box clears, once", () => {
    expect(searchOp({ term: "err", index: 2 }, { term: "", index: -1 }, 4)).toBe("clear");
    expect(searchOp({ term: "", index: -1 }, { term: " ", index: -1 }, 0)).toBeNull();
  });
  it("steps one match, with wrap", () => {
    expect(searchOp({ term: "x", index: -1 }, { term: "x", index: 2 }, 4)).toBe("prev");
    expect(searchOp({ term: "x", index: 1 }, { term: "x", index: 2 }, 4)).toBe("next");
    expect(searchOp({ term: "x", index: 3 }, { term: "x", index: 0 }, 4)).toBe("next");
    expect(searchOp({ term: "x", index: 0 }, { term: "x", index: 3 }, 4)).toBe("prev");
  });
  it("no change: no call", () => {
    expect(searchOp({ term: "x", index: -1 }, { term: "x", index: 3 }, 4)).toBeNull();
  });
});
