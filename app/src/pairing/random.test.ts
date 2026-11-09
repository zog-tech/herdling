import { randomBytes } from "./random";

type G = { crypto?: unknown; expo?: unknown };
const g = globalThis as G;

describe("randomBytes", () => {
  const saved = { crypto: g.crypto, expo: g.expo };
  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: saved.crypto, configurable: true, writable: true });
    g.expo = saved.expo;
  });
  const noCrypto = () => Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });

  it("uses_get_random_values_when_present", () => {
    const b = randomBytes(32);
    expect(b).toHaveLength(32);
    expect(randomBytes(32)).not.toEqual(b);
  });

  it("falls_back_to_native_uuids", () => {
    noCrypto();
    let n = 0;
    g.expo = { uuidv4: () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}` };
    const a = randomBytes(80);
    expect(a).toHaveLength(80);
    expect(n).toBe(10);
    expect(randomBytes(16)).not.toEqual(a.subarray(0, 16));
  });

  it("refuses_a_broken_or_missing_source", () => {
    noCrypto();
    g.expo = { uuidv4: () => "00000000-0000-4000-8000-000000000000" };
    expect(() => randomBytes(16)).toThrow(/does not work/);
    g.expo = { uuidv4: () => "not a uuid" };
    expect(() => randomBytes(16)).toThrow(/does not work/);
    g.expo = undefined;
    expect(() => randomBytes(16)).toThrow(/no secure random source/);
  });
});
