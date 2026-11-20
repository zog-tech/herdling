import { thumbLoader } from "./thumbs";

/** A fetch that the test ends by hand. */
function gate() {
  let open!: (v: string | null) => void;
  const p = new Promise<string | null>((r) => (open = r));
  return { fetch: jest.fn(() => p), open };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("thumbLoader", () => {
  it("runs at most `jobs` fetches at once, in order", async () => {
    const t = thumbLoader(2, 10);
    const [a, b, c] = [gate(), gate(), gate()];
    const pa = t.load("a", a.fetch);
    void t.load("b", b.fetch);
    const pc = t.load("c", c.fetch);
    await flush();
    expect(a.fetch).toHaveBeenCalled();
    expect(b.fetch).toHaveBeenCalled();
    expect(c.fetch).not.toHaveBeenCalled();
    a.open("data:a");
    expect(await pa).toBe("data:a");
    await flush();
    expect(c.fetch).toHaveBeenCalled();
    c.open(null);
    expect(await pc).toBeNull();
  });

  it("caches results and shares a pending load", async () => {
    const t = thumbLoader(1, 10);
    const a = gate();
    const p1 = t.load("a", a.fetch);
    const p2 = t.load("a", a.fetch);
    a.open("data:a");
    expect(await p1).toBe("data:a");
    expect(await p2).toBe("data:a");
    expect(a.fetch).toHaveBeenCalledTimes(1);
    expect(t.get("a")).toBe("data:a");
  });

  it("a failed fetch gives null", async () => {
    const t = thumbLoader(1, 10);
    expect(await t.load("x", () => Promise.reject(new Error("io")))).toBeNull();
    expect(t.get("x")).toBeNull();
  });

  it("drops the oldest entry past the cache size", async () => {
    const t = thumbLoader(1, 2);
    for (const k of ["a", "b", "c"]) await t.load(k, () => Promise.resolve(k));
    expect(t.get("a")).toBeUndefined();
    expect(t.get("c")).toBe("c");
  });
});
