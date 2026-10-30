import { readFileSync } from "fs";
import { join } from "path";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useSnapshots } from "@/herdr/snapshotStore";
import { hitTarget } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { MicButton } from "@/voice/MicButton";

import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";

import { clearCommandsCache } from "./commands";
import { pendingOf, usePending } from "./pending";
import { Composer } from "./Composer";

const screen = readFileSync(join(__dirname, "__fixtures__", "claude_bash_permission.txt"), "utf8");

const mockCalls: any[] = [];
const mockRpcCalls: { method: string; params: any }[] = [];
const mockCommands = [
  { name: "clear", description: "Clear the conversation history", source: "builtin" },
  { name: "compact", source: "builtin" },
  { name: "tools:compact-all", description: "Compact all", source: "plugin" },
  { name: "deploy", source: "user" },
];
let mockUploadFails = false;
const mockRpc = {
  call: async (method: string, params: any) => {
    mockRpcCalls.push({ method, params });
    if (method === "commands.list") return { commands: mockCommands };
    if (method === "files.put") {
      if (mockUploadFails) throw new Error("disk full");
      return { path: `/up/${mockRpcCalls.filter((c) => c.method === "files.put").length}-${params.name}` };
    }
    mockCalls.push(params);
    return params.method === "pane.read" ? { read: { text: screen } } : {};
  },
};
let mockHello: any;
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc, hello: mockHello }),
}));
jest.mock("@/voice/MicButton", () => ({ MicButton: () => null }));
let mockVoicePhase = "idle";
const mockVoiceDispatch = jest.fn();
let mockOnText: ((t: string) => void) | undefined;
jest.mock("@/voice/useDictation", () => ({
  useDictation: (o: { onText: (t: string) => void }) => {
    mockOnText = o.onText;
    return { state: { phase: mockVoicePhase, partial: "" }, dispatch: mockVoiceDispatch, clearError: () => {} };
  },
}));
jest.mock("expo-file-system", () => ({ File: class {} }));
jest.mock("@/voice/RecordBar", () => ({ RecordBar: () => null }));
const { RecordBar: MockRecordBar } = jest.requireMock("@/voice/RecordBar");
jest.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));
// The test runtime has no ExpoClipboard native module: report it as present.
jest.mock("expo", () => {
  const actual = jest.requireActual("expo");
  return { ...actual, requireOptionalNativeModule: (n: string) => (n === "ExpoClipboard" ? {} : actual.requireOptionalNativeModule(n)) };
});
jest.mock("expo-clipboard", () => ({
  hasImageAsync: jest.fn(async () => false),
  getImageAsync: jest.fn(),
  addClipboardListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock("@/ui/haptics", () => ({ tap: jest.fn(), press: jest.fn(), commit: jest.fn(), warn: jest.fn(), fail: jest.fn() }));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
const choiceButtons = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && /^\d\. /.test(n.props.accessibilityLabel) && !!n.props.onPress);
const sends = () => mockCalls.filter((c) => c.method === "pane.send_keys");

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  usePending.setState({ byPane: {} });
  mockCalls.length = 0;
  mockRpcCalls.length = 0;
  mockHello = undefined;
  mockUploadFails = false;
  mockVoicePhase = "idle";
  mockVoiceDispatch.mockClear();
  clearCommandsCache();
  useSnapshots.setState({ byHost: { "host-1": { agents: [{ pane_id: "w1:p1", agent_status: "blocked" }] } as any }, errors: {} });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

test("a double tap sends one digit and the answered menu hides", async () => {
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  await flush();
  const buttons = choiceButtons(tree!);
  expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual([
    "1. Yes",
    "2. Yes, and don't ask again for git status commands in /home/sam/proj",
    "3. No, and tell Claude what to do differently (esc)",
  ]);

  await act(async () => {
    buttons[0].props.onPress();
    buttons[0].props.onPress();
  });
  await flush();
  expect(sends()).toEqual([{ method: "pane.send_keys", params: { pane_id: "w1:p1", keys: ["1"] } }]);
  expect(choiceButtons(tree!)).toHaveLength(0);
  // Approve: one success haptic.
  expect(haptics.commit).toHaveBeenCalledTimes(1);
  expect(haptics.warn).not.toHaveBeenCalled();

  // The same menu is still on screen at the next poll: the buttons stay hidden, so no second digit can go out.
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
  await flush();
  expect(choiceButtons(tree!)).toHaveLength(0);
  expect(sends()).toHaveLength(1);
});

test("hidden_composer_polls_nothing_and_has_no_mic", async () => {
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} visible={false} />);
  });
  await act(async () => {
    jest.advanceTimersByTime(3_000);
  });
  await flush();
  expect(mockCalls).toHaveLength(0);
  expect(tree!.root.findAll((n) => n.type === MicButton)).toHaveLength(0);

  await act(async () => tree!.update(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} visible />));
  await flush();
  expect(mockCalls.filter((c) => c.method === "pane.read").length).toBeGreaterThan(0);
  expect(tree!.root.findAll((n) => n.type === MicButton)).toHaveLength(1);
});

test("mic_and_send_have_the_same_size", async () => {
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  const mic = tree!.root.findAll((n) => n.type === MicButton)[0];
  expect(mic.props.size).toBe(hitTarget);
  const send = tree!.root.find((n) => n.props.accessibilityLabel === "Send" && typeof n.props.style === "function");
  const style = send.props.style({ pressed: false });
  expect(style.width).toBe(hitTarget);
  expect(style.height).toBe(hitTarget);
});

const idle = (agent = "claude") =>
  useSnapshots.setState({
    byHost: { "host-1": { agents: [{ pane_id: "w1:p1", agent, agent_status: "idle", cwd: "/work/proj" }] } as any },
    errors: {},
  });
const prompt = (t: ReactTestRenderer) => t.root.find((n) => n.props.accessibilityLabel === "Prompt" && !!n.props.onChangeText);
const menuRows = (t: ReactTestRenderer) =>
  t.root
    .findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("/") && !!n.props.onPress)
    .map((n) => n.props.accessibilityLabel);

test("typing_slash_shows_the_filtered_menu_and_a_tap_fills_the_name", async () => {
  idle();
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  expect(mockRpcCalls.filter((c) => c.method === "commands.list")).toHaveLength(0);
  await act(async () => prompt(tree!).props.onChangeText("/comp"));
  await flush();
  expect(menuRows(tree!)).toEqual(["/compact", "/tools:compact-all"]);
  expect(mockRpcCalls.filter((c) => c.method === "commands.list")).toEqual([
    { method: "commands.list", params: { pane_id: "w1:p1", cwd: "/work/proj" } },
  ]);

  const row = tree!.root.find((n) => n.props.accessibilityLabel === "/tools:compact-all" && !!n.props.onPress);
  await act(async () => row.props.onPress());
  expect(prompt(tree!).props.value).toBe("/tools:compact-all ");
  expect(menuRows(tree!)).toEqual([]);

  // A second `/` uses the list already fetched.
  await act(async () => prompt(tree!).props.onChangeText("/"));
  await flush();
  expect(menuRows(tree!)).toHaveLength(4);
  expect(mockRpcCalls.filter((c) => c.method === "commands.list")).toHaveLength(1);
});

test("no_menu_for_other_agents", async () => {
  idle("codex");
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  await act(async () => prompt(tree!).props.onChangeText("/c"));
  await flush();
  expect(menuRows(tree!)).toEqual([]);
  expect(mockRpcCalls.filter((c) => c.method === "commands.list")).toHaveLength(0);
});

const byLabel = (t: ReactTestRenderer, label: string) =>
  t.root.findAll((n) => n.props.accessibilityLabel === label && !!n.props.onPress);
const press = async (t: ReactTestRenderer, label: string) => {
  await act(async () => byLabel(t, label)[0].props.onPress());
  await flush();
};
const helloWith = (methods: string[]) => ({ host: "h", os: "linux", zogsshd: "1", herdr_ok: true, methods });
const pickerReturns = (names: string[]) =>
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
    canceled: false,
    assets: names.map((n) => ({ uri: `file:///${n}`, fileName: n, base64: `b64-${n}`, width: 1, height: 1 })),
  });
const prompts = () => mockCalls.filter((c) => c.method === "agent.prompt").map((c) => c.params.text);

test("attach_photos_uploads_them_then_sends_the_paths", async () => {
  idle();
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  await press(tree!, "Add");
  expect(byLabel(tree!, "Photos")).toHaveLength(1);
  expect(byLabel(tree!, "Commands & skills")).toHaveLength(1);

  pickerReturns(["IMG_1.HEIC", "b.png"]);
  await press(tree!, "Photos");
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
    expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 4, quality: 0.8, base64: true, mediaTypes: ["images"] }),
  );
  expect(byLabel(tree!, "Photos")).toHaveLength(0);
  expect(byLabel(tree!, "Remove photo 1")).toHaveLength(1);
  expect(byLabel(tree!, "Remove photo 2")).toHaveLength(1);

  await act(async () => prompt(tree!).props.onChangeText("What is wrong here?"));
  await press(tree!, "Send");
  expect(mockRpcCalls.filter((c) => c.method === "files.put").map((c) => c.params)).toEqual([
    { name: "IMG_1.jpg", data_b64: "b64-IMG_1.HEIC" },
    { name: "b.jpg", data_b64: "b64-b.png" },
  ]);
  expect(prompts()).toEqual(["What is wrong here?\n/up/1-IMG_1.jpg\n/up/2-b.jpg"]);
  expect(byLabel(tree!, "Remove photo 1")).toHaveLength(0);
  expect(prompt(tree!).props.value).toBe("");
  // The sent prompt waits as a pending bubble; the accepted send gives one success haptic.
  expect(pendingOf("host-1", "w1:p1").map((p) => p.state)).toEqual(["queued"]);
  expect(haptics.commit).toHaveBeenCalledTimes(1);
});

test("a_failed_upload_sends_nothing_and_shows_the_error", async () => {
  idle();
  mockUploadFails = true;
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  await press(tree!, "Add");
  pickerReturns(["a.jpg"]);
  await press(tree!, "Photos");
  await act(async () => prompt(tree!).props.onChangeText("look"));
  await press(tree!, "Send");
  expect(prompts()).toEqual([]);
  expect(tree!.root.findAll((n) => n.props.children === "Photo upload failed, nothing sent: disk full").length).toBeGreaterThan(0);
  // The photo and the text stay for a retry.
  expect(byLabel(tree!, "Remove photo 1")).toHaveLength(1);
  expect(prompt(tree!).props.value).toBe("look");
});

test("a_removed_photo_is_not_uploaded", async () => {
  idle();
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  await press(tree!, "Add");
  pickerReturns(["a.jpg", "b.jpg"]);
  await press(tree!, "Photos");
  await press(tree!, "Remove photo 1");
  await press(tree!, "Send");
  expect(mockRpcCalls.filter((c) => c.method === "files.put").map((c) => c.params.name)).toEqual(["b.jpg"]);
  expect(prompts()).toEqual(["/up/1-b.jpg"]);
});

test("plus_menu_rows_follow_the_host_methods", async () => {
  idle();
  mockHello = helloWith(["files.put"]);
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  await press(tree!, "Add");
  expect(byLabel(tree!, "Photos")).toHaveLength(1);
  expect(byLabel(tree!, "Commands & skills")).toHaveLength(0);
  act(() => tree!.unmount());

  mockHello = helloWith(["commands.list"]);
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  await press(tree!, "Add");
  expect(byLabel(tree!, "Photos")).toHaveLength(0);
  expect(byLabel(tree!, "Commands & skills")).toHaveLength(1);
  act(() => tree!.unmount());

  mockHello = helloWith([]);
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  expect(byLabel(tree!, "Add")).toHaveLength(0);
});

test("commands_sheet_lists_by_source_and_a_tap_fills_the_name", async () => {
  idle();
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  await press(tree!, "Add");
  await press(tree!, "Commands & skills");
  const headers = () =>
    tree!.root.findAll((n) => n.props.accessibilityRole === "header" && typeof n.props.children === "string").map((n) => n.props.children);
  // The sheet title is a header too.
  expect([...new Set(headers())]).toEqual(["Commands & skills", "Built-in", "User", "Plugins"]);

  const search = tree!.root.find((n) => n.props.accessibilityLabel === "Search commands" && !!n.props.onChangeText);
  await act(async () => search.props.onChangeText("dep"));
  expect([...new Set(headers())]).toEqual(["Commands & skills", "User"]);

  await press(tree!, "/deploy");
  expect(prompt(tree!).props.value).toBe("/deploy ");
});

const focusPrompt = async (t: ReactTestRenderer) => {
  await act(async () => prompt(t).props.onFocus());
  await flush();
};
const clipboardHolds = (has: boolean) => (Clipboard.hasImageAsync as jest.Mock).mockResolvedValue(has);
const mountWithPut = async () => {
  idle();
  mockHello = helloWith(["files.put"]);
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
};

test("paste_chip_shows_for_a_clipboard_image_and_hides_after_the_paste", async () => {
  clipboardHolds(true);
  (Clipboard.getImageAsync as jest.Mock).mockResolvedValue({ data: "data:image/jpeg;base64,QUJD", size: { width: 1, height: 1 } });
  await mountWithPut();
  expect(byLabel(tree!, "Paste image")).toHaveLength(0);
  await focusPrompt(tree!);
  expect(byLabel(tree!, "Paste image")).toHaveLength(1);
  // Checking the types must not read the image (that shows the iOS prompt).
  expect(Clipboard.getImageAsync).not.toHaveBeenCalled();

  await press(tree!, "Paste image");
  expect(haptics.tap).toHaveBeenCalledTimes(1);
  expect(Clipboard.getImageAsync).toHaveBeenCalledWith({ format: "jpeg", jpegQuality: 0.8 });
  expect(byLabel(tree!, "Remove photo 1")).toHaveLength(1);
  expect(byLabel(tree!, "Paste image")).toHaveLength(0);
  // The same image is still on the clipboard: the next focus does not bring the chip back.
  await focusPrompt(tree!);
  expect(byLabel(tree!, "Paste image")).toHaveLength(0);

  await press(tree!, "Send");
  expect(mockRpcCalls.filter((c) => c.method === "files.put").map((c) => c.params)).toEqual([
    { name: "pasted-1.jpg", data_b64: "QUJD" },
  ]);
  // A clipboard change brings the chip back.
  const onChange = (Clipboard.addClipboardListener as jest.Mock).mock.calls[0][0];
  await act(async () => onChange({ contentTypes: ["image"] }));
  await flush();
  expect(byLabel(tree!, "Paste image")).toHaveLength(1);
});

test("paste_image_row_is_in_the_plus_menu", async () => {
  clipboardHolds(true);
  await mountWithPut();
  await press(tree!, "Add");
  expect(byLabel(tree!, "Paste image")).toHaveLength(1);
});

test("paste_stops_at_the_photo_max", async () => {
  clipboardHolds(true);
  (Clipboard.getImageAsync as jest.Mock).mockResolvedValue({ data: "data:image/jpeg;base64,QUJD", size: { width: 1, height: 1 } });
  await mountWithPut();
  pickerReturns(["a.jpg", "b.jpg", "c.jpg"]);
  await press(tree!, "Add");
  await press(tree!, "Photos");
  await focusPrompt(tree!);
  await press(tree!, "Paste image");
  expect(byLabel(tree!, "Remove photo 4")).toHaveLength(1);
  // Four photos: no chip, even after a clipboard change.
  const onChange = (Clipboard.addClipboardListener as jest.Mock).mock.calls[0][0];
  await act(async () => onChange({ contentTypes: ["image"] }));
  await flush();
  expect(byLabel(tree!, "Paste image")).toHaveLength(0);
  await press(tree!, "Add");
  expect(byLabel(tree!, "Paste image")).toHaveLength(0);
});

test("paste_chip_is_hidden_without_files_put", async () => {
  clipboardHolds(true);
  idle();
  mockHello = helloWith(["commands.list"]);
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} />);
  });
  await focusPrompt(tree!);
  expect(byLabel(tree!, "Paste image")).toHaveLength(0);
  await press(tree!, "Add");
  expect(byLabel(tree!, "Paste image")).toHaveLength(0);
  expect(Clipboard.hasImageAsync).not.toHaveBeenCalled();
});

test("recording_swaps_the_box_for_the_record_bar_and_the_text_lands_appended", async () => {
  mockVoicePhase = "recording";
  await act(async () => {
    tree = create(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} initialText="fix the bug" />);
  });
  expect(tree!.root.findAll((n) => n.type === MockRecordBar)).toHaveLength(1);
  expect(tree!.root.findAll((n) => n.props.accessibilityLabel === "Prompt" && !!n.props.onChangeText)).toHaveLength(0);
  const check = tree!.root.find((n) => n.props.accessibilityLabel === "Stop and transcribe" && !!n.props.onPress);
  act(() => check.props.onPress());
  expect(mockVoiceDispatch).toHaveBeenCalledWith({ type: "toggle" });

  mockVoicePhase = "idle";
  await act(async () => tree!.update(<Composer hostId="host-1" paneId="w1:p1" bottomInset={0} initialText="fix the bug" />));
  act(() => mockOnText!("in the parser"));
  expect(prompt(tree!).props.value).toBe("fix the bug in the parser");
  // The text is not sent.
  expect(mockCalls.filter((c) => c.method !== "pane.read")).toHaveLength(0);
});

test("composer_and_pending_bubbles_are_memoized", () => {
  // The session screen re-renders on every thread update; these skip when their props are equal.
  const { PendingBubbles } = jest.requireActual("./items/PendingBubble");
  expect((Composer as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  expect((PendingBubbles as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
});
