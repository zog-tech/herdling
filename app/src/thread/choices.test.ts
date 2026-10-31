import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { answerChoice, destructiveKey, parseChoices, useChoices, type Choice } from "./choices";
import { labelMatches, shortLabel, yesNo } from "./parseChoices";

const mockCalls: { method: string; params: any }[] = [];
let mockScreen = "";
let mockReadFails = false;
const mockRpc = {
  call: async (method: string, params: any) => {
    mockCalls.push({ method, params });
    if (mockReadFails) throw new Error("herdr down");
    return { type: "pane_read", read: { text: mockScreen } };
  },
};
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc }),
}));

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", `${name}.txt`), "utf8");

describe("parseChoices", () => {
  it("bash_permission", () => {
    expect(parseChoices(fixture("claude_bash_permission"))).toEqual([
      { key: "1", label: "Yes", selected: true },
      { key: "2", label: "Yes, and don't ask again for git status commands in /home/sam/proj", selected: false },
      { key: "3", label: "No, and tell Claude what to do differently (esc)", selected: false },
    ]);
  });

  it("wrapped_labels_are_joined", () => {
    expect(parseChoices(fixture("claude_bash_permission_wrapped"))).toEqual([
      { key: "1", label: "Yes", selected: true },
      { key: "2", label: "Yes, and don't ask again for git status commands in /home/sam/proj", selected: false },
      { key: "3", label: "No, and tell Claude what to do differently (esc)", selected: false },
    ]);
  });

  it("a wrapped boxed label is joined", () => {
    const screen = ["│ ❯ 1. Yes                 │", "│   2. No, and tell Claude │", "│      what to do (esc)    │", "╰──────────────────────────╯"].join("\n");
    expect(parseChoices(screen)[1].label).toBe("No, and tell Claude what to do (esc)");
  });

  it("text at the choice indent ends the block", () => {
    expect(parseChoices("❯ 1. Yes\n  2. No\n  Esc to cancel")).toHaveLength(2);
    expect(parseChoices("  1. a\n  2. b\n  later text\n❯")).toEqual([]);
  });

  it("edit_permission", () => {
    const c = parseChoices(fixture("claude_edit_permission"));
    expect(c).toHaveLength(3);
    expect(c.map((x) => x.key)).toEqual(["1", "2", "3"]);
    expect(c[1]).toEqual({ key: "2", label: "Yes, allow all edits during this session (shift+tab)", selected: false });
  });

  it("numbered_prose_is_ignored", () => {
    expect(parseChoices(fixture("claude_numbered_prose"))).toEqual([]);
  });

  it("idle_prompt", () => {
    expect(parseChoices(fixture("claude_idle_prompt"))).toEqual([]);
  });

  it("boxed_lines_are_stripped", () => {
    const screen = ["╭────────────╮", "│ Proceed?   │", "│ ❯ 1. Yes   │", "│   2. No    │", "╰────────────╯"].join("\n");
    expect(parseChoices(screen)).toEqual([
      { key: "1", label: "Yes", selected: true },
      { key: "2", label: "No", selected: false },
    ]);
  });

  it("accepts the › and > markers", () => {
    expect(parseChoices("› 1. Allow\n  2. Deny")[0]).toEqual({ key: "1", label: "Allow", selected: true });
    expect(parseChoices("  1. Allow\n> 2. Deny")[1]).toEqual({ key: "2", label: "Deny", selected: true });
  });

  it("rejects a single choice", () => {
    expect(parseChoices("❯ 1. Yes")).toEqual([]);
  });

  it("rejects numbers that do not run from 1", () => {
    expect(parseChoices("❯ 2. Yes\n  3. No")).toEqual([]);
    expect(parseChoices("❯ 1. Yes\n  3. No")).toEqual([]);
  });

  it("rejects zero or two markers", () => {
    expect(parseChoices("❯ 1. Yes\n❯ 2. No")).toEqual([]);
  });

  it("uses only the last block", () => {
    const screen = "❯ 1. Old\n  2. Older\nsome text\n  1. Yes\n❯ 2. No";
    expect(parseChoices(screen).map((c) => c.label)).toEqual(["Yes", "No"]);
  });

  it("ignores a menu above the last 20 non-empty lines", () => {
    const filler = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    expect(parseChoices(`❯ 1. Yes\n  2. No\n${filler}`)).toEqual([]);
  });

  it("handles CRLF line ends", () => {
    expect(parseChoices("❯ 1. Yes\r\n  2. No\r\n")).toHaveLength(2);
  });
});

describe("destructiveKey", () => {
  it("is the last choice whose label starts with No", () => {
    expect(destructiveKey(parseChoices(fixture("claude_bash_permission")))).toBe("3");
  });
  it("is undefined when no label starts with No", () => {
    expect(destructiveKey([{ key: "1", label: "Allow", selected: true }, { key: "2", label: "Deny", selected: false }])).toBeUndefined();
  });
});

describe("yesNo and labels (same rules as companion/src/choices.rs)", () => {
  const c = (key: string, label: string, selected = false): Choice => ({ key, label, selected });

  it("takes the first Yes and the last No option", () => {
    expect(yesNo(parseChoices(fixture("claude_bash_permission")))).toEqual({
      yes: { key: "1", label: "Yes" },
      no: { key: "3", label: "No, and tell Claude what to do differently (esc)" },
    });
  });

  it("is null for another menu", () => {
    expect(yesNo([c("1", "Allow", true), c("2", "Deny")])).toBeNull();
    expect(yesNo([c("1", "Yesterday", true), c("2", "No")])).toBeNull();
    expect(yesNo([c("1", "Yes", true), c("2", "None of these")])).toBeNull();
    expect(yesNo([])).toBeNull();
  });

  it("cuts labels to 60 characters", () => {
    const long = `No, ${"é".repeat(80)}`;
    expect(Array.from(shortLabel(long))).toHaveLength(60);
    expect(shortLabel(long).endsWith("…")).toBe(true);
    expect(shortLabel("Yes")).toBe("Yes");
    expect(labelMatches(long, shortLabel(long))).toBe(true);
    expect(labelMatches("Yes, and don't ask again", "Yes")).toBe(false);
  });
});

describe("useChoices", () => {
  let latest: Choice[] = [];
  let tree: ReactTestRenderer | undefined;
  function Probe({ blocked }: { blocked: boolean }) {
    latest = useChoices("host-1", "w1:p1", blocked);
    return null;
  }
  const flush = async () => {
    for (let i = 0; i < 5; i++) await act(async () => {});
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockCalls.length = 0;
    mockReadFails = false;
    mockScreen = fixture("claude_bash_permission");
  });
  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
    jest.useRealTimers();
  });

  it("reads the visible screen every second while blocked", async () => {
    await act(async () => {
      tree = create(createElement(Probe, { blocked: true }));
    });
    await flush();
    expect(mockCalls[0]).toEqual({
      method: "herdr.call",
      params: { method: "pane.read", params: { pane_id: "w1:p1", source: "visible", format: "text" } },
    });
    expect(latest.map((c) => c.key)).toEqual(["1", "2", "3"]);

    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    await flush();
    expect(mockCalls).toHaveLength(2);
  });

  it("does not read and returns no choices when not blocked", async () => {
    await act(async () => {
      tree = create(createElement(Probe, { blocked: true }));
    });
    await flush();
    await act(async () => {
      tree!.update(createElement(Probe, { blocked: false }));
    });
    await flush();
    const n = mockCalls.length;
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(mockCalls).toHaveLength(n);
    expect(latest).toEqual([]);
  });

  it("clears the choices when a read fails", async () => {
    await act(async () => {
      tree = create(createElement(Probe, { blocked: true }));
    });
    await flush();
    expect(latest).toHaveLength(3);
    mockReadFails = true;
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    await flush();
    expect(latest).toEqual([]);
  });
});

describe("answerChoice", () => {
  class FakeRpc {
    calls: { method: string; params: any }[] = [];
    constructor(public screen: string) {}
    async call<T>(_m: string, p: any): Promise<T> {
      this.calls.push(p);
      return (p.method === "pane.read" ? { read: { text: this.screen } } : {}) as T;
    }
  }
  const shown = parseChoices(fixture("claude_bash_permission"));

  it("re-reads the screen and sends the bare digit when the menu is unchanged", async () => {
    const rpc = new FakeRpc(fixture("claude_bash_permission"));
    await expect(answerChoice(rpc, "w1:p1", shown, shown[0], () => true)).resolves.toBe("sent");
    expect(rpc.calls).toEqual([
      { method: "pane.read", params: { pane_id: "w1:p1", source: "visible", format: "text" } },
      { method: "pane.send_keys", params: { pane_id: "w1:p1", keys: ["1"] } },
    ]);
  });

  it("sends when only the marker moved", async () => {
    const rpc = new FakeRpc(fixture("claude_bash_permission").replace("❯ 1.", "  1.").replace("  2. Yes,", "❯ 2. Yes,"));
    await expect(answerChoice(rpc, "w1:p1", shown, shown[2], () => true)).resolves.toBe("sent");
  });

  it("sends nothing when the menu is gone", async () => {
    const rpc = new FakeRpc(fixture("claude_idle_prompt"));
    await expect(answerChoice(rpc, "w1:p1", shown, shown[0], () => true)).resolves.toBe("stale");
    expect(rpc.calls.map((c) => c.method)).toEqual(["pane.read"]);
  });

  it("sends nothing when the menu changed", async () => {
    const rpc = new FakeRpc(fixture("claude_edit_permission"));
    await expect(answerChoice(rpc, "w1:p1", shown, shown[0], () => true)).resolves.toBe("stale");
    expect(rpc.calls.map((c) => c.method)).toEqual(["pane.read"]);
  });

  it("sends nothing when the agent is no longer blocked", async () => {
    const rpc = new FakeRpc(fixture("claude_bash_permission"));
    await expect(answerChoice(rpc, "w1:p1", shown, shown[0], () => false)).resolves.toBe("stale");
    expect(rpc.calls.map((c) => c.method)).toEqual(["pane.read"]);
  });
});
