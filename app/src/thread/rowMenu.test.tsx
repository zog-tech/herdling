import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { showActionSheet } from "@/ui/nativeSheet";
import { NoticeHost, useNotice } from "@/ui/notice";
import { speakReplyNow } from "@/voice/useSpeakReplies";

import { AssistantMessage } from "./items/AssistantMessage";
import { SubagentCard } from "./items/SubagentCard";
import { SystemRow } from "./items/SystemRow";
import { ThinkingRow } from "./items/ThinkingRow";
import { ToolCard } from "./items/ToolCard";
import { UserBubble } from "./items/UserBubble";
import { ThreadPaneContext, type ThreadPane } from "./LiveToolContext";
import { quoteBlock, useQuoteInto, useQuoteRequest, withQuote } from "./quote";
import { rowActions, subagentCopyText, toolCopyText, type MenuTarget } from "./rowMenu";
import { useSelectText } from "./selectText";
import { ThreadLogContext } from "./ThreadLogContext";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }), router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock("@/ui/nativeSheet", () => ({ showActionSheet: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/voice/useSpeakReplies", () => ({
  speakReplyNow: jest.fn(() => Promise.resolve()),
  useManualSpeech: Object.assign(() => false, { getState: () => ({ key: undefined }) }),
}));
jest.mock("@/hosts/connection", () => ({ useHostConn: () => ({ status: "online", rpc: null }) }));
// The markdown package ships untranspiled ESM. This stand-in draws each fenced block with the
// app's `fence` rule and the rest as plain text, which is what the menu needs.
jest.mock("@ronradtke/react-native-markdown-display", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: ({ children, rules }: { children: string; rules: Record<string, (n: object) => React.ReactNode> }) =>
      children.split(/```\w*\n([\s\S]*?)```/).map((part, i) =>
        i % 2 ? rules.fence({ key: `f${i}`, content: part }) : <Text key={`t${i}`}>{part}</Text>,
      ),
  };
});

const PANE: ThreadPane = { hostId: "studio", paneId: "w1:p1" };
const REPLY = "Run **this**:\n\n```sh\npnpm test\n```\n\nThen see [docs](https://example.com).";
const sheet = showActionSheet as jest.Mock;

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  sheet.mockClear();
  mockPush.mockClear();
  (Clipboard.setStringAsync as jest.Mock).mockClear();
  useNotice.setState({ notice: undefined });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

function render(el: React.ReactElement, pane: ThreadPane | null = PANE) {
  act(() => {
    tree = create(
      <GestureHandlerRootView>
        <ThreadPaneContext.Provider value={pane}>{el}</ThreadPaneContext.Provider>
      </GestureHandlerRootView>,
    );
  });
  return tree!;
}

/** The Pressables that open the row menu, outermost first. */
const menuPressables = (t: ReactTestRenderer) => t.root.findAll((n) => typeof n.props.onLongPress === "function" && n.props.delayLongPress !== undefined);

/** Long-presses `node`, then returns the menu labels and a way to pick one. */
function longPress(node: ReactTestInstance) {
  act(() => node.props.onLongPress());
  const [opts, onPick] = sheet.mock.calls.at(-1) as [{ options: string[]; cancelButtonIndex: number }, (i: number) => void];
  return {
    labels: opts.options,
    cancel: opts.cancelButtonIndex,
    pick: async (label: string) => {
      await act(async () => onPick(opts.options.indexOf(label)));
    },
  };
}

describe("rowActions", () => {
  const t = (kind: MenuTarget["kind"], extra: Partial<MenuTarget> = {}): MenuTarget => ({ kind, text: "x", ...extra });

  test("each_row_kind_gets_its_items", () => {
    expect(rowActions(t("user"), PANE)).toEqual(["copy", "select", "share", "quote"]);
    expect(rowActions(t("assistant", { id: "a1" }), PANE)).toEqual(["copy", "select", "share", "read", "quote"]);
    expect(rowActions(t("assistant", { id: "a1", code: "ls" }), PANE)).toEqual(["copyCode", "copy", "select", "share", "read", "quote"]);
    expect(rowActions(t("thinking"), PANE)).toEqual(["copy", "select"]);
    expect(rowActions(t("tool"), PANE)).toEqual(["copy", "select"]);
    expect(rowActions(t("subagent"), PANE)).toEqual(["copy", "select"]);
    expect(rowActions(t("system"), PANE)).toEqual(["copy"]);
  });

  test("read_aloud_and_quote_need_a_live_pane", () => {
    // The peek sheet and a subagent thread have no live pane.
    expect(rowActions(t("assistant", { id: "a1" }), null)).toEqual(["copy", "select", "share"]);
    expect(rowActions(t("user"), null)).toEqual(["copy", "select", "share"]);
  });
});

test("copy_texts_of_tool_and_subagent_cards", () => {
  expect(toolCopyText("Bash", { command: "ls" }, { ok: true, text: "a\nb", truncated: false })).toBe(
    'Bash\n\nInput:\n{\n  "command": "ls"\n}\n\nResult:\na\nb',
  );
  expect(toolCopyText("Bash", "ls", { ok: false, text: "", truncated: false })).toBe("Bash\n\nInput:\nls\n\nError:\n(empty)");
  expect(toolCopyText("Read", undefined)).toBe("Read\n\nInput:\n(none)");
  expect(subagentCopyText("Fix the parser", "Fixed.")).toBe("Fix the parser\n\nFixed.");
  expect(subagentCopyText("", undefined)).toBe("Subagent");
});

test("quote_prefixes_each_line_and_keeps_the_draft", () => {
  expect(quoteBlock("one\n\ntwo\n")).toBe("> one\n>\n> two\n\n");
  expect(withQuote("", "hi")).toBe("> hi\n\n");
  expect(withQuote("my note  \n", "hi")).toBe("my note\n\n> hi\n\n");
});

test("quote_request_goes_only_to_the_composer_of_its_pane", () => {
  const got: string[] = [];
  const other: string[] = [];
  function Probe({ paneId, out }: { paneId: string; out: string[] }) {
    useQuoteInto("studio", paneId, (q) => out.push(q));
    return null;
  }
  render(
    <>
      <Probe paneId="w1:p1" out={got} />
      <Probe paneId="w2:p1" out={other} />
    </>,
  );
  act(() => useQuoteRequest.setState({ req: { key: "studio\u0000w1:p1", text: "Quoted" } }));
  expect(got).toEqual(["Quoted"]);
  expect(other).toEqual([]);
  expect(useQuoteRequest.getState().req).toBeUndefined();
});

describe("assistant reply", () => {
  test("copy_copies_the_markdown_source_and_shows_copied", async () => {
    const t = create(<></>);
    tree = t;
    act(() => {
      t.update(
        <GestureHandlerRootView>
          <ThreadPaneContext.Provider value={PANE}>
            <AssistantMessage markdown={REPLY} id="a1" />
            <NoticeHost />
          </ThreadPaneContext.Provider>
        </GestureHandlerRootView>,
      );
    });
    const menu = longPress(menuPressables(t)[0]);
    expect(menu.labels).toEqual(["Copy", "Select text", "Share", "Read aloud", "Quote in reply", "Cancel"]);
    expect(menu.cancel).toBe(5);
    await menu.pick("Copy");
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(REPLY);
    expect(useNotice.getState().notice?.text).toBe("Copied");
    expect(t.root.findAll((n) => n.props.children === "Copied").length).toBeGreaterThan(0);
  });

  test("long_press_on_a_code_block_offers_copy_code_with_the_code_only", async () => {
    const t = render(<AssistantMessage markdown={REPLY} id="a1" />);
    const all = menuPressables(t);
    // The outer reply and one code block.
    expect(all).toHaveLength(2);
    const menu = longPress(all[1]);
    expect(menu.labels[0]).toBe("Copy code");
    await menu.pick("Copy code");
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("pnpm test");
    expect(useNotice.getState().notice?.text).toBe("Code copied");
  });

  test("select_share_read_and_quote_items", async () => {
    const t = render(<AssistantMessage markdown={REPLY} id="a1" />);
    await longPress(menuPressables(t)[0]).pick("Select text");
    expect(useSelectText.getState().current).toEqual({ title: "Reply", text: REPLY });
    expect(mockPush).toHaveBeenCalledWith("/select-text");

    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction", activityType: undefined });
    await longPress(menuPressables(t)[0]).pick("Share");
    expect(share).toHaveBeenCalledWith({ message: REPLY });

    await longPress(menuPressables(t)[0]).pick("Read aloud");
    expect(speakReplyNow).toHaveBeenCalledWith("studio", REPLY, "a1");

    await longPress(menuPressables(t)[0]).pick("Quote in reply");
    expect(useQuoteRequest.getState().req).toEqual({ key: "studio\u0000w1:p1", text: REPLY });
    useQuoteRequest.setState({ req: undefined });
  });

  test("voiceover_gets_copy_and_more_options", async () => {
    const t = render(<AssistantMessage markdown={REPLY} id="a1" />);
    const outer = menuPressables(t)[0];
    expect(outer.props.accessibilityActions).toEqual([
      { name: "copy", label: "Copy" },
      { name: "menu", label: "More options" },
    ]);
    await act(async () => outer.props.onAccessibilityAction({ nativeEvent: { actionName: "copy" } }));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(REPLY);
    act(() => outer.props.onAccessibilityAction({ nativeEvent: { actionName: "menu" } }));
    expect(sheet).toHaveBeenCalledTimes(1);
  });
});

describe("user prompt", () => {
  test("menu_copies_the_prompt_text", async () => {
    const t = render(<UserBubble text="Fix the build" />);
    const menu = longPress(menuPressables(t)[0]);
    expect(menu.labels).toEqual(["Copy", "Select text", "Share", "Quote in reply", "Cancel"]);
    await menu.pick("Copy");
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("Fix the build");
  });

  test("a_tap_on_a_long_prompt_still_expands_it", () => {
    const long = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
    const t = render(<UserBubble text={long} />);
    const p = menuPressables(t)[0];
    expect(p.props.accessibilityState).toEqual({ expanded: false });
    act(() => p.props.onPress());
    expect(menuPressables(t)[0].props.accessibilityState).toEqual({ expanded: true });
    // A long press opens the menu and does not toggle.
    longPress(menuPressables(t)[0]);
    expect(menuPressables(t)[0].props.accessibilityState).toEqual({ expanded: true });
    expect(menuPressables(t)[0].props.accessibilityActions[0]).toEqual({ name: "activate" });
  });
});

describe("other rows", () => {
  test("thinking_copies_its_text_and_a_tap_still_expands", async () => {
    const t = render(<ThinkingRow text="Maybe the cache." />);
    const p = menuPressables(t)[0];
    act(() => p.props.onPress());
    expect(menuPressables(t)[0].props.accessibilityState).toEqual({ expanded: true });
    const menu = longPress(menuPressables(t)[0]);
    expect(menu.labels).toEqual(["Copy", "Select text", "Cancel"]);
    await menu.pick("Copy");
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("Maybe the cache.");
  });

  test("redacted_thinking_has_no_menu", () => {
    const t = render(<ThinkingRow text={null} />);
    expect(menuPressables(t)).toHaveLength(0);
  });

  test("tool_card_copies_input_and_result_and_a_tap_still_expands", async () => {
    const t = render(
      <ToolCard id="t1" ts={0} name="Bash" inputSummary="ls" input="ls" result={{ ok: true, text: "a.txt", truncated: false }} />,
    );
    const p = menuPressables(t)[0];
    act(() => p.props.onPress());
    expect(menuPressables(t)[0].props.accessibilityState).toEqual({ expanded: true });
    const menu = longPress(menuPressables(t)[0]);
    expect(menu.labels).toEqual(["Copy", "Select text", "Cancel"]);
    await menu.pick("Copy");
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("Bash\n\nInput:\nls\n\nResult:\na.txt");
  });

  test("subagent_card_copies_and_a_tap_still_opens_its_thread", async () => {
    const log = { hostId: "studio", logPath: "/home/sam/.claude/projects/p/s.jsonl" };
    const t = render(
      <ThreadLogContext.Provider value={log}>
        <SubagentCard description="Fix the parser" status="completed" agentId="a1" resultSummary="Fixed." />
      </ThreadLogContext.Provider>,
    );
    act(() => menuPressables(t)[0].props.onPress());
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ agentId: "a1" }) }));
    const menu = longPress(menuPressables(t)[0]);
    await menu.pick("Copy");
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("Fix the parser\n\nFixed.");
  });

  test("subagent_card_that_cannot_open_still_has_the_menu", () => {
    const t = render(<SubagentCard description="Bg" status="async_launched" agentId="" />, null);
    const p = menuPressables(t)[0];
    expect(p.props.disabled).toBeFalsy();
    act(() => p.props.onPress());
    expect(mockPush).not.toHaveBeenCalled();
    expect(longPress(p).labels).toEqual(["Copy", "Select text", "Cancel"]);
  });

  test("system_row_offers_copy", async () => {
    const t = render(<SystemRow text="Conversation compacted" />);
    const menu = longPress(menuPressables(t)[0]);
    expect(menu.labels).toEqual(["Copy", "Cancel"]);
    await menu.pick("Copy");
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("Conversation compacted");
  });
});
