import { readFileSync } from "fs";
import { join } from "path";
import { Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { ChoiceMenu } from "./ChoiceMenu";
import { parseMenu, type Choice } from "./parseChoices";

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
    t = create(<ChoiceMenu choices={menu.choices} question={menu.question} agent="claude" onPick={onPick} onType={onType} {...props} />);
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

  it("says that the agent asks to choose when no question is found", () => {
    const { t } = render("❯ 1. Allow\n  2. Deny", { agent: undefined });
    expect(texts(t)).toContain("The agent asks you to choose");
  });
});
