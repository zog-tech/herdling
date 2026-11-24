import { TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import ShareScreen from "@/app/share";
import type { Snapshot } from "@/herdr/snapshot";
import { useSnapshots } from "@/herdr/snapshotStore";
import { usePending } from "@/thread/pending";
import { useMenuSheet } from "@/ui/MenuSheet";

import { clearShareContent, receiveShare, useShareStore } from "./shareStore";

const mockPush = jest.fn();
const mockDismiss = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, dismiss: mockDismiss, canDismiss: () => true, replace: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-file-system", () => ({ File: jest.fn() }));
jest.mock("@/hosts/store", () => ({ useHosts: (sel: (s: unknown) => unknown) => sel({ hosts: [{ id: "h1", name: "studio.local" }] }) }));
const mockCall = jest.fn(async (method: string, params?: { name?: string }) => (method === "files.put" ? { path: `/home/sam/.cache/herdling/uploads/${params?.name}` } : {}));
const mockConn = { status: "online", rpc: { call: (...a: unknown[]) => (mockCall as (...x: unknown[]) => unknown)(...a) }, hello: { methods: ["files.put", "herdr.call"] } };
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => mockConn,
  getHostConn: () => mockConn,
  useOnlineHostKey: () => "h1",
}));
// No page fetch in the tests: the preview comes from the shared tags.
jest.mock("./openGraph", () => ({ ...jest.requireActual("./openGraph"), fetchLinkPreview: jest.fn(async () => undefined) }));

const snapshot = (): Snapshot => ({
  agents: [
    { pane_id: "p1", tab_id: "t1", workspace_id: "w1", agent: "claude", agent_status: "idle", name: "Login form", cwd: "/home/sam/proj" },
    { pane_id: "p2", tab_id: "t1", workspace_id: "w1", agent: "codex", agent_status: "working", name: "Docs", cwd: "/home/sam/proj" },
  ],
  workspaces: [{ workspace_id: "w1", label: "api", number: 1, agent_status: "idle" }],
  tabs: [],
  panes: [
    { pane_id: "p1", tab_id: "t1", workspace_id: "w1", agent: "claude" },
    { pane_id: "p2", tab_id: "t1", workspace_id: "w1", agent: "codex" },
  ],
});

let tree: ReactTestRenderer | undefined;

beforeEach(() => {
  useSnapshots.setState({ byHost: { h1: snapshot() } });
  usePending.setState({ byPane: {} });
  useShareStore.setState({ content: undefined, seq: 0, lastTarget: undefined });
  mockCall.mockClear();
  mockPush.mockClear();
  mockDismiss.mockClear();
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

async function render() {
  await act(async () => {
    tree = create(<ShareScreen />);
  });
  return tree!;
}
const press = async (t: ReactTestRenderer, label: string) => {
  const n = t.root.find((x) => x.props.accessibilityLabel === label && typeof x.props.onPress === "function");
  await act(async () => {
    n.props.onPress();
  });
};
/** Picks the row with `label` in the open picker sheet. The pick runs as the sheet would run it. */
const pickInSheet = async (label: string) => {
  const st = useMenuSheet.getState().state;
  if (st.kind !== "open") throw new Error("no open sheet");
  const item = st.menu.sections.flatMap((s) => s.items).find((i) => i.label === label);
  if (!item) throw new Error(`no row ${label}`);
  await act(async () => item.onPick());
};
const texts = (t: ReactTestRenderer) =>
  t.root
    .findAll((n) => typeof n.props.children === "string")
    .map((n) => n.props.children as string);

test("sends a shared link with the note to the picked agent and opens its thread", async () => {
  act(() => receiveShare({ url: "https://example.com/post", title: "A post", files: [] }));
  const t = await render();
  expect(texts(t)).toContain("A post");
  expect(texts(t)).toContain("Select an agent");
  const note = t.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === "Note for the agent (optional)")!;
  await act(async () => note.props.onChangeText("Read this"));
  // The agent is a picker row: it opens the sheet, and a pick selects the agent.
  await press(t, "Agent");
  const st = useMenuSheet.getState().state;
  expect(st.kind === "open" && st.menu.sections[0].items.map((i) => i.detail)).toEqual(["api · Codex · Working", "api · Claude Code · Idle"]);
  await pickInSheet("Login form");
  await press(t, "Send to Login form");
  expect(mockCall).toHaveBeenCalledWith("herdr.call", {
    method: "agent.prompt",
    params: { target: "p1", text: "Read this\n\nShared link: https://example.com/post\nTitle: A post" },
  });
  expect(mockDismiss).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith("/session/h1/p1");
  expect(useShareStore.getState().content).toBeUndefined();
  expect(useShareStore.getState().lastTarget).toEqual({ hostId: "h1", paneId: "p1" });
});

test("uploads shared files first and puts their paths after the note", async () => {
  useShareStore.setState({ lastTarget: { hostId: "h1", paneId: "p2" } });
  act(() =>
    receiveShare({
      files: [
        { kind: "file", uri: "file:///s/report.pdf", name: "report.pdf", size: 10 },
        { kind: "video", uri: "file:///s/clip.mp4", name: "clip.mp4", size: 20 },
      ],
    }),
  );
  const { File } = jest.requireMock("expo-file-system") as { File: jest.Mock };
  File.mockImplementation((uri: string) => ({ base64: async () => `b64:${uri}`, size: 10, delete: jest.fn() }));
  const t = await render();
  expect(texts(t)).toContain("1 video and 1 file");
  // The last agent is selected at the start.
  await press(t, "Send to Docs");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  const methods = mockCall.mock.calls.map((c) => c[0]);
  expect(methods).toEqual(["files.put", "files.put", "herdr.call"]);
  const prompt = (mockCall.mock.calls[2][1] as unknown as { params: { text: string } }).params.text;
  expect(prompt).toBe(
    [
      "/home/sam/.cache/herdling/uploads/report.pdf",
      "(The next file is a video. Use ffmpeg to look at frames if you need them.)",
      "/home/sam/.cache/herdling/uploads/clip.mp4",
    ].join("\n"),
  );
  expect(mockPush).toHaveBeenCalledWith("/session/h1/p2");
});

test("says so when the share is gone", async () => {
  act(() => clearShareContent());
  const t = await render();
  expect(texts(t)).toContain("Opening the share…");
});

test("with no agent picked, the main button opens the agent picker", async () => {
  act(() => receiveShare({ url: "https://example.com/post", files: [] }));
  const t = await render();
  await press(t, "Select an agent");
  const st = useMenuSheet.getState().state;
  expect(st.kind).toBe("open");
  expect(st.kind === "open" && st.menu.title).toBe("Send to");
  expect(mockCall).not.toHaveBeenCalled();
});
