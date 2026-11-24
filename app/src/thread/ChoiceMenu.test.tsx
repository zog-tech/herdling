import { readFileSync } from "fs";
import { join } from "path";
import { Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { ChoiceMenu, contextMaxHeight, menuMaxHeight } from "./ChoiceMenu";
import { parseMenu, type Choice } from "./parseChoices";
import type { TabMove } from "./questionTabs";

let mockKeyboard = 0;
jest.mock("@/ui/KeyboardAvoider", () => ({ useKeyboardHeight: () => mockKeyboard }));
const mockOpenSelectText = jest.fn();
jest.mock("./selectText", () => ({ openSelectText: (v: unknown) => mockOpenSelectText(v) }));
beforeEach(() => {
  mockKeyboard = 0;
});

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", `${name}.txt`), "utf8");

const pressables = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && !!n.props.onPress && typeof n.type !== "string");
const byLabel = (t: ReactTestRenderer, re: RegExp) => pressables(t).filter((n) => re.test(n.props.accessibilityLabel));
const texts = (t: ReactTestRenderer) =>
  t.root.findAllByType(Text).map((n: ReactTestInstance) => [n.props.children].flat().join(""));

function render(screen: string, props: Partial<Parameters<typeof ChoiceMenu>[0]> = {}) {
  const menu = parseMenu(screen);
  const onPick = jest.fn<void, [Choice]>();
  const onType = jest.fn();
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<ChoiceMenu choices={menu.choices} question={menu.question} context={menu.context} agent="claude" onPick={onPick} onType={onType} {...props} />);
  });
  return { t, onPick, onType, menu };
}

describe("ChoiceMenu with a question (AskUserQuestion)", () => {
  it("shows the question, the agent and one row per real option", () => {
    const { t } = render(fixture("claude_ask_user_question"));
    expect(texts(t)).toEqual(expect.arrayContaining(["Claude asks", "Which fix do you want for the slow test run?"]));
    expect(byLabel(t, /^\d\. /).map((n) => n.props.accessibilityLabel)).toEqual([
      "1. Run tests in parallel. Jest runs the test files on four workers, so the run takes about a quarter of the time. I change the config and run the suite again. Recommended",
      "2. Keep config, skip slow tests. Make no config change. I mark the three slowest tests as skipped, so the run is faster, but those tests do not run",
      "3. Mock the network. Replace the real network calls with a mock server. This needs a new test helper",
      "4. Type an answer",
      "5. Chat about this",
    ]);
  });

  it("marks only the recommended option with a chip", () => {
    const { t } = render(fixture("claude_ask_user_question"));
    expect(texts(t).filter((s) => s === "Recommended")).toHaveLength(1);
    expect(texts(t)).toContain("Run tests in parallel");
    expect(texts(t)).not.toContain("Run tests in parallel (Recommended)");
  });

  it("shows the free-text options as pills and picks them with their key", () => {
    const { t, onPick, onType, menu } = render(fixture("claude_ask_user_question"));
    expect(texts(t)).toEqual(expect.arrayContaining(["Type an answer", "Chat about this"]));
    act(() => byLabel(t, /^4\. Type an answer$/)[0].props.onPress());
    expect(onPick).toHaveBeenLastCalledWith(menu.choices[3]);
    expect(onType).toHaveBeenCalledTimes(1);
    act(() => byLabel(t, /^5\. Chat about this$/)[0].props.onPress());
    expect(onPick).toHaveBeenLastCalledWith(menu.choices[4]);
    expect(onType).toHaveBeenCalledTimes(1);
  });

  it("a row tap picks its choice", () => {
    const { t, onPick, menu } = render(fixture("claude_ask_user_question"));
    act(() => byLabel(t, /^2\. /)[0].props.onPress());
    expect(onPick).toHaveBeenCalledWith(menu.choices[1]);
  });

  it("the chevron expands and collapses the detail", () => {
    const { t, onPick } = render(fixture("claude_ask_user_question"));
    const detailLines = () =>
      t.root
        .findAllByType(Text)
        .filter((n) => String(n.props.children).startsWith("Jest runs the test files") && n.props.style?.position !== "absolute")[0].props
        .numberOfLines;
    const chevrons = byLabel(t, /^Show the full option$/);
    // The long details of options 1 and 2 are cut; option 3 is short enough.
    expect(chevrons).toHaveLength(2);
    expect(detailLines()).toBe(2);
    act(() => chevrons[0].props.onPress());
    expect(detailLines()).toBeUndefined();
    expect(byLabel(t, /^Show the full option$/)[0].props.accessibilityState).toEqual({ expanded: true });
    act(() => byLabel(t, /^Show the full option$/)[0].props.onPress());
    expect(detailLines()).toBe(2);
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("ChoiceMenu with a permission menu", () => {
  it("keeps compact rows with the full labels and no pills or chevrons", () => {
    const { t, onPick, menu } = render(fixture("claude_bash_permission"));
    expect(texts(t)).toEqual(expect.arrayContaining(["Claude asks", "Do you want to proceed?"]));
    expect(byLabel(t, /^\d\. /).map((n) => n.props.accessibilityLabel)).toEqual([
      "1. Yes",
      "2. Yes, and don't ask again for git status commands in /home/sam/proj",
      "3. No, and tell Claude what to do differently (esc)",
    ]);
    expect(byLabel(t, /^Show the full option$/)).toHaveLength(0);
    expect(texts(t)).not.toContain("Recommended");
    act(() => byLabel(t, /^3\. /)[0].props.onPress());
    expect(onPick).toHaveBeenCalledWith(menu.choices[2]);
  });

  it("shows a menu with no numbers: the prompt title, the message and one row per option", () => {
    const { t, onPick, menu } = render(fixture("claude_held_message"));
    expect(texts(t)).toEqual(expect.arrayContaining(["Claude asks", "Held message from another session", menu.context!]));
    expect(menu.context).toContain("Deploy lock notice from proj-34");
    expect(byLabel(t, /^\d\. /).map((n) => n.props.accessibilityLabel)).toEqual([
      "1. Deny — drop it and tell the sender it was declined",
      "2. Deliver this message to Claude",
    ]);
    act(() => byLabel(t, /^2\. /)[0].props.onPress());
    expect(onPick).toHaveBeenCalledWith(menu.choices[1]);
  });

  it("says that the agent asks to choose when no question is found", () => {
    const { t } = render("❯ 1. Allow\n  2. Deny", { agent: undefined });
    expect(texts(t)).toContain("The agent asks you to choose");
  });
});

test("menu_max_height_shrinks_while_the_keyboard_is_up", () => {
  expect(menuMaxHeight(800, 0)).toBe(440);
  // 800 − 340 = 460 above the keyboard; the menu takes 30 % of it, the prompt box keeps the rest.
  expect(menuMaxHeight(800, 340)).toBe(138);
  // A very small space: the menu keeps its floor.
  expect(menuMaxHeight(400, 340)).toBe(96);
});

describe("ChoiceMenu with a prompt context", () => {
  const contextBox = (t: ReactTestRenderer) =>
    t.root.findAllByType(Text).filter((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Prompt details: "));

  it("shows the command between the question and the options", () => {
    const { t, menu } = render(fixture("claude_bash_permission_subagent"));
    expect(texts(t)).toEqual(expect.arrayContaining(["Do you want to proceed?", menu.context!]));
    expect(contextBox(t)).toHaveLength(1);
    expect(menu.context).toContain("open(p,'w').write(s)");
  });

  it("hides the context while the keyboard is up", () => {
    mockKeyboard = 340;
    const { t } = render(fixture("claude_bash_permission_subagent"));
    expect(contextBox(t)).toHaveLength(0);
    expect(texts(t)).toContain("Do you want to proceed?");
  });

  it("offers Show all when the context does not fit, and opens the full text", () => {
    const { t, menu } = render(fixture("claude_bash_permission_subagent"));
    expect(byLabel(t, /^Show all of the prompt$/)).toHaveLength(0);
    const box = t.root.find((n) => !!n.props.onContentSizeChange && n.props.nestedScrollEnabled);
    act(() => {
      box.props.onLayout({ nativeEvent: { layout: { height: 160 } } });
      box.props.onContentSizeChange(300, 240);
    });
    act(() => byLabel(t, /^Show all of the prompt$/)[0].props.onPress());
    expect(mockOpenSelectText).toHaveBeenCalledWith({ title: "Prompt", text: menu.context });
  });

  it("has no context box for a question menu", () => {
    const { t } = render(fixture("claude_ask_user_question"));
    expect(contextBox(t)).toHaveLength(0);
  });
});

test("context_max_height_is_8_lines_or_less_on_a_small_menu", () => {
  expect(contextMaxHeight(440)).toBe(8 * 18 + 16);
  expect(contextMaxHeight(200)).toBe(80);
});

describe("ChoiceMenu with question tabs (AskUserQuestion with more than one question)", () => {
  const trees: ReactTestRenderer[] = [];
  afterEach(() => {
    act(() => trees.splice(0).forEach((t) => t.unmount()));
  });
  function renderTabs(screen: string, current?: number) {
    const menu = parseMenu(screen);
    const tabs = menu.tabs && current !== undefined ? { ...menu.tabs, current } : menu.tabs;
    const onPick = jest.fn<void, [Choice]>();
    const onTab = jest.fn<void, [TabMove]>();
    let t!: ReactTestRenderer;
    act(() => {
      t = create(
        <GestureHandlerRootView>
          <ChoiceMenu choices={menu.choices} question={menu.question} context={menu.context} tabs={tabs} next={menu.next} agent="claude" onPick={onPick} onTab={onTab} />
        </GestureHandlerRootView>,
      );
    });
    trees.push(t);
    return { t, onPick, onTab, menu };
  }
  const tabsOf = (t: ReactTestRenderer) => pressables(t).filter((n) => n.props.accessibilityRole === "tab");

  it("shows every tab with its title and answered state, and marks the current tab", () => {
    const { t } = renderTabs(fixture("claude_question_tabs_answered"), 1);
    expect(tabsOf(t).map((n) => [n.props.accessibilityLabel, n.props.accessibilityState.selected])).toEqual([
      ["Share flow, question 1 of 3, answered", false],
      ["Content, question 2 of 3, answered", true],
      ["Release, question 3 of 3, not answered", false],
      ["Submit, review the answers", false],
    ]);
    expect(texts(t)).toEqual(expect.arrayContaining(["Share flow", "Content", "Release", "Submit"]));
  });

  it("a tap on a tab moves to it; the arrows move one tab", () => {
    const { t, onTab } = renderTabs(fixture("claude_question_tabs"), 0);
    act(() => tabsOf(t)[2].props.onPress());
    expect(onTab).toHaveBeenLastCalledWith({ to: 2 });
    act(() => byLabel(t, /^Next question$/)[0].props.onPress());
    expect(onTab).toHaveBeenLastCalledWith({ by: 1 });
    // The first tab is current: "Previous question" is off.
    expect(byLabel(t, /^Previous question$/)[0].props.disabled).toBe(true);
  });

  it("with no known current tab, no tab is selected and both arrows stay on", () => {
    const { t, onTab } = renderTabs(fixture("claude_question_tabs"));
    expect(tabsOf(t).every((n) => !n.props.accessibilityState.selected)).toBe(true);
    expect(byLabel(t, /^Previous question$/)[0].props.disabled).toBeFalsy();
    act(() => byLabel(t, /^Previous question$/)[0].props.onPress());
    expect(onTab).toHaveBeenLastCalledWith({ by: -1 });
  });

  it("a multi-select question: checkboxes with their state, a tap toggles, Next goes on", () => {
    const { t, onPick, onTab, menu } = renderTabs(fixture("claude_question_tabs_multi"), 1);
    const boxes = pressables(t).filter((n) => n.props.accessibilityRole === "checkbox");
    expect(boxes.map((n) => [n.props.accessibilityLabel, n.props.accessibilityState.checked])).toEqual([
      ["1. Title. Includes the title", true],
      ["2. Summary. Includes the summary", false],
      ["3. Screenshot. Includes a screenshot", true],
    ]);
    act(() => boxes[1].props.onPress());
    expect(onPick).toHaveBeenLastCalledWith(menu.choices[1]);
    expect(texts(t)).toEqual(expect.arrayContaining(["Type an answer", "Chat about this", "Next"]));
    act(() => byLabel(t, /^Next$/)[0].props.onPress());
    expect(onTab).toHaveBeenLastCalledWith({ by: 1 });
  });

  it("the review screen: the answers as context, Submit as an option", () => {
    const { t, onPick, menu } = renderTabs(fixture("claude_question_tabs_submit"));
    expect(tabsOf(t)[3].props.accessibilityState.selected).toBe(true);
    expect(byLabel(t, /^Next question$/)[0].props.disabled).toBe(true);
    expect(texts(t)).toEqual(expect.arrayContaining(["Review your answers"]));
    expect(texts(t).some((s) => s.includes("→ Title, Screenshot"))).toBe(true);
    act(() => byLabel(t, /^1\. Submit answers$/)[0].props.onPress());
    expect(onPick).toHaveBeenLastCalledWith(menu.choices[0]);
  });

  it("shows no tabs for a single question", () => {
    const { t } = renderTabs(fixture("claude_ask_user_question"));
    expect(tabsOf(t)).toHaveLength(0);
    expect(byLabel(t, /question$/)).toHaveLength(0);
  });
});

describe("ChoiceMenu button looks", () => {
  /** The fill of the row of the option with this key: the View around its pressable. */
  const fill = (t: ReactTestRenderer, key: string) => {
    const row = byLabel(t, new RegExp(`^${key}\\. `))[0];
    const box = row.parent?.parent as ReactTestInstance | null;
    const style = [box?.props.style].flat().reduce((a, b) => ({ ...a, ...(b ?? {}) }), {} as Record<string, unknown>);
    return style.backgroundColor;
  };

  it("draws the approve option as the primary button and the others with no border", () => {
    const { colors } = jest.requireActual<typeof import("@/theme/tokens")>("@/theme/tokens");
    const { t } = render(fixture("claude_bash_permission"));
    expect(fill(t, "1")).toBe(colors.accent);
    expect(fill(t, "2")).toBe(colors.raised);
    expect(fill(t, "3")).toBe(colors.raised);
    const bordered = t.root.findAll((n) => typeof n.type === "string" && [n.props.style].flat().some((s) => s && (s as { borderWidth?: number }).borderWidth));
    expect(bordered).toHaveLength(0);
  });

  it("has no approve option in a question", () => {
    const { colors } = jest.requireActual<typeof import("@/theme/tokens")>("@/theme/tokens");
    const { t } = render(fixture("claude_ask_user_question"));
    expect(fill(t, "1")).toBe(colors.raised);
  });
});
