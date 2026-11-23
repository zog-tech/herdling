import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { answerChoice, moveTab, useChoiceMenu, type Menu } from "./choices";
import { answerKeys, isFreeform, parseChoices, parseMenu } from "./parseChoices";
import { currentTabFromAnsi, cursorRows, isTabBar, parseTabBar, tabKeys, upsToOption, type QuestionTabs } from "./questionTabs";

/**
 * The fixtures `claude_question_tabs*.txt` are screens of Claude Code 2.1.330 with an
 * AskUserQuestion of three questions (the second one multi-select), read from a terminal
 * emulator. The narrow fixture has four questions in a 40-column terminal.
 */
const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", `${name}.txt`), "utf8");

const BAR = "←  ☐ Share flow  ☐ Content  ☐ Release  ✔ Submit  →";
/** The tab bar as herdlingd renders it (`screen.rs`): the current tab has a lilac background. */
function ansiBar(current: number): string {
  const tabs = [" ☐ Share flow ", " ☐ Content ", " ☐ Release ", " ✔ Submit "];
  const parts = tabs.map((t, i) => (i === current ? `\x1b[0;38;2;0;0;0;48;2;177;185;249m${t}\x1b[0m` : t));
  return `\x1b[0;38;2;153;153;153m←\x1b[0m ${parts.join(" ")} →`;
}
const rowsOf = (m: Menu) =>
  cursorRows(
    m.choices.map((c) => ({ selected: c.selected, checked: c.checked, freeform: isFreeform(c) })),
    m.next,
  );

describe("the tab bar", () => {
  it("finds the tabs, their marks and the Submit tab", () => {
    expect(isTabBar(BAR)).toBe(true);
    expect(parseTabBar("←  ☒ Share flow  ☒ Content  ☐ Release  ✔ Submit  →")).toEqual([
      { title: "Share flow", answered: true, submit: false },
      { title: "Content", answered: true, submit: false },
      { title: "Release", answered: false, submit: false },
      { title: "Submit", answered: false, submit: true },
    ]);
  });

  it("is no tab bar with one tab or no arrows", () => {
    expect(isTabBar(" ☐ Test speed")).toBe(false);
    expect(isTabBar("←  ☐ Only one  →")).toBe(false);
    expect(isTabBar("  ☐ Share flow  ☐ Content")).toBe(false);
  });

  it("keeps the cut titles of a narrow terminal", () => {
    expect(parseTabBar("←  ☐ Share    ☐ C…  ☐ R… ☐ D… ✔ Submit →").map((t) => t.title)).toEqual(["Share", "C…", "R…", "D…", "Submit"]);
  });
});

describe("parseMenu with question tabs", () => {
  it("a single-select question: the tabs, the question and the options", () => {
    const menu = parseMenu(fixture("claude_question_tabs"));
    expect(menu.tabs).toEqual({
      items: [
        { title: "Share flow", answered: false, submit: false },
        { title: "Content", answered: false, submit: false },
        { title: "Release", answered: false, submit: false },
        { title: "Submit", answered: false, submit: true },
      ],
    });
    expect(menu.question).toBe("How should sharing start?");
    expect(menu.context).toBeUndefined();
    expect(menu.next).toBeUndefined();
    expect(menu.choices.map((c) => [c.key, c.label, c.selected, c.checked])).toEqual([
      ["1", "Share sheet Uses the system share sheet", true, undefined],
      ["2", "Copy link Copies a link", false, undefined],
      ["3", "Type something.", false, undefined],
      ["4", "Chat about this", false, undefined],
    ]);
  });

  it("a multi-select question: checkboxes without the box in the label, and the Next row", () => {
    const menu = parseMenu(fixture("claude_question_tabs_multi"));
    expect(menu.question).toBe("What should the share include?");
    expect(menu.tabs?.items.map((t) => t.answered)).toEqual([false, true, false, false]);
    expect(menu.next).toEqual({ selected: false });
    expect(menu.choices.map((c) => ({ key: c.key, label: c.label, checked: c.checked, parts: c.parts }))).toEqual([
      { key: "1", label: "Title Includes the title", checked: true, parts: ["Title", "Includes the title"] },
      { key: "2", label: "Summary Includes the summary", checked: false, parts: ["Summary", "Includes the summary"] },
      { key: "3", label: "Screenshot Includes a screenshot", checked: true, parts: ["Screenshot", "Includes a screenshot"] },
      { key: "4", label: "Type something", checked: false, parts: ["Type something"] },
      { key: "5", label: "Chat about this", checked: undefined, parts: ["Chat about this"] },
    ]);
    expect(isFreeform(menu.choices[3])).toBe(true);
  });

  it("keeps the menu while the cursor is on the Next row", () => {
    const menu = parseMenu(fixture("claude_question_tabs_multi_next"));
    expect(menu.next).toEqual({ selected: true });
    expect(menu.choices).toHaveLength(5);
    expect(menu.choices.every((c) => !c.selected)).toBe(true);
    expect(menu.choices[3].label).toBe("Type something");
  });

  it("the review screen: the Submit tab is current, the answers are the context", () => {
    const menu = parseMenu(fixture("claude_question_tabs_submit"));
    expect(menu.tabs?.current).toBe(3);
    expect(menu.question).toBe("Review your answers");
    expect(menu.context).toBe(
      [
        "⚠ Some questions are unanswered",
        "",
        " ● How should sharing start?",
        "   → Share sheet",
        " ● What should the share include?",
        "   → Title, Screenshot",
      ].join("\n"),
    );
    expect(menu.choices.map((c) => c.label)).toEqual(["Submit answers", "Cancel"]);
  });

  it("a narrow terminal: all tabs, and the question under the wrapped title", () => {
    const menu = parseMenu(fixture("claude_question_tabs_narrow"));
    expect(menu.tabs?.items).toHaveLength(5);
    expect(menu.question).toBe("How should sharing start?");
    expect(menu.choices).toHaveLength(4);
  });

  it("a single question has no tabs", () => {
    expect(parseMenu(fixture("claude_ask_user_question")).tabs).toBeUndefined();
    expect(parseMenu(fixture("claude_bash_permission")).tabs).toBeUndefined();
  });

  it("parseChoices (the Rust port's rules) does not change", () => {
    expect(parseChoices(fixture("claude_question_tabs_multi")).map((c) => c.label)).toEqual([
      "[✔] Title Includes the title",
      "[ ] Summary Includes the summary",
      "[✔] Screenshot Includes a screenshot",
      "[ ] Type something Next",
      "Chat about this",
    ]);
    expect(parseChoices(fixture("claude_question_tabs_multi_next"))).toEqual([]);
  });
});

describe("currentTabFromAnsi", () => {
  it("finds the tab with a background color", () => {
    expect(currentTabFromAnsi(`⏺ text\n${ansiBar(0)}\n\nHow should sharing start?`)).toBe(0);
    expect(currentTabFromAnsi(ansiBar(2))).toBe(2);
    expect(currentTabFromAnsi(ansiBar(3))).toBe(3);
  });

  it("reads 16-color, 256-color and inverse styles", () => {
    expect(currentTabFromAnsi("← ☐ A \x1b[44m ☐ B \x1b[49m ☐ C →")).toBe(1);
    expect(currentTabFromAnsi("← ☐ A  ☐ B \x1b[48;5;147m ☐ C \x1b[0m →")).toBe(2);
    expect(currentTabFromAnsi("← \x1b[7m ☐ A \x1b[27m ☐ B →")).toBe(0);
  });

  it("ignores a foreground color, and gives undefined with no colors or no bar", () => {
    expect(currentTabFromAnsi("\x1b[38;2;153;153;153m←\x1b[0m ☐ A \x1b[38;5;147m ☐ B \x1b[0m →")).toBeUndefined();
    expect(currentTabFromAnsi(BAR)).toBeUndefined();
    expect(currentTabFromAnsi("no bar here")).toBeUndefined();
  });
});

describe("tabKeys", () => {
  const tabs = (current?: number): QuestionTabs => ({ items: parseTabBar(BAR), current });
  const onOption = rowsOf(parseMenu(fixture("claude_question_tabs")));

  it("moves by the difference from a known current tab", () => {
    expect(tabKeys(tabs(0), onOption, { to: 2 })).toEqual(["right", "right"]);
    expect(tabKeys(tabs(3), onOption, { to: 1 })).toEqual(["left", "left"]);
    expect(tabKeys(tabs(1), onOption, { to: 1 })).toEqual([]);
  });

  it("with no known current tab, goes to the first tab, then right", () => {
    expect(tabKeys(tabs(), onOption, { to: 2 })).toEqual(["left", "left", "left", "right", "right"]);
    expect(tabKeys(tabs(), onOption, { to: 0 })).toEqual(["left", "left", "left"]);
  });

  it("one step left or right, but not past the ends", () => {
    expect(tabKeys(tabs(), onOption, { by: 1 })).toEqual(["right"]);
    expect(tabKeys(tabs(1), onOption, { by: -1 })).toEqual(["left"]);
    expect(tabKeys(tabs(0), onOption, { by: -1 })).toEqual([]);
    expect(tabKeys(tabs(3), onOption, { by: 1 })).toEqual([]);
  });

  it("first moves the cursor up off the rows where the arrows do nothing", () => {
    // "Type something." (3) → "Copy link" (2).
    expect(tabKeys(tabs(0), rowsOf(parseMenu(fixture("claude_question_tabs_type_row"))), { by: 1 })).toEqual(["up", "right"]);
    // Next → "Type something" → "Screenshot".
    expect(tabKeys(tabs(1), rowsOf(parseMenu(fixture("claude_question_tabs_multi_next"))), { to: 2 })).toEqual(["up", "up", "right"]);
  });

  it("counts the ups from Chat about this through the Next row", () => {
    const single = parseMenu(fixture("claude_question_tabs").replace("❯ 1.", "  1.").replace("  4. Chat", "❯ 4. Chat"));
    expect(upsToOption(rowsOf(single))).toBe(2);
    const multi = parseMenu(fixture("claude_question_tabs_multi").replace("❯ 1.", "  1.").replace("  5. Chat", "❯ 5. Chat"));
    expect(upsToOption(rowsOf(multi))).toBe(3);
    expect(upsToOption(rowsOf(parseMenu(fixture("claude_question_tabs_multi"))))).toBe(0);
  });
});

describe("answerKeys on the Type something row", () => {
  const menu = parseMenu(fixture("claude_question_tabs_type_row"));

  it("moves up off the text field before the digit", () => {
    expect(answerKeys(menu.choices, menu.choices[0])).toEqual(["up", "1"]);
  });

  it("sends no key for the row under the cursor", () => {
    expect(answerKeys(menu.choices, menu.choices[2])).toEqual([]);
  });

  it("a checkbox option gets its bare digit (it turns the checkbox on or off)", () => {
    const multi = parseMenu(fixture("claude_question_tabs_multi"));
    expect(answerKeys(multi.choices, multi.choices[1])).toEqual(["2"]);
  });
});

class FakeRpc {
  calls: { method: string; params: any }[] = [];
  constructor(public screen: string) {}
  async call<T>(_m: string, p: any): Promise<T> {
    this.calls.push(p);
    return (p.method === "pane.read" ? { read: { text: this.screen } } : {}) as T;
  }
}
const sentKeys = (rpc: FakeRpc) => rpc.calls.filter((c) => c.method === "pane.send_keys").map((c) => c.params.keys[0]);

describe("moveTab", () => {
  it("re-reads the screen and sends one arrow key in each call", async () => {
    const screen = fixture("claude_question_tabs");
    const shown = { ...parseMenu(screen), tabs: { ...parseMenu(screen).tabs!, current: 0 } };
    const rpc = new FakeRpc(screen);
    await expect(moveTab(rpc, "t1", shown, { to: 2 }, () => true)).resolves.toBe("sent");
    expect(rpc.calls).toEqual([
      { method: "pane.read", params: { pane_id: "t1", source: "visible", format: "text" } },
      { method: "pane.send_keys", params: { pane_id: "t1", keys: ["right"] } },
      { method: "pane.send_keys", params: { pane_id: "t1", keys: ["right"] } },
    ]);
  });

  it("does not trust the shown current tab when the question changed", async () => {
    const shown = { ...parseMenu(fixture("claude_question_tabs")), tabs: { ...parseMenu(fixture("claude_question_tabs")).tabs!, current: 0 } };
    const rpc = new FakeRpc(fixture("claude_question_tabs_multi"));
    await moveTab(rpc, "t1", shown, { to: 2 }, () => true);
    expect(sentKeys(rpc)).toEqual(["left", "left", "left", "right", "right"]);
  });

  it("uses the Submit tab of the review screen as the current tab", async () => {
    const shown = parseMenu(fixture("claude_question_tabs"));
    const rpc = new FakeRpc(fixture("claude_question_tabs_submit"));
    await moveTab(rpc, "t1", shown, { to: 2 }, () => true);
    expect(sentKeys(rpc)).toEqual(["left"]);
  });

  it("sends nothing when the tabs are gone, other tabs show, or the agent is not blocked", async () => {
    const shown = parseMenu(fixture("claude_question_tabs"));
    for (const [screen, blocked] of [
      [fixture("claude_ask_user_question"), true],
      [fixture("claude_question_tabs").replace("Release", "Docs"), true],
      [fixture("claude_question_tabs"), false],
    ] as const) {
      const rpc = new FakeRpc(screen);
      await expect(moveTab(rpc, "t1", shown, { by: 1 }, () => blocked)).resolves.toBe("stale");
      expect(sentKeys(rpc)).toEqual([]);
    }
  });
});

describe("answerChoice on a multi-select question", () => {
  it("sends the digit of the checkbox", async () => {
    const shown = parseMenu(fixture("claude_question_tabs_multi")).choices;
    // The checkbox of option 2 is on now: the menu is still the same one.
    const rpc = new FakeRpc(fixture("claude_question_tabs_multi").replace("2. [ ] Summary", "2. [✔] Summary"));
    await expect(answerChoice(rpc, "t1", shown, shown[1], () => true)).resolves.toBe("sent");
    expect(sentKeys(rpc)).toEqual(["2"]);
  });
});

const mockReads: { params: any }[] = [];
let mockText = "";
let mockAnsi = "";
let mockAnsiFails = false;
const mockRpc = {
  call: async (_method: string, p: any) => {
    mockReads.push({ params: p.params });
    if (p.params.format === "ansi") {
      if (mockAnsiFails) throw new Error("no attach");
      return { read: { text: mockAnsi } };
    }
    return { read: { text: mockText } };
  },
};
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc }),
}));

describe("useChoiceMenu with question tabs", () => {
  let latest: Menu = { choices: [] };
  let tree: ReactTestRenderer | undefined;
  function Probe() {
    latest = useChoiceMenu("host-1", "t1", true);
    return null;
  }
  const flush = async () => {
    for (let i = 0; i < 5; i++) await act(async () => {});
  };
  const tick = async () => {
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    await flush();
  };
  const ansiReads = () => mockReads.filter((r) => r.params.format === "ansi");

  beforeEach(() => {
    jest.useFakeTimers();
    mockReads.length = 0;
    mockText = fixture("claude_question_tabs");
    mockAnsi = `⏺ text\n${ansiBar(1)}\n`;
    mockAnsiFails = false;
  });
  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
    jest.useRealTimers();
  });

  it("finds the current tab with one ANSI read, and reads again only when the screen changes", async () => {
    await act(async () => {
      tree = create(createElement(Probe));
    });
    await flush();
    expect(latest.tabs?.current).toBe(1);
    expect(ansiReads()).toEqual([{ params: { pane_id: "t1", source: "visible", format: "ansi", strip_ansi: false } }]);
    const first = latest;
    await tick();
    expect(ansiReads()).toHaveLength(1);
    expect(latest).toBe(first);

    mockText = fixture("claude_question_tabs_multi");
    mockAnsi = ansiBar(2);
    await tick();
    expect(ansiReads()).toHaveLength(2);
    expect(latest.tabs?.current).toBe(2);
  });

  it("needs no ANSI read on the review screen", async () => {
    mockText = fixture("claude_question_tabs_submit");
    await act(async () => {
      tree = create(createElement(Probe));
    });
    await flush();
    expect(latest.tabs?.current).toBe(3);
    expect(ansiReads()).toHaveLength(0);
  });

  it("keeps the menu with no current tab when the ANSI read fails or shows other tabs", async () => {
    mockAnsiFails = true;
    await act(async () => {
      tree = create(createElement(Probe));
    });
    await flush();
    expect(latest.choices).toHaveLength(4);
    expect(latest.tabs?.items).toHaveLength(4);
    expect(latest.tabs?.current).toBeUndefined();

    mockAnsiFails = false;
    mockAnsi = ansiBar(1).replace("Release", "Docs");
    mockText = fixture("claude_question_tabs_type_row").replace("Share flow", "Share");
    await tick();
    expect(latest.tabs?.current).toBeUndefined();
  });

  it("gives a new choices array for another tab with the same options", async () => {
    await act(async () => {
      tree = create(createElement(Probe));
    });
    await flush();
    const before = latest.choices;
    mockText = fixture("claude_question_tabs").replace("☐ Share flow", "☒ Share flow").replace("How should sharing start?", "Where should sharing start?");
    await tick();
    expect(latest.choices).not.toBe(before);
    expect(latest.choices).toEqual(before);
  });
});
