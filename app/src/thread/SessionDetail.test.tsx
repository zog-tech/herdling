/**
 * The session screen with the data of a brand-new session: the agent can be missing from the
 * snapshot or have no kind, folder or name yet, and the thread log may not exist yet.
 */
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { Snapshot } from "@/herdr/snapshot";
import { setHostSnapshot } from "@/herdr/snapshotStore";

import { SessionDetail } from "./SessionDetail";

type Ref = { kind: string; session: string | null; log_path: string | null; cwd: string | null };
let mockRef: Ref | null = null;
const notFound = () => Object.assign(new Error("no log"), { code: "not_found" });
const mockRpc = {
  srttMs: undefined as number | undefined,
  onSrtt: () => () => {},
  stream: async () => () => {},
  call: async (method: string, params: { method?: string }) => {
    if (method === "thread.resolve") return mockRef;
    if (method === "thread.get") throw notFound();
    if (method === "herdr.call" && params.method === "pane.read") return { read: { text: "" } };
    if (method === "ports.list") return { ports: [] };
    return {};
  },
};
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc, hello: { methods: [] } }),
  getHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc, hello: { methods: [] } }),
}));
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

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
const texts = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);

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
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  setHostSnapshot("h", undefined);
  jest.useRealTimers();
});

const open = async (extra: { prompt?: string; promptError?: string } = {}) => {
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

test("a_new_pane_before_its_agent_with_no_thread_log_renders", async () => {
  setHostSnapshot("h", fresh([]));
  mockRef = { kind: "shell", session: null, log_path: null, cwd: null };
  const t = await open();
  expect(texts(t)).toContain("No conversation log for this agent. Showing its terminal.");
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
