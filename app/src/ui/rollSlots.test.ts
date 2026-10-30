import { rollSlots } from "./rollSlots";

describe("rollSlots", () => {
  it("keys slots from the end, so only the changed digit gets a new key", () => {
    const a = rollSlots("9s").map((s) => s.key);
    const b = rollSlots("10s").map((s) => s.key);
    expect(a).toEqual(["1:9", "0:s"]);
    expect(b).toEqual(["2:1", "1:0", "0:s"]);
  });

  it("keeps the key of a character that did not change", () => {
    const a = rollSlots("1m 4s").map((s) => s.key);
    const b = rollSlots("1m 5s").map((s) => s.key);
    expect(a.filter((k) => b.includes(k))).toEqual(["4:1", "3:m", "2: ", "0:s"]);
  });
});
