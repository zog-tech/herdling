import type { FsDirs } from "@herdling/protocol";

import { Autocomplete, AUTOCOMPLETE_DELAY_MS, type Suggestions } from "./autocomplete";
import { DirCache } from "./dirCache";

const HOME = "/home/sam";
const TREE: Record<string, string[]> = {
  [HOME]: ["apps", "Archive", ".config"],
  "/home/sam/apps": ["herdling", "herdr", "Helper", "api"],
};

function host() {
  const list = jest.fn(async (path: string, hidden: boolean): Promise<FsDirs> => {
    const dirs = TREE[path];
    if (!dirs) throw Object.assign(new Error("not found"), { code: "not_found" });
    return { path, dirs: dirs.filter((d) => hidden || !d.startsWith(".")), recent_cwds: [], git_dirs: path === "/home/sam/apps" ? ["herdling"] : [] };
  });
  return { list, cache: new DirCache(list) };
}

const ctx = { home: HOME, cwd: HOME, hidden: false };
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("Autocomplete", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("lists the parent of ~/apps/he and keeps the matching folders", async () => {
    const { list, cache } = host();
    const got: Suggestions[] = [];
    const ac = new Autocomplete(cache, (s) => got.push(s));
    ac.update("~/apps/he", ctx);
    jest.advanceTimersByTime(AUTOCOMPLETE_DELAY_MS);
    await flush();
    expect(list).toHaveBeenCalledWith("/home/sam/apps", false);
    expect(got.at(-1)).toEqual({
      input: "~/apps/he",
      items: [
        { name: "herdling", path: "/home/sam/apps/herdling", git: true },
        { name: "herdr", path: "/home/sam/apps/herdr", git: false },
        { name: "Helper", path: "/home/sam/apps/Helper", git: false },
      ],
    });
  });

  it("waits for a pause in typing (debounce) and asks once", async () => {
    const { list, cache } = host();
    const got: Suggestions[] = [];
    const ac = new Autocomplete(cache, (s) => got.push(s));
    ac.update("~/a", ctx);
    jest.advanceTimersByTime(AUTOCOMPLETE_DELAY_MS - 1);
    ac.update("~/ap", ctx);
    jest.advanceTimersByTime(AUTOCOMPLETE_DELAY_MS - 1);
    expect(list).not.toHaveBeenCalled();
    ac.update("~/app", ctx);
    jest.advanceTimersByTime(AUTOCOMPLETE_DELAY_MS);
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    expect(got).toEqual([{ input: "~/app", items: [{ name: "apps", path: "/home/sam/apps", git: false }] }]);
  });

  it("caches each folder: more typing in the same folder does not ask again", async () => {
    const { list, cache } = host();
    const ac = new Autocomplete(cache, () => {});
    for (const t of ["~/apps/h", "~/apps/he", "~/apps/her"]) {
      ac.update(t, ctx);
      jest.advanceTimersByTime(AUTOCOMPLETE_DELAY_MS);
      await flush();
    }
    expect(list).toHaveBeenCalledTimes(1);
    // A drop of the cache (pull to refresh) asks again.
    cache.invalidate();
    ac.update("~/apps/h", ctx);
    jest.advanceTimersByTime(AUTOCOMPLETE_DELAY_MS);
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("gives no suggestions for a folder that does not exist, and drops a cancelled answer", async () => {
    const { cache } = host();
    const got: Suggestions[] = [];
    const ac = new Autocomplete(cache, (s) => got.push(s));
    ac.update("~/nope/x", ctx);
    jest.advanceTimersByTime(AUTOCOMPLETE_DELAY_MS);
    await flush();
    expect(got).toEqual([{ input: "~/nope/x", items: [] }]);
    ac.update("~/apps/h", ctx);
    jest.advanceTimersByTime(AUTOCOMPLETE_DELAY_MS);
    ac.cancel();
    await flush();
    expect(got).toHaveLength(1);
  });
});

describe("DirCache", () => {
  it("shares one request, forgets failures, and expires entries", async () => {
    let now = 0;
    const list = jest.fn(async (path: string): Promise<FsDirs> => {
      if (path === "/bad") throw new Error("no");
      return { path, dirs: [], recent_cwds: [] };
    });
    const cache = new DirCache(list, 1000, () => now);
    await Promise.all([cache.get("/a"), cache.get("/a")]);
    expect(list).toHaveBeenCalledTimes(1);
    // Hidden mode is its own listing.
    await cache.get("/a", true);
    expect(list).toHaveBeenCalledTimes(2);
    await expect(cache.get("/bad")).rejects.toThrow("no");
    await expect(cache.get("/bad")).rejects.toThrow("no");
    expect(list).toHaveBeenCalledTimes(4);
    now = 1000;
    await cache.get("/a");
    expect(list).toHaveBeenCalledTimes(5);
  });
});
