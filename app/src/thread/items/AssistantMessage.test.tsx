import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { showActionSheet } from "@/ui/nativeSheet";

import { RunHostContext, ThreadPaneContext, type RunHost, type ThreadPane } from "../LiveToolContext";
import { useRunRequest } from "../runCommand";
import { AssistantMessage } from "./AssistantMessage";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock("@/ui/nativeSheet", () => ({ showActionSheet: jest.fn() }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock("@/voice/useSpeakReplies", () => ({ useManualSpeech: Object.assign(() => false, { getState: () => ({ key: undefined }) }) }));
let mockStatus = "online";
jest.mock("@/hosts/connection", () => ({ useHostConn: () => ({ status: mockStatus, rpc: null }) }));
// The markdown package ships untranspiled ESM. This stand-in draws each fenced block with the
// app's `fence` rule, with its info string, and the rest as plain text.
jest.mock("@ronradtke/react-native-markdown-display", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: ({ children, rules }: { children: string; rules: Record<string, (n: object) => React.ReactNode> }) => {
      const parts = children.split(/```([^\n]*)\n([\s\S]*?)```/);
      const out: React.ReactNode[] = [];
      for (let i = 0; i < parts.length; i += 3) {
        out.push(<Text key={`t${i}`}>{parts[i]}</Text>);
        if (i + 2 < parts.length) out.push(rules.fence({ key: `f${i}`, content: parts[i + 2], sourceInfo: parts[i + 1] }));
      }
      return out;
    },
  };
});

const PANE: ThreadPane = { hostId: "studio", paneId: "w1:p1" };
const sheet = showActionSheet as jest.Mock;

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  mockPush.mockClear();
  sheet.mockClear();
  (Clipboard.setStringAsync as jest.Mock).mockClear();
  mockStatus = "online";
  useRunRequest.setState({ req: undefined });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

function render(markdown: string, pane: ThreadPane | null = PANE, runHost: RunHost | null = null) {
  act(() => {
    tree = create(
      <GestureHandlerRootView>
        <RunHostContext.Provider value={runHost}>
          <ThreadPaneContext.Provider value={pane}>
            <AssistantMessage markdown={markdown} id="a1" />
          </ThreadPaneContext.Provider>
        </RunHostContext.Provider>
      </GestureHandlerRootView>,
    );
  });
  return tree!;
}

const runButtons = (t: ReactTestRenderer) => t.root.findAll((n) => n.props.accessibilityLabel === "Run command" && typeof n.props.onPress === "function");
const copyButtons = (t: ReactTestRenderer) => t.root.findAll((n) => n.props.accessibilityLabel === "Copy code" && typeof n.props.onPress === "function");
const codeMenus = (t: ReactTestRenderer) => t.root.findAll((n) => typeof n.props.onLongPress === "function" && n.props.delayLongPress !== undefined).slice(1);

test("the_run_button_shows_only_on_shell_fences", () => {
  const t = render("A:\n\n```bash\n$ pnpm test\n```\n\nB:\n\n```ts\nconst a = 1;\n```\n\nC:\n\n```\nls\n```\n\nD:\n\n```Console\n$ ls\nREADME.md\n```\n");
  expect(runButtons(t)).toHaveLength(2);
});

test("no_run_button_outside_a_live_session_thread", () => {
  const t = render("```sh\nls\n```\n", null);
  expect(runButtons(t)).toHaveLength(0);
});

test("a_tap_opens_the_run_sheet_with_the_command", () => {
  const t = render("```console\n$ ls\nREADME.md\n$ pwd\n```\n");
  act(() => runButtons(t)[0].props.onPress());
  expect(useRunRequest.getState().req).toEqual({ hostId: "studio", paneId: "w1:p1", command: "ls\npwd" });
  expect(mockPush).toHaveBeenCalledWith("/run-command");
});

test("the_long_press_menu_offers_run_in_shell", () => {
  const t = render("```zsh\nmake\n```\n");
  act(() => codeMenus(t)[0].props.onLongPress());
  const [opts, onPick] = sheet.mock.calls.at(-1) as [{ options: string[] }, (i: number) => void];
  expect(opts.options.slice(0, 2)).toEqual(["Copy code", "Run in shell…"]);
  act(() => onPick(1));
  expect(useRunRequest.getState().req?.command).toBe("make");
  expect(mockPush).toHaveBeenCalledWith("/run-command");
});

test("offline_the_button_is_disabled_and_the_menu_has_no_run", () => {
  mockStatus = "offline";
  const t = render("```bash\nls\n```\n");
  expect(runButtons(t)[0].props.disabled).toBe(true);
  act(() => codeMenus(t)[0].props.onLongPress());
  const [opts] = sheet.mock.calls.at(-1) as [{ options: string[] }];
  expect(opts.options).not.toContain("Run in shell…");
});

test("every_fence_has_a_copy_button_that_copies_the_block", async () => {
  const t = render("A:\n\n```bash\n$ pnpm test\n```\n\nB:\n\n```ts\nconst a = 1;\n```\n\nC:\n\n```\nls\n```\n", null);
  const buttons = copyButtons(t);
  expect(buttons).toHaveLength(3);
  // The block text as it shows, prompt and all; Run strips the prompt, Copy does not.
  await act(async () => buttons[1].props.onPress());
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith("const a = 1;");
  await act(async () => copyButtons(t)[0].props.onPress());
  expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith("$ pnpm test");
});

test("copy_shows_a_check_for_a_moment", async () => {
  jest.useFakeTimers();
  try {
    const t = render("```ts\nconst a = 1;\n```\n", null);
    expect(t.root.findAllByType(Copy)).toHaveLength(1);
    await act(async () => copyButtons(t)[0].props.onPress());
    expect(t.root.findAllByType(Check)).toHaveLength(1);
    expect(t.root.findAllByType(Copy)).toHaveLength(0);
    act(() => jest.advanceTimersByTime(1500));
    expect(t.root.findAllByType(Copy)).toHaveLength(1);
    expect(t.root.findAllByType(Check)).toHaveLength(0);
  } finally {
    jest.useRealTimers();
  }
});

test("copy_sits_next_to_run_on_a_shell_block", () => {
  const t = render("```sh\nls\n```\n");
  expect(runButtons(t)).toHaveLength(1);
  expect(copyButtons(t)).toHaveLength(1);
  // Both have a 44 pt touch area.
  for (const b of [...runButtons(t), ...copyButtons(t)]) expect(b.props.hitSlop).toBe(8);
});

test("the_peek_sheet_runs_through_its_own_open", () => {
  const open = jest.fn();
  const t = render("```bash\nmake\n```\n", null, { hostId: "studio", paneId: "w1:p1", open });
  expect(runButtons(t)).toHaveLength(1);
  act(() => runButtons(t)[0].props.onPress());
  expect(open).toHaveBeenCalledWith({ hostId: "studio", paneId: "w1:p1", command: "make" });
  expect(mockPush).not.toHaveBeenCalled();
  // The long-press menu offers Run too, through the same `open`.
  act(() => codeMenus(t)[0].props.onLongPress());
  const [opts, onPick] = sheet.mock.calls.at(-1) as [{ options: string[] }, (i: number) => void];
  expect(opts.options.slice(0, 2)).toEqual(["Copy code", "Run in shell…"]);
  act(() => onPick(1));
  expect(open).toHaveBeenCalledTimes(2);
});

test("a_subagent_thread_runs_in_the_folder_of_the_parent_pane", () => {
  const t = render("```bash\nls\n```\n", null, { hostId: "studio", paneId: "w1:p1" });
  act(() => runButtons(t)[0].props.onPress());
  expect(useRunRequest.getState().req).toEqual({ hostId: "studio", paneId: "w1:p1", command: "ls" });
  expect(mockPush).toHaveBeenCalledWith("/run-command");
});
