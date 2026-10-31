import type { RecentSession } from "@herdling/protocol";

import { loadRecentSessions, mergeRecentSessions, recentFolders, SESSION_FOLDERS } from "./recents";

const HOME = "/home/sam";
const s = (session: string, last_activity: number, cwd = "/home/sam/a"): RecentSession => ({ session, first_prompt: session, last_activity, cwd });

describe("recentFolders", () => {
  it("keeps the newest-first order, drops repeats and empty paths, and caps the count", () => {
    const got = recentFolders(["/home/sam/b", "/home/sam/a/", "", "/home/sam/b", "/home/sam/a", HOME, "/srv/x"], HOME, 3);
    expect(got).toEqual([
      { path: "/home/sam/b", label: "b", display: "~/b" },
      { path: "/home/sam/a", label: "a", display: "~/a" },
      { path: HOME, label: "~", display: "~" },
    ]);
    expect(recentFolders(["/"], HOME)).toEqual([{ path: "/", label: "/", display: "/" }]);
  });
});

describe("recent sessions", () => {
  it("merges folders newest first, each session once", () => {
    const got = mergeRecentSessions([[s("x", 10), s("y", 30)], [s("z", 20), s("x", 15)]]);
    expect(got.map((r) => [r.session, r.last_activity])).toEqual([
      ["y", 30],
      ["z", 20],
      ["x", 15],
    ]);
    expect(mergeRecentSessions([[s("a", 1), s("b", 2), s("c", 3)]], 2).map((r) => r.session)).toEqual(["c", "b"]);
  });

  it("asks the newest folders for the chosen kind and ignores a failed folder", async () => {
    const call = jest.fn(async (_m: string, p: { cwd: string; kind: string; limit: number }) => {
      if (p.cwd === "/bad") throw new Error("io_error");
      return [s(`${p.kind}-${p.cwd}`, p.cwd.length, p.cwd)];
    });
    const cwds = ["/home/sam/long-name", "/bad", "/c", "/dd", "/never"];
    const got = await loadRecentSessions({ call } as never, "codex", cwds);
    expect(call).toHaveBeenCalledTimes(SESSION_FOLDERS);
    expect(call.mock.calls[0][1]).toMatchObject({ kind: "codex", cwd: "/home/sam/long-name" });
    expect(got.map((r) => r.cwd)).toEqual(["/home/sam/long-name", "/dd", "/c"]);
  });
});
