import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { answerChoice, destructiveKey, parseChoices, useChoices, type Choice } from "./choices";
import { choiceView, isFreeform, labelMatches, menuQuestion, parseMenu, shortLabel, yesNo } from "./parseChoices";

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

describe("ask_user_question (display data, app only)", () => {
  const screen = fixture("claude_ask_user_question");

  it("keeps the joined labels of the Rust port", () => {
    expect(parseChoices(screen)).toEqual([
      {
        key: "1",
        label:
          "Run tests in parallel (Recommended) Jest runs the test files on four workers, so the run takes about a quarter of the time. I change the config and run the suite again.",
        selected: true,
      },
      {
        key: "2",
        label:
          "Keep config, skip slow tests Make no config change. I mark the three slowest tests as skipped, so the run is faster, but those tests do not run.",
        selected: false,
      },
      {
        key: "3",
        label: "Mock the network Replace the real network calls with a mock server. This needs a new test helper.",
        selected: false,
      },
      { key: "4", label: "Type something.", selected: false },
      { key: "5", label: "Chat about this", selected: false },
    ]);
  });

  it("parseMenu adds the parts and the question, with the same labels", () => {
    const menu = parseMenu(screen);
    expect(menu.question).toBe("Which fix do you want for the slow test run?");
    expect(menu.choices.map((c) => c.label)).toEqual(parseChoices(screen).map((c) => c.label));
    expect(menu.choices[0].parts).toEqual([
      "Run tests in parallel (Recommended)",
      "Jest runs the test files on four workers, so the run takes about a",
      "quarter of the time. I change the config and run the suite again.",
    ]);
    expect(menu.choices[3].parts).toEqual(["Type something."]);
  });

  it("choiceView splits title and detail and flags Recommended", () => {
    const [first, second, , typeIt] = parseMenu(screen).choices;
    expect(choiceView(first)).toEqual({
      title: "Run tests in parallel",
      detail: "Jest runs the test files on four workers, so the run takes about a quarter of the time. I change the config and run the suite again.",
      recommended: true,
    });
    expect(choiceView(second).recommended).toBe(false);
    expect(choiceView(second).title).toBe("Keep config, skip slow tests");
    expect(choiceView(typeIt)).toEqual({ title: "Type something.", detail: undefined, recommended: false });
  });

  it("isFreeform finds the built-in options only", () => {
    expect(parseMenu(screen).choices.map(isFreeform)).toEqual([false, false, false, true, true]);
    const c = (label: string): Choice => ({ key: "1", label, selected: false });
    expect(isFreeform(c("Type something"))).toBe(true);
    expect(isFreeform(c("chat about this"))).toBe(true);
    expect(isFreeform(c("Type something else here"))).toBe(false);
  });

  it("choiceView without parts uses the label", () => {
    expect(choiceView({ key: "1", label: "Yes (Recommended)", selected: true })).toEqual({ title: "Yes", detail: undefined, recommended: true });
  });
});

describe("menuQuestion", () => {
  it("is the line above a permission menu", () => {
    expect(menuQuestion(fixture("claude_bash_permission"))).toBe("Do you want to proceed?");
    expect(menuQuestion(fixture("claude_edit_permission"))).toBe("Do you want to make this edit to main.rs?");
  });

  it("is undefined with no menu, or with only a rule or a mark above it", () => {
    expect(menuQuestion(fixture("claude_idle_prompt"))).toBeUndefined();
    expect(menuQuestion("────────\n❯ 1. Yes\n  2. No")).toBeUndefined();
    expect(menuQuestion("╭────╮\n│ ❯ 1. Yes │\n│   2. No  │")).toBeUndefined();
    expect(menuQuestion("❯ 1. Yes\n  2. No")).toBeUndefined();
  });

  it("joins up to 3 lines of a paragraph and marks a longer one", () => {
    expect(menuQuestion("Which file\nshould I open?\n\n❯ 1. a\n  2. b")).toBe("Which file should I open?");
    expect(menuQuestion("one\ntwo\nthree\nfour?\n❯ 1. a\n  2. b")).toBe("…two three four?");
  });

  it("parseMenu of the permission fixtures keeps the labels", () => {
    for (const name of [
      "claude_bash_permission",
      "claude_bash_permission_wrapped",
      "claude_edit_permission",
      "claude_bash_permission_heredoc",
      "claude_bash_permission_rm",
      "claude_bash_permission_subagent",
    ]) {
      const s = fixture(name);
      expect(parseMenu(s).choices.map(({ key, label, selected }) => ({ key, label, selected }))).toEqual(parseChoices(s));
    }
  });
});

describe("parseMenu context", () => {
  it("is the command and the warning of a subagent prompt with no title on the screen", () => {
    const menu = parseMenu(fixture("claude_bash_permission_subagent"));
    expect(menu.question).toBe("Do you want to proceed?");
    expect(menu.choices.map((c) => c.label)).toEqual(["Yes", "No"]);
    expect(menu.context).toBe(
      [
        "cd /home/sam/proj/.claude/worktrees/agent-a71f/production",
        "p='pages/Subscriptions.tsx'",
        "s=open(p).read()",
        "def rep(a,b,n=1):",
        "    global s",
        "    assert s.count(a)==n, (s.count(a), a[:70])",
        "    s=s.replace(a,b)",
        'rep("const { isProUser } = useUserData();",',
        '    "const { isProUser, pricingCurrency } = useUserData();")',
        "open(p,'w').write(s)",
        "EOF",
        "Dangerous rm operation not ruled out — the shell may read this command differently than it was",
      ].join("\n"),
    );
  });

  it("is the body of a prompt between the frame rule and the question", () => {
    expect(parseMenu(fixture("claude_bash_permission")).context).toBe("Bash command\n\n  git status\n  Show working tree status");
    expect(parseMenu(fixture("claude_bash_permission_wrapped")).context).toBe("Bash command\n\n  git status\n  Show working tree status");
    expect(parseMenu(fixture("claude_bash_permission_heredoc")).context).toBe(
      [
        "Bash command",
        'Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
        "Run a Python heredoc that prints hi",
        "python3 - <<'EOF'",
        "print('hi')",
        "EOF",
        "This command requires approval",
      ].join("\n"),
    );
  });

  it("stops the question at a dashed rule right above it", () => {
    const menu = parseMenu(fixture("claude_bash_permission_rm"));
    expect(menu.question).toBe("Do you want to proceed?");
    expect(menu.context).toBe(
      ["Bash command", 'Tip: auto mode handles these prompts for you — choose "switch to auto mode" below', "Remove the tmpdir3 folder if it exists", "rm -rf ./tmpdir3"].join("\n"),
    );
    expect(menu.choices.map((c) => c.key)).toEqual(["1", "2", "3", "4"]);
  });

  it("strips the side bars of a box and keeps the indent of the diff", () => {
    const context = parseMenu(fixture("claude_edit_permission")).context!;
    expect(context.split("\n").slice(0, 4)).toEqual(["Edit file", "src/main.rs", "", "1   fn main() {"]);
    expect(context).toContain('2 -     println!("hello");');
    expect(context).not.toMatch(/[│╭╮╰╯─]/);
  });

  it("strips | side bars only when every line has one", () => {
    const boxed = "+--------+\n| Bash command\n|   ls | wc -l\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No";
    expect(parseMenu(boxed).context).toBe("Bash command\n  ls | wc -l");
    const piped = "────────\nls\n  | wc -l\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No";
    expect(parseMenu(piped).context).toBe("ls\n  | wc -l");
  });

  it("keeps the last 60 lines of a long prompt", () => {
    const body = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
    const context = parseMenu(`────────\n${body}\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No`).context!.split("\n");
    expect(context).toHaveLength(60);
    expect(context[59]).toBe("line 79");
  });

  it("is undefined for other menus", () => {
    expect(parseMenu(fixture("claude_ask_user_question")).context).toBeUndefined();
  });

  it("is the title and the path of a read outside the working directories", () => {
    const menu = parseMenu(fixture("claude_read_outside"));
    expect(menu.question).toBe("Allow this read outside the working directories?");
    expect(menu.choices).toHaveLength(4);
    const context = menu.context!.split("\n");
    expect(context.slice(0, 2)).toEqual(["Read outside the working directories", "Read(/home/sam/proj/docs/screens/home-dark.png)"]);
    expect(menu.context).toContain("Auto mode and the sandbox");
    expect(parseMenu("Which file\nshould I open?\n\n❯ 1. a\n  2. b").context).toBeUndefined();
    // A rule right above the question leaves no body.
    expect(parseMenu("────────\nDo you want to proceed?\n❯ 1. Yes\n  2. No").context).toBeUndefined();
    // Agent output above the question is no prompt body.
    expect(parseMenu("⏺ Done.\nDo you want to proceed?\n❯ 1. Yes\n  2. No").context).toBeUndefined();
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
