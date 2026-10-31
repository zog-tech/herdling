import type { ThreadItem } from "@herdling/protocol";

import { countLabel, excerpt, findMatches, itemText, normalizeQuery, step } from "./search";

const items: ThreadItem[] = [
  { kind: "user", id: "u1", ts: 1, text: "Fix the Login page" },
  { kind: "assistant", id: "a1", ts: 2, markdown: "I will look at **login.tsx** first." },
  { kind: "tool", id: "t1", ts: 3, name: "Bash", input_summary: "pnpm test", input: {}, result: { ok: false, text: "FAIL login.test.ts", truncated: false } },
  { kind: "thinking", id: "k1", ts: 4, text: null },
  { kind: "subagent", id: "s1", ts: 5, agent_id: "x", description: "Search the auth code", status: "done", result_summary: "Found the LOGIN form" },
  { kind: "system", id: "y1", ts: 6, text: "Conversation compacted." },
];

describe("findMatches", () => {
  it("finds items in any case, oldest first, in tool output and subagent results too", () => {
    expect(findMatches(items, "login")).toEqual(["u1", "a1", "t1", "s1"]);
    expect(findMatches(items, "  LOGIN ")).toEqual(["u1", "a1", "t1", "s1"]);
    expect(findMatches(items, "pnpm")).toEqual(["t1"]);
    expect(findMatches(items, "compacted")).toEqual(["y1"]);
  });

  it("gives nothing for an empty query or no match", () => {
    expect(findMatches(items, "   ")).toEqual([]);
    expect(findMatches(items, "zebra")).toEqual([]);
  });

  it("stays fast on a long thread", () => {
    const long: ThreadItem[] = Array.from({ length: 5000 }, (_, i) => ({ kind: "assistant", id: `a${i}`, ts: i, markdown: `Reply number ${i} with some text` }));
    const t0 = Date.now();
    for (let k = 0; k < 20; k++) findMatches(long, `number ${k}9`);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(findMatches(long, "number 4999")).toEqual(["a4999"]);
  });
});

describe("helpers", () => {
  it("reads the text of each kind", () => {
    expect(itemText(items[2])).toBe("Bash\npnpm test\nFAIL login.test.ts");
    expect(itemText(items[3])).toBe("");
    expect(normalizeQuery("  Ab ")).toBe("ab");
  });

  it("makes a one-line excerpt around the match", () => {
    expect(excerpt("short LOGIN text", "login")).toEqual({ before: "short ", match: "LOGIN", after: " text" });
    const long = `${"a".repeat(80)} needle\n\nsecond ${"b".repeat(80)}`;
    const e = excerpt(long, "needle")!;
    expect(e.before.startsWith("…")).toBe(true);
    expect(e.after.endsWith("…")).toBe(true);
    expect(e.after).toContain(" second ");
    expect(excerpt("text", "zebra")).toBeUndefined();
  });

  it("steps through the matches and wraps", () => {
    expect(step(-1, 3, -1)).toBe(2);
    expect(step(2, 3, -1)).toBe(1);
    expect(step(0, 3, -1)).toBe(2);
    expect(step(2, 3, 1)).toBe(0);
    expect(step(0, 0, 1)).toBe(-1);
  });

  it("labels the count", () => {
    expect(countLabel(0, 0, "")).toBe("");
    expect(countLabel(-1, 0, "x")).toBe("No matches");
    expect(countLabel(2, 12, "x")).toBe("3 of 12");
  });
});
