/**
 * The session screen with the data of a brand-new session: the agent can be missing from the
 * snapshot or have no kind, folder or name yet, and the thread log may not exist yet.
 */
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { EXPECT_MS, expectedKind, expectPane, resetExpected } from "@/herdr/expectedPanes";
import type { Snapshot } from "@/herdr/snapshot";
import { setHostSnapshot } from "@/herdr/snapshotStore";

import { SessionDetail } from "./SessionDetail";

type Ref = { kind: string; session: string | null; log_path: string | null; cwd: string | null };
let mockRef: Ref | null = null;
/** The newest page of `thread.get`. Null: the log does not exist yet. */
let mockPage: object | null = null;
/** The data handler of the newest `thread.follow` stream. */
let mockFollow: ((d: unknown) => void) | undefined;
const notFound = () => Object.assign(new Error("no log"), { code: "not_found" });
const mockRpc = {
  srttMs: undefined as number | undefined,
  onSrtt: () => () => {},
  stream: async (_method: string, _params: unknown, onData: (d: unknown) => void) => {
    mockFollow = onData;
    return () => {};
  },
  call: async (method: string, params: { method?: string }) => {
    if (method === "thread.resolve") return mockRef;
    if (method === "thread.get") {
      if (mockPage) return mockPage;
      throw notFound();
    }
    if (method === "herdr.call" && params.method === "pane.read") return { read: { text: "" } };
    if (method === "ports.list") return { ports: [] };
    return {};
  },
};
/** The methods that the host lists in `hello`. */
let mockMethods: string[] = [];
import { useSessionSpeak } from "@/voice/settings";
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc, hello: { methods: mockMethods } }),
  getHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc, hello: { methods: mockMethods } }),
}));
jest.mock("@/device", () => ({ getDeviceId: async () => "d_test" }));
jest.mock("expo-router", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  // The native header draws the title view and the bar buttons: the test draws them in place.
  const Screen = ({ options }: { options?: { headerTitle?: () => React.ReactNode; headerRight?: () => React.ReactNode } }) => (
    <View>
      {options?.headerTitle?.()}
      {options?.headerRight?.()}
    </View>
  );
  return {
    Stack: { Screen },
    useIsFocused: () => true,
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/ui/haptics", () => ({ tap: jest.fn(), press: jest.fn(), commit: jest.fn(), warn: jest.fn(), fail: jest.fn() }));
jest.mock("@/ui/nativeSheet", () => ({ showActionSheet: jest.fn() }));
jest.mock("@/ui/MenuSheet", () => ({ ...jest.requireActual("@/ui/MenuSheet"), showMenu: jest.fn() }));
jest.mock("@/voice/MicButton", () => ({ MicButton: () => null }));
jest.mock("@/voice/RecordBar", () => ({ RecordBar: () => null }));
jest.mock("@/voice/useDictation", () => ({
  useDictation: () => ({ state: { phase: "idle", partial: "" }, dispatch: jest.fn(), clearError: () => {} }),
}));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-clipboard", () => ({ getImageAsync: jest.fn(), setStringAsync: jest.fn() }));
// The markdown renderer is an ES module that Jest does not transform. No message renders here.
jest.mock("./items/AssistantMessage", () => ({ AssistantMessage: () => null }));
jest.mock("./items/ReplyPlayButton", () => ({ ReplyPlayButton: () => null }));
// Speech: nothing speaks in these tests.
jest.mock("@/voice/useSpeakReplies", () => ({
  useSpeakReplies: () => {},
  useSpeaking: (pick: (s: { speaking: boolean }) => unknown) => pick({ speaking: false }),
  stopSpeaking: () => {},
}));
jest.mock("../../modules/ssh", () => ({ hasNativePreview: () => false }));
jest.mock("../../modules/paste", () => ({ hasNativePaste: false, addPasteImageListener: () => () => {} }));
/** The newest enabled handler of each hardware keyboard shortcut. */
const mockKeys: Record<string, () => void> = {};
jest.mock("@/ui/keyCommands", () => ({
  useKeyCommand: (id: string, run: () => void, o?: { enabled?: boolean }) => {
    if (o?.enabled !== false) mockKeys[id] = run;
  },
}));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
const texts = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);

/** The tabs of the Thread / Terminal switch in the header. */
const segments = (t: ReactTestRenderer) =>
  t.root.findAll((n) => n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function").map((n) => n.props.accessibilityLabel as string);
const hasLabel = (t: ReactTestRenderer, label: string) => t.root.findAll((n) => n.props.accessibilityLabel === label).length > 0;
type Menu = { title?: string; detail?: string; sections: { title?: string; items: { label: string; value?: string; checked?: boolean; destructive?: boolean; onPick: () => void }[] }[] };
const menuMock = () => jest.requireMock<{ showMenu: jest.Mock }>("@/ui/MenuSheet").showMenu;
/** Opens the "⋯" menu and gives the menu it shows. */
const openMenu = (t: ReactTestRenderer): Menu => {
  const before = menuMock().mock.calls.length;
  act(() => t.root.find((n) => n.props.accessibilityLabel === "Session actions" && typeof n.props.onPress === "function").props.onPress());
  return menuMock().mock.calls[before][0] as Menu;
};
const labels = (m: Menu) => m.sections.flatMap((s) => s.items.map((i) => i.label));
const item = (m: Menu, label: string) => m.sections.flatMap((s) => s.items).find((i) => i.label === label)!;

/** A workspace, a tab and a pane that herdr just made for the new session. */
const fresh = (agents: Snapshot["agents"]): Snapshot => ({
  workspaces: [{ workspace_id: "w9", label: "proj", number: 9, agent_status: "unknown" }],
  tabs: [{ tab_id: "t9", workspace_id: "w9", label: "1", number: 1, agent_status: "unknown" }],
  panes: [{ pane_id: "p9", tab_id: "t9", workspace_id: "w9", label: null }],
  agents,
});
const noKind = {
  pane_id: "p9",
  tab_id: "t9",
  workspace_id: "w9",
  agent: null,
  agent_status: "unknown" as const,
  state_change_seq: 0,
  name: null,
  cwd: null,
  terminal_title_stripped: null,
  display_agent: null,
};

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  mockRef = null;
  mockMethods = [];
  mockPage = null;
  mockFollow = undefined;
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  useSessionSpeak.setState({ bySession: {} });
  setHostSnapshot("h", undefined);
  resetExpected();
  jest.useRealTimers();
});

const open = async (extra: { prompt?: string; promptError?: string; shell?: boolean } = {}) => {
  act(() => {
    tree = create(
      <GestureHandlerRootView>
        <SessionDetail hostId="h" paneId="p9" active header="native" onOpenPane={jest.fn()} onClosed={jest.fn()} neighborShortcuts {...extra} />
      </GestureHandlerRootView>,
    );
  });
  await flush();
  return tree!;
};

test("a_new_session_with_no_snapshot_and_no_thread_ref_renders", async () => {
  const t = await open();
  expect(texts(t)).toContain("p9");
});

test("an_agent_with_no_thread_log_shows_its_terminal_under_thread", async () => {
  setHostSnapshot("h", fresh([{ ...noKind, agent: "amp", agent_status: "idle" }]));
  mockRef = { kind: "amp", session: null, log_path: null, cwd: null };
  const t = await open();
  expect(texts(t)).toContain("No conversation log for this agent. Showing its terminal.");
  expect(segments(t)).toContain("Thread");
});

test("a_pane_with_no_agent_opens_as_a_terminal_only", async () => {
  const snap = fresh([]);
  snap.panes = [{ ...snap.panes[0], cwd: "/home/sam/proj", terminal_title_stripped: "npm run dev" }];
  setHostSnapshot("h", snap);
  mockRef = { kind: "shell", session: null, log_path: null, cwd: null };
  const t = await open();
  const all = texts(t);
  // The terminal title and the folder; no Thread or Terminal switch and no composer.
  expect(all).toContain("npm run dev");
  expect(all).toContain("/home/sam/proj");
  expect(all).toContain("h · Terminal");
  expect(segments(t)).toEqual([]);
  expect(all).not.toContain("No conversation log for this agent. Showing its terminal.");
  expect(hasLabel(t, "Session actions")).toBe(true);
  // The menu: Find, but no Speak replies (a terminal has no replies).
  const menu = openMenu(t);
  expect(labels(menu)).toContain("Find");
  expect(labels(menu)).not.toContain("Speak replies");
});

test("a_new_shell_before_the_snapshot_shows_it_opens_as_a_terminal", async () => {
  const t = await open({ shell: true });
  expect(texts(t)).toContain("Terminal");
  expect(segments(t)).toEqual([]);
  expect(labels(openMenu(t))).toContain("Find");
});

test("a_pane_that_expects_an_agent_shows_no_terminal_view_before_the_agent_appears", async () => {
  // New session started an agent, but the snapshot shows the pane before its agent.
  expectPane("h", "p9", "agent");
  setHostSnapshot("h", fresh([]));
  const t = await open();
  expect(segments(t)).toContain("Thread");
  expect(texts(t)).not.toContain("h · Terminal");
  // The agent appears: the mark goes away, and the snapshot decides from now on.
  act(() => setHostSnapshot("h", fresh([{ ...noKind, agent: "claude", agent_status: "idle" }])));
  await flush();
  expect(segments(t)).toContain("Thread");
  expect(expectedKind("h", "p9")).toBeUndefined();
});

test("an_expected_shell_with_no_route_hint_opens_as_a_terminal_at_once", async () => {
  // The detail column of regular width gets no shell param: the mark tells it.
  expectPane("h", "p9", "shell");
  const t = await open();
  expect(texts(t)).toContain("Terminal");
  expect(segments(t)).toEqual([]);
});

test("an_agent_mark_expires_and_a_pane_with_no_agent_becomes_a_terminal", async () => {
  expectPane("h", "p9", "agent");
  setHostSnapshot("h", fresh([]));
  const t = await open();
  expect(segments(t)).toContain("Thread");
  act(() => jest.advanceTimersByTime(EXPECT_MS + 1));
  await flush();
  expect(segments(t)).not.toContain("Thread");
  expect(texts(t)).toContain("h · Terminal");
});

test("closing_a_terminal_asks_then_closes_its_pane", async () => {
  const { showActionSheet } = jest.requireMock<{ showActionSheet: jest.Mock }>("@/ui/nativeSheet");
  showActionSheet.mockReset();
  const call = jest.spyOn(mockRpc, "call");
  const snap = fresh([]);
  setHostSnapshot("h", snap);
  const t = await open();
  const menu = openMenu(t);
  // No agent actions: no Restart and no renames.
  expect(labels(menu)).not.toContain("Restart");
  // An older herdlingd does not list shell.watch: no notify option.
  expect(labels(menu)).not.toContain("Notify me when it finishes");
  // Close is the last row, destructive, in the last section.
  const last = menu.sections.at(-1)!;
  expect(last.items.at(-1)).toMatchObject({ label: "Close", destructive: true });
  // The confirm sheet waits for its answer: do not wait for the pick itself.
  act(() => {
    item(menu, "Close").onPick();
  });
  await flush();
  const [confirm, yes] = showActionSheet.mock.calls[0];
  expect(confirm.title).toBe("Close this terminal?");
  act(() => {
    yes(0);
  });
  await flush();
  expect(call).toHaveBeenCalledWith("herdr.call", { method: "pane.close", params: { pane_id: "p9" } });
  call.mockRestore();
});

test("a_terminal_on_a_new_host_can_notify_when_its_command_finishes", async () => {
  mockMethods = ["shell.watch", "shell.unwatch", "shell.watches"];
  const call = jest.spyOn(mockRpc, "call");
  setHostSnapshot("h", fresh([]));
  const t = await open();
  expect(call).toHaveBeenCalledWith("shell.watches");
  const menu = openMenu(t);
  expect(menu.sections[0].items[0].label).toBe("Notify me when it finishes");
  act(() => {
    item(menu, "Notify me when it finishes").onPick();
  });
  await flush();
  expect(call).toHaveBeenCalledWith("shell.watch", { pane_id: "p9", device_id: "d_test" });
  // The next menu offers to turn it off.
  expect(labels(openMenu(t))).toContain("Do not notify me when it finishes");
  call.mockRestore();
});

test("an_agent_that_herdr_has_not_detected_yet_renders", async () => {
  setHostSnapshot("h", fresh([noKind]));
  mockRef = { kind: "unknown", session: null, log_path: null, cwd: null };
  const t = await open();
  // The title falls back to the workspace label.
  expect(texts(t)).toContain("proj");
});

test("a_new_claude_session_with_no_log_file_yet_waits_for_the_first_prompt", async () => {
  setHostSnapshot("h", fresh([{ ...noKind, agent: "claude", agent_status: "idle" }]));
  mockRef = { kind: "claude", session: null, log_path: "/home/sam/.claude/projects/x/new.jsonl", cwd: null };
  const t = await open();
  expect(texts(t)).toContain("No messages yet. Send the first prompt.");
});

test("a_failed_first_prompt_from_new_session_shows_in_the_composer", async () => {
  setHostSnapshot("h", fresh([noKind]));
  const t = await open({ prompt: "Fix the build", promptError: "agent_not_ready" });
  expect(texts(t)).toContain("Prompt not sent: agent_not_ready");
});

test("command_f_opens_the_search_of_the_thread", async () => {
  setHostSnapshot("h", fresh([{ ...noKind, agent: "claude", agent_status: "idle" }]));
  const t = await open();
  expect(hasLabel(t, "Close search")).toBe(false);
  act(() => mockKeys.find());
  await flush();
  expect(hasLabel(t, "Close search")).toBe(true);
  expect(t.root.findAll((n) => n.props.placeholder === "Search the thread").length).toBeGreaterThan(0);
});

describe("the session header and its menu", () => {
  const claude = () => {
    setHostSnapshot("h", fresh([{ ...noKind, agent: "claude", agent_status: "idle", name: "Fix the build" }]));
    mockRef = { kind: "claude", session: "s1", log_path: "/home/sam/.claude/projects/x/s1.jsonl", cwd: "/home/sam/proj" };
    mockPage = { items: [], cursor: null, end: 10, model: "claude-opus-5-5" };
  };

  test("the_header_shows_the_title_the_detail_line_and_the_compact_switch", async () => {
    claude();
    const t = await open();
    expect(texts(t)).toContain("Fix the build");
    expect(texts(t)).toContain("h · Claude Code · Opus 5.5");
    expect(segments(t)).toEqual(["Thread", "Terminal"]);
    // The old search button and speaker button are gone from the header.
    expect(hasLabel(t, "Search the thread")).toBe(false);
    expect(hasLabel(t, "Speak replies")).toBe(false);
    // The switch changes the view: no composer in Terminal.
    act(() => t.root.find((n) => n.props.accessibilityRole === "tab" && n.props.accessibilityLabel === "Terminal" && typeof n.props.onPress === "function").props.onPress());
    await flush();
    const terminalTab = t.root.find((n) => n.props.accessibilityRole === "tab" && n.props.accessibilityLabel === "Terminal" && typeof n.props.onPress === "function");
    expect(terminalTab.props.accessibilityState).toEqual({ selected: true });
  });

  test("the_menu_has_the_sections_of_the_spec_in_order", async () => {
    claude();
    mockMethods = ["git.status", "agent.prompt"];
    const t = await open();
    const menu = openMenu(t);
    expect(menu.title).toBe("Fix the build");
    expect(menu.sections.map((s) => s.title)).toEqual(["This session", "Work", "Help", "History", undefined]);
    const session = menu.sections[0].items;
    expect(session[0]).toMatchObject({ label: "Model", value: "Opus 5.5" });
    expect(session.map((i) => i.label)).toEqual(expect.arrayContaining(["Speak replies", "Find"]));
    expect(session.at(-1)?.label).toBe("Find");
    expect(menu.sections[1].items.map((i) => i.label)).toContain("Changes");
  });

  test("find_in_the_menu_opens_the_search", async () => {
    claude();
    const t = await open();
    expect(hasLabel(t, "Close search")).toBe(false);
    const menu = openMenu(t);
    act(() => item(menu, "Find").onPick());
    await flush();
    expect(hasLabel(t, "Close search")).toBe(true);
  });

  test("the_model_row_opens_a_menu_with_a_check_on_the_current_family", async () => {
    claude();
    const t = await open();
    const before = menuMock().mock.calls.length;
    const menu = openMenu(t);
    act(() => item(menu, "Model").onPick());
    const models = menuMock().mock.calls[before + 1][0] as Menu;
    expect(models.title).toBe("Model");
    expect(models.sections[0].items.find((i) => i.checked)?.label).toBe("Opus");
  });
});

// A block body in `act`: the store action returns the promise of the persist write, and an `act`
// callback that returns a promise is an async act. Not awaited, it leaves the act scope open and
// every later render in this file comes up empty.
test("speak_replies_in_the_menu_shows_its_state_and_turns_it", async () => {
  setHostSnapshot("h", fresh([{ ...noKind, agent: "claude", agent_status: "idle", name: "Fix the build" }]));
  const t = await open();
  const row = item(openMenu(t), "Speak replies");
  expect(row.value).toBe("Off");
  act(() => {
    row.onPick();
  });
  expect(useSessionSpeak.getState().bySession["h:p9"]).toBe(true);
});

describe("the model of the agent", () => {
  const claudeLog = () => {
    setHostSnapshot("h", fresh([{ ...noKind, agent: "claude", agent_status: "idle", name: "Fix the build" }]));
    mockRef = { kind: "claude", session: "s1", log_path: "/home/sam/.claude/projects/x/s1.jsonl", cwd: "/home/sam/proj" };
  };
  const tagged = (t: ReactTestRenderer, label: string) => hasLabel(t, `Model: ${label}`);

  test("the_composer_shows_the_model_of_the_newest_page", async () => {
    claudeLog();
    mockPage = { items: [], cursor: null, end: 10, model: "claude-opus-5-5" };
    const t = await open();
    expect(texts(t)).toContain("Opus 5.5");
    expect(tagged(t, "Opus 5.5")).toBe(true);
  });

  test("a_follow_event_with_a_new_model_updates_the_tag", async () => {
    claudeLog();
    mockPage = { items: [], cursor: null, end: 10, model: "claude-opus-5-5" };
    const t = await open();
    act(() => mockFollow?.({ items: [], offset: 20, model: "Sonnet 5.5" }));
    await flush();
    expect(texts(t)).toContain("Sonnet 5.5");
    expect(texts(t)).not.toContain("Opus 5.5");
  });

  test("no_model_shows_no_tag_and_no_unknown_text", async () => {
    claudeLog();
    mockPage = { items: [], cursor: null, end: 10 };
    const t = await open();
    expect(t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Model:")).length).toBe(0);
    expect(texts(t).some((x) => /unknown/i.test(x))).toBe(false);
  });

  test("a_tap_on_the_title_drops_down_the_agent_card", async () => {
    claudeLog();
    mockMethods = ["agent.prompt"];
    mockPage = { items: [], cursor: null, end: 10, model: "claude-opus-5-5[1m]" };
    const t = await open();
    expect(texts(t)).not.toContain("Claude Code");
    const title = t.root.find((n) => n.props.accessibilityHint === "Shows the agent and its model. Long press for session actions");
    act(() => title.props.onPress());
    // The test renderer does not measure: the card opens after the wait.
    act(() => jest.advanceTimersByTime(200));
    await flush();
    expect(texts(t)).toContain("Claude Code");
    expect(texts(t)).toContain("Opus 5.5 · 1M");
    // The raw id shows under the label.
    expect(texts(t)).toContain("claude-opus-5-5[1m]");
    expect(hasLabel(t, "Change model")).toBe(true);
    const close = t.root.findAll((n) => n.props.accessibilityLabel === "Close" && typeof n.props.onPress === "function")[0];
    act(() => close.props.onPress());
    await flush();
    expect(texts(t)).not.toContain("Claude Code");
  });
});
