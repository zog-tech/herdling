import { groupLetter, groupTone, helperParents, helperSummary, needsYouCount, repoLine } from "./tasks";

const a = (pane_id: string, parent_id?: string) => ({ pane_id, parent_id });

describe("helperParents", () => {
  it("puts a helper under its live parent", () => {
    expect([...helperParents([a("hc:t1"), a("hc:t2", "hc:t1")])]).toEqual([["hc:t2", "hc:t1"]]);
  });

  it("puts a helper of a helper under the top task", () => {
    const m = helperParents([a("hc:t1"), a("hc:t2", "hc:t1"), a("hc:t3", "hc:t2")]);
    expect(m.get("hc:t3")).toBe("hc:t1");
    expect(m.get("hc:t2")).toBe("hc:t1");
    expect(m.has("hc:t1")).toBe(false);
  });

  it("keeps an agent whose parent is gone, itself or a loop as a card", () => {
    const m = helperParents([a("hc:t1", "hc:t9"), a("hc:t2", "hc:t2"), a("hc:t3", "hc:t4"), a("hc:t4", "hc:t3"), a("hc:t5", "")]);
    expect(m.size).toBe(0);
  });
});

describe("helperSummary", () => {
  it("counts helpers and their work", () => {
    expect(helperSummary([])).toBeUndefined();
    expect(helperSummary([{ status: "idle" }])).toBe("1 helper");
    expect(helperSummary([{ status: "working" }, { status: "done" }])).toBe("2 helpers · 1 working");
    expect(helperSummary([{ status: "blocked" }, { status: "working" }, { status: "working" }])).toBe("3 helpers · 1 needs you · 2 working");
  });
});

describe("repoLine", () => {
  it("shows the repo and the branch", () => {
    expect(repoLine({ repo: "api", branch: "main", group: "Payments" })).toBe("api · main");
    expect(repoLine({ repo: "api", group: "Payments" })).toBe("api");
  });

  it("leaves out a repo with the name of the group", () => {
    expect(repoLine({ repo: "api", branch: "fix-login", group: "API " })).toBe("fix-login");
    expect(repoLine({ repo: "api", group: "api" })).toBeUndefined();
  });

  it("needs a repo", () => {
    expect(repoLine({ branch: "main", group: "x" })).toBeUndefined();
    expect(repoLine({ repo: " ", group: "x" })).toBeUndefined();
    expect(repoLine({})).toBeUndefined();
  });
});

describe("group tiles", () => {
  it("takes the first letter or digit", () => {
    expect(groupLetter("lumen-api")).toBe("L");
    expect(groupLetter("  9lives")).toBe("9");
    expect(groupLetter("--")).toBe("#");
    expect(groupLetter("éclair")).toBe("É");
  });

  it("gives a stable tone in range", () => {
    expect(groupTone("api", 8)).toBe(groupTone("API ", 8));
    for (const name of ["api", "web", "docs", "x", ""]) {
      const t = groupTone(name, 8);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(8);
    }
    expect(groupTone("api", 0)).toBe(0);
    // Not all names get the same tone.
    expect(new Set(["api", "web", "docs", "infra", "site", "app"].map((n) => groupTone(n, 8))).size).toBeGreaterThan(2);
  });
});

describe("needsYouCount", () => {
  it("counts the blocked agents of every host", () => {
    const s = (statuses: string[]) => ({ agents: statuses.map((st, i) => ({ pane_id: `p${i}`, agent_status: st })) }) as never;
    expect(needsYouCount([s(["blocked", "idle"]), undefined, s(["blocked", "blocked", "working"])])).toBe(3);
    expect(needsYouCount([])).toBe(0);
  });
});
