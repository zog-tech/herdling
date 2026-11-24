import type { Hello } from "@herdling/protocol";
import { TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import NewSessionScreen from "@/app/new";
import { DemoTransport } from "@/demo/DemoTransport";
import { RpcClient } from "@/rpc/RpcClient";

import { useAgentMemory } from "./agentMemory";
import { DANGER_WARNING } from "./StartOptionsBar";
import { useStartOptionsMemory } from "./startOptionsMemory";

// The screen with the demo host behind it: real `fs.dirs`, `agents.installed` and `sessions.recent` answers.
const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockParams: { host?: string; workspace?: string } = {};
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ replace: mockReplace, push: mockPush, dismiss: jest.fn() }),
  useNavigation: () => ({ dispatch: jest.fn(), setOptions: jest.fn() }),
  usePreventRemove: () => {},
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-file-system", () => ({ File: jest.fn() }));
jest.mock("@/voice/MicButton", () => ({ MicButton: () => null }));
jest.mock("@/voice/useDictation", () => ({ useDictation: () => ({ state: { phase: "idle" }, dispatch: jest.fn() }) }));
jest.mock("@/hosts/store", () => ({ useHosts: (sel: (s: unknown) => unknown) => sel({ hosts: [{ id: "h1", name: "studio" }] }) }));
/** The picker sheet as the rows open it. It picks the option that `mockPickLabel` names; no name closes it. */
type MockOption = { value: unknown; label: string; detail?: string; danger?: boolean };
type MockPicker = { title: string; options?: MockOption[]; sections?: { options: MockOption[] }[]; value?: unknown; onPick: (v: unknown) => void; onClose?: () => void };
let mockPickLabel: string | undefined;
const mockShowPicker = jest.fn((o: MockPicker) => {
  const all = o.sections ? o.sections.flatMap((s) => s.options) : (o.options ?? []);
  const hit = all.find((x) => x.label === mockPickLabel);
  if (hit && !Object.is(hit.value, o.value)) o.onPick(hit.value);
  else o.onClose?.();
});
jest.mock("@/ui/PickerSheet", () => ({
  ...jest.requireActual("@/ui/PickerSheet"),
  showPicker: (o: MockPicker) => mockShowPicker(o),
}));
let mockConn: { status: string; rpc?: RpcClient; hello?: Hello } = { status: "offline" };
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => mockConn,
  useOnlineHostKey: () => "h1",
}));

let transport: DemoTransport;
let tree: ReactTestRenderer | undefined;

beforeEach(async () => {
  jest.useFakeTimers();
  transport = new DemoTransport({ active: false });
  const rpc = new RpcClient(transport);
  const hello = rpc.call<Hello>("hello");
  await jest.advanceTimersByTimeAsync(100);
  // These tests use the flow of a herdlingd without the plan C methods. The Herdr 2 tests put them back.
  const full = await hello;
  mockConn = { status: "online", rpc, hello: { ...full, methods: full.methods?.filter((m) => m !== "session.start") } };
  mockParams = {};
  useAgentMemory.setState({ byHost: {} });
  useStartOptionsMemory.setState({ byKind: {} });
  mockReplace.mockClear();
  mockPush.mockClear();
  mockShowPicker.mockClear();
  mockPickLabel = undefined;
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  mockConn.rpc?.close();
  jest.useRealTimers();
});

/** Lets the demo answers arrive. Effects that a render starts run after each `act`, so go round a few times. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
  }
}

async function render() {
  act(() => {
    tree = create(<NewSessionScreen />);
  });
  await settle();
  return tree!;
}

const byLabel = (t: ReactTestRenderer, label: string) => t.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");
const has = (t: ReactTestRenderer, label: string) => t.root.findAll((n) => n.props.accessibilityLabel === label).length > 0;
const pathInput = (t: ReactTestRenderer): ReactTestInstance => t.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === "Folder path")!;
/** The value that a setup row shows (its VoiceOver value). */
const rowValue = (t: ReactTestRenderer, title: string) => byLabel(t, title).props.accessibilityValue?.text;
/** Opens the picker of a setup row and picks the option with `label`. No label: the sheet closes with no pick. */
async function pick(t: ReactTestRenderer, title: string, label?: string) {
  mockPickLabel = label;
  await act(async () => byLabel(t, title).props.onPress());
  mockPickLabel = undefined;
}
/** The options of the picker that opened last. */
const lastOptions = () => {
  const o = mockShowPicker.mock.calls.at(-1)![0];
  return o.sections ? o.sections.flatMap((s) => s.options) : (o.options ?? []);
};
/** The Folder row: "Browse…" in its picker opens the folder browser under it; while it shows, a tap hides it. */
async function openFolders(t: ReactTestRenderer) {
  await pick(t, "Folder", "Browse…");
}
/** A recent folder is one tap in the Folder picker. */
async function pickRecent(t: ReactTestRenderer, folder: string) {
  await pick(t, "Folder", folder);
  await settle();
}
const texts = (t: ReactTestRenderer, text: string) => t.root.findAll((n) => n.props.children === text);

test("opens at home with the setup rows, recent sessions, and the folder browser behind the Folder row", async () => {
  const t = await render();
  expect(rowValue(t, "Folder")).toBe("~");
  expect(rowValue(t, "Agent")).toBe("Claude Code");
  // One computer: no Computer row.
  expect(has(t, "Computer")).toBe(false);
  expect(t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Resume: ")).length).toBeGreaterThan(0);
  // The browser is closed until "Browse…" in the Folder picker opens it.
  expect(pathInput(t)).toBeUndefined();
  expect(byLabel(t, "Folder").props.accessibilityState).toMatchObject({ expanded: false });
  await openFolders(t);
  // The picker lists the recent folders first and "Browse…" last.
  const options = lastOptions();
  expect(options.map((o) => o.label)).toContain("~/projects/webapp");
  expect(options.at(-1)?.label).toBe("Browse…");
  expect(pathInput(t).props.value).toBe("~");
  expect(has(t, "Show hidden folders")).toBe(true);
  expect(byLabel(t, "Folder").props.accessibilityState).toMatchObject({ expanded: true });
  // While the browser shows, the row hides it with no picker.
  const opened = mockShowPicker.mock.calls.length;
  await act(async () => byLabel(t, "Folder").props.onPress());
  expect(mockShowPicker.mock.calls.length).toBe(opened);
  expect(pathInput(t)).toBeUndefined();
});

test("the agent picker has Shell first, and marks an agent that is not installed", async () => {
  const t = await render();
  await pick(t, "Agent");
  const options = lastOptions();
  expect(options[0].label).toBe("Shell");
  // The demo computer has no omp: it goes to the end with a detail.
  expect(options.find((o) => o.label === "omp")).toMatchObject({ detail: "Not installed" });
  expect(options.at(-1)?.detail).toBe("Not installed");
  expect(rowValue(t, "Agent")).toBe("Claude Code");
});

test("a recent folder opens and closes the browser", async () => {
  const t = await render();
  await pickRecent(t, "~/projects/webapp");
  expect(rowValue(t, "Folder")).toBe("~/projects/webapp");
  expect(pathInput(t)).toBeUndefined();
});

test("browses down and up with rows, breadcrumbs and the Up button", async () => {
  const t = await render();
  await openFolders(t);
  await act(async () => byLabel(t, "Open projects").props.onPress());
  await settle();
  await act(async () => byLabel(t, "Open webapp, git repository").props.onPress());
  await settle();
  expect(pathInput(t).props.value).toBe("~/projects/webapp");
  await act(async () => byLabel(t, "Go up to ~").props.onPress());
  await settle();
  expect(pathInput(t).props.value).toBe("~");
  await act(async () => byLabel(t, "Up one folder").props.onPress());
  await settle();
  expect(pathInput(t).props.value).toBe("/home");
});

test("autocompletes a typed path and shows an error for a wrong one", async () => {
  const t = await render();
  await openFolders(t);
  act(() => pathInput(t).props.onChangeText("~/projects/we"));
  await settle();
  expect(has(t, "Open webapp, git repository")).toBe(true);
  await act(async () => byLabel(t, "Complete the folder name").props.onPress());
  expect(pathInput(t).props.value).toBe("~/projects/webapp/");
  act(() => pathInput(t).props.onChangeText("~/nope"));
  await act(async () => pathInput(t).props.onSubmitEditing());
  await settle();
  expect(t.root.findAll((n) => n.props.children === "No folder at ~/nope.").length).toBeGreaterThan(0);
});

test("remembers the chosen agent for the host and names it on the start button", async () => {
  const t = await render();
  await pick(t, "Agent", "Codex");
  expect(useAgentMemory.getState().byHost.h1).toBe("codex");
  expect(rowValue(t, "Agent")).toBe("Codex");
  expect(has(t, "Start Codex here")).toBe(true);
});

test("starts the agent in the open folder", async () => {
  const t = await render();
  await pickRecent(t, "~/projects/api-server");
  await act(async () => byLabel(t, "Start Claude Code here").props.onPress());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  expect(mockReplace).toHaveBeenCalledWith(expect.stringMatching(/^\/session\/h1\//));
});

test("starts in a new workspace by default, not in a tab of another workspace", async () => {
  const call = jest.spyOn(mockConn.rpc!, "call");
  const t = await render();
  await pickRecent(t, "~/projects/api-server");
  await act(async () => byLabel(t, "Start Claude Code here").props.onPress());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  const methods = call.mock.calls.filter(([m]) => m === "herdr.call").map(([, p]) => (p as { method: string }).method);
  expect(methods).toContain("workspace.create");
  expect(methods).not.toContain("tab.create");
});

test("opens a shell with no agent, runs the typed command and does not remember Shell", async () => {
  const t = await render();
  await pick(t, "Agent", "Codex");
  await pick(t, "Agent", "Shell");
  // The agent memory keeps the agent, so the next session starts with it.
  expect(useAgentMemory.getState().byHost.h1).toBe("codex");
  expect(has(t, "Open shell here")).toBe(true);
  // No recent agent sessions for a shell; the prompt box asks for a command.
  expect(t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Resume: "))).toHaveLength(0);
  const box = t.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === "Command (optional)")!;
  act(() => box.props.onChangeText("pwd"));
  await pickRecent(t, "~/projects/api-server");
  await act(async () => byLabel(t, "Open shell here").props.onPress());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  expect(mockReplace).toHaveBeenCalledWith({ pathname: "/session/[hostId]/[paneId]", params: expect.objectContaining({ hostId: "h1", shell: "1" }) });
  const { paneId } = mockReplace.mock.calls[0][0].params;
  // The demo host: the pane has no agent, and the command ran in it.
  // The demo answers after a short delay.
  const snap = mockConn.rpc!.call<{ snapshot: { agents: { pane_id: string }[] } }>("herdr.call", { method: "session.snapshot", params: {} });
  const read = mockConn.rpc!.call<{ read: { text: string } }>("herdr.call", { method: "pane.read", params: { pane_id: paneId } });
  await jest.advanceTimersByTimeAsync(500);
  expect((await snap).snapshot.agents.some((a) => a.pane_id === paneId)).toBe(false);
  expect((await read).read.text).toContain("$ pwd\n/home/demo/projects/api-server");
});

/** The `args` of each `agent.start` call. */
const startArgs = (calls: jest.SpyInstance) =>
  calls.mock.calls
    .filter(([m, p]) => m === "herdr.call" && (p as { method: string }).method === "agent.start")
    .map(([, p]) => (p as { params: { args?: string[] } }).params.args);

describe("start options", () => {
  test("the Permissions row picks a mode in the picker, the model reaches agent.start, and a danger mode shows the warning", async () => {
    useStartOptionsMemory.setState({ byKind: { claude: { model: "opus" } } });
    const t = await render();
    const calls = jest.spyOn(mockConn.rpc!, "call");
    expect(rowValue(t, "Permissions")).toBe("Default");
    expect(rowValue(t, "Options")).toBe("Opus");
    expect(texts(t, DANGER_WARNING)).toHaveLength(0);

    await pick(t, "Permissions", "Skip permissions");
    const [sheet] = mockShowPicker.mock.calls[0];
    expect(sheet.title).toBe("Permission mode");
    expect(lastOptions().map((o) => o.label)).toEqual(["Default", "Plan", "Accept edits", "Auto", "Skip permissions"]);
    expect(lastOptions().every((o) => !!o.detail)).toBe(true);
    // The mode with no approval has the danger tone in the picker; the others do not.
    expect(lastOptions().filter((o) => o.danger).map((o) => o.label)).toEqual(["Skip permissions"]);
    expect(rowValue(t, "Permissions")).toBe("Skip permissions");
    // The warning is the detail of the row.
    expect(texts(t, DANGER_WARNING).length).toBeGreaterThan(0);

    await pickRecent(t, "~/projects/api-server");
    await act(async () => byLabel(t, "Start Claude Code here").props.onPress());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(startArgs(calls)).toEqual([["--dangerously-skip-permissions", "--model", "opus"]]);
    // Remembered for the next session of the same agent.
    expect(useStartOptionsMemory.getState().byKind.claude).toEqual({ mode: "skip", model: "opus" });
  });

  test("a close of the mode picker with no pick changes nothing", async () => {
    const t = await render();
    await pick(t, "Permissions");
    expect(rowValue(t, "Permissions")).toBe("Default");
    expect(useStartOptionsMemory.getState().byKind).toEqual({});
  });

  test("the Options row opens the options sheet and shows the model and the extra flags", async () => {
    const t = await render();
    await act(async () => byLabel(t, "Options").props.onPress());
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/start-options", params: { kind: "claude" } });
    expect(rowValue(t, "Options")).toBe("Default");
    // A model alias shows as its label; the extra flags are the detail.
    act(() => {
      useStartOptionsMemory.setState({ byKind: { claude: { model: "opus", extra: "--a b" } } });
    });
    expect(rowValue(t, "Options")).toBe("Opus");
    expect(texts(t, "2 extra flags").length).toBeGreaterThan(0);
  });

  test("each agent kind keeps its own options, Pi has a Thinking row, and a shell has no option rows", async () => {
    useStartOptionsMemory.setState({ byKind: { claude: { mode: "plan" }, codex: { mode: "gone" } } });
    const t = await render();
    expect(rowValue(t, "Permissions")).toBe("Plan");
    await pick(t, "Agent", "Codex");
    // An unknown stored mode falls back to Default.
    expect(rowValue(t, "Permissions")).toBe("Default");
    await pick(t, "Agent", "Pi");
    expect(has(t, "Permissions")).toBe(false);
    expect(rowValue(t, "Thinking")).toBe("Default");
    await pick(t, "Thinking", "High");
    expect(rowValue(t, "Thinking")).toBe("High");
    expect(useStartOptionsMemory.getState().byKind.pi).toEqual({ thinking: "high" });
    await pick(t, "Agent", "Shell");
    const rows = t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && /^(Permissions|Thinking|Options)$/.test(n.props.accessibilityLabel));
    expect(rows).toHaveLength(0);
  });

  test("a resume does not use the start options", async () => {
    useStartOptionsMemory.setState({ byKind: { claude: { mode: "skip" } } });
    const t = await render();
    const calls = jest.spyOn(mockConn.rpc!, "call");
    const [card] = t.root.findAll(
      (n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Resume: ") && typeof n.props.onPress === "function",
    );
    await act(async () => card.props.onPress());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    const [args] = startArgs(calls);
    expect(args?.[0]).toBe("--resume");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });
});

test("offers the new git worktree option in a repo", async () => {
  const t = await render();
  expect(has(t, "In a new git worktree")).toBe(false);
  await pickRecent(t, "~/projects/webapp");
  expect(has(t, "In a new git worktree")).toBe(true);
});

describe("start in a new git worktree", () => {
  const herdrCalls = (spy: jest.SpyInstance) =>
    spy.mock.calls.filter(([m]) => m === "herdr.call").map(([, p]) => (p as { method: string; params: Record<string, unknown> }));

  async function startInWorktree() {
    const t = await render();
    await pickRecent(t, "~/projects/webapp");
    const toggle = t.root.find((n) => n.props.accessibilityLabel === "In a new git worktree" && typeof n.props.onValueChange === "function");
    act(() => toggle.props.onValueChange(true));
    await act(async () => byLabel(t, "Start Claude Code here").props.onPress());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    return t;
  }

  test("an older herdlingd: the app makes a workspace in the worktree folder", async () => {
    const call = jest.spyOn(mockConn.rpc!, "call");
    await startInWorktree();
    const worktree = call.mock.calls.find(([m]) => m === "git.worktree_add");
    expect(worktree).toBeDefined();
    const created = herdrCalls(call).find((c) => c.method === "workspace.create");
    expect(created?.params.cwd).toMatch(/\/\.worktrees\/herdling-/);
    expect(mockReplace).toHaveBeenCalledWith(expect.stringMatching(/^\/session\/h1\//));
  });

  test("herdr made the worktree workspace: the agent starts in its pane, with no second workspace", async () => {
    const rpc = mockConn.rpc!;
    const real = rpc.call.bind(rpc) as (...a: unknown[]) => Promise<unknown>;
    const call = jest.spyOn(rpc, "call").mockImplementation(((method: string, params: { method?: string }, ...rest: unknown[]) => {
      if (method === "git.worktree_add")
        return Promise.resolve({
          path: "/home/demo/projects/webapp/.worktrees/herdling-x",
          branch: "herdling/x",
          root: "/home/demo/projects/webapp",
          via: "herdr",
          workspace_id: "w42",
          tab_id: "w42:t1",
          pane_id: "w42:p1",
        });
      if (method === "herdr.call" && (params.method === "agent.start" || params.method === "agent.prompt")) return Promise.resolve({ type: "ok" });
      return real(method, params, ...rest);
    }) as never);
    await startInWorktree();
    const methods = herdrCalls(call).map((c) => c.method);
    expect(methods).not.toContain("workspace.create");
    expect(methods).not.toContain("tab.create");
    expect(herdrCalls(call).find((c) => c.method === "agent.start")?.params.pane_id).toBe("w42:p1");
    expect(mockReplace).toHaveBeenCalledWith("/session/h1/w42:p1");
  });
});

test("resumes a recent session through the resume path", async () => {
  const t = await render();
  const [card] = t.root.findAll(
    (n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Resume: ") && typeof n.props.onPress === "function",
  );
  await act(async () => card.props.onPress());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  expect(mockReplace).toHaveBeenCalledWith(expect.stringMatching(/^\/session\/h1\//));
});

test("shows every agent normally on a herdlingd without agents.installed", async () => {
  const methods = mockConn.hello!.methods!.filter((m) => m !== "agents.installed");
  mockConn = { ...mockConn, hello: { ...mockConn.hello!, methods } };
  const t = await render();
  await pick(t, "Agent");
  const omp = lastOptions().find((o) => o.label === "omp");
  expect(omp).toBeDefined();
  expect(omp?.detail).toBeUndefined();
});

describe("long pastes in the first prompt", () => {
  const block = Array.from({ length: 30 }, (_, i) => `log line ${i + 1}`).join("\n");
  const box = (t: ReactTestRenderer, label: string) => t.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === label)!;
  const firstPrompt = (t: ReactTestRenderer) => box(t, "First prompt (optional)");

  test("a long paste becomes a chip, and Start uploads it and puts its path in the first prompt", async () => {
    const t = await render();
    const calls = jest.spyOn(mockConn.rpc!, "call");
    act(() => firstPrompt(t).props.onChangeText("Why does this fail? "));
    act(() => firstPrompt(t).props.onChangeText(`Why does this fail? ${block}`));
    expect(firstPrompt(t).props.value).toBe("Why does this fail? ");
    expect(has(t, "Pasted text #1 · 30 lines")).toBe(true);
    // The remove button drops a chip.
    act(() => firstPrompt(t).props.onChangeText(`Why does this fail? ${block}`));
    expect(has(t, "Pasted text #2 · 30 lines")).toBe(true);
    await act(async () => byLabel(t, "Remove pasted text 2").props.onPress());
    expect(has(t, "Pasted text #2 · 30 lines")).toBe(false);

    await pickRecent(t, "~/projects/api-server");
    await act(async () => byLabel(t, "Start Claude Code here").props.onPress());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(mockReplace).toHaveBeenCalledWith(expect.stringMatching(/^\/session\/h1\//));
    const puts = calls.mock.calls.filter(([m]) => m === "files.put").map(([, p]) => p);
    expect(puts).toEqual([{ name: "pasted-text-1.txt", data_b64: Buffer.from(block, "utf8").toString("base64") }]);
    const prompts = calls.mock.calls
      .filter(([m, p]) => m === "herdr.call" && (p as { method: string }).method === "agent.prompt")
      .map(([, p]) => (p as { params: { text: string } }).params.text);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatch(/^Why does this fail\?\n~\/\.cache\/herdling\/uploads\/\d+-pasted-text-1\.txt$/);
  });

  test("a failed upload starts nothing and keeps the chip", async () => {
    const t = await render();
    const rpc = mockConn.rpc!;
    const real = rpc.call.bind(rpc) as (...a: unknown[]) => Promise<unknown>;
    jest
      .spyOn(rpc, "call")
      .mockImplementation(((method: string, ...rest: unknown[]) =>
        method === "files.put" ? Promise.reject(new Error("disk full")) : real(method, ...rest)) as never);
    act(() => firstPrompt(t).props.onChangeText(block));
    await pickRecent(t, "~/projects/api-server");
    await act(async () => byLabel(t, "Start Claude Code here").props.onPress());
    await settle();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(t.root.findAll((n) => n.props.children === "Upload failed, nothing started: disk full").length).toBeGreaterThan(0);
    expect(has(t, "Pasted text #1 · 30 lines")).toBe(true);
  });

  test("a shell command makes no chip", async () => {
    const t = await render();
    await pick(t, "Agent", "Shell");
    act(() => box(t, "Command (optional)").props.onChangeText(block));
    expect(box(t, "Command (optional)").props.value).toBe(block);
    expect(has(t, "Pasted text #1 · 30 lines")).toBe(false);
  });
});

describe("Herdr 2 spaces", () => {
  /** The full demo hello: a herdlingd with the plan C methods and a core. */
  async function coreHost() {
    const hello = await mockConn.rpc!.call<Hello>("hello");
    mockConn = { ...mockConn, hello };
  }

  it("starts the agent with session.start in the picked space", async () => {
    const pending = coreHost();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    await pending;
    const call = jest.spyOn(mockConn.rpc!, "call");
    const t = await render();
    // The spaces of groups.list: New space first, then each space; a repo group is not a choice.
    expect(rowValue(t, "Space")).toBe("New space");
    await pick(t, "Space");
    expect(lastOptions()[0]).toMatchObject({ value: null, label: "New space" });
    expect(lastOptions().some((o) => o.label === "research")).toBe(true);
    await pickRecent(t, "~/projects/webapp");
    await pick(t, "Space", "research");
    expect(rowValue(t, "Space")).toBe("research");
    await act(async () => byLabel(t, "Start Claude Code here").props.onPress());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    const start = call.mock.calls.find(([m]) => m === "session.start");
    expect(start?.[1]).toMatchObject({ cwd: "/home/demo/projects/webapp", kind: "claude", workspace_id: "space:r1" });
    // No herdr 1 workspace.
    expect(call.mock.calls.filter(([m]) => m === "herdr.call").map(([, p]) => (p as { method: string }).method)).not.toContain("workspace.create");
    expect(mockReplace).toHaveBeenCalledWith(expect.stringMatching(/^\/session\/h1\/t\d+$/));
  });

  it("selects the space from the space screen, and a shell in a new space asks for the core", async () => {
    const pending = coreHost();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    await pending;
    mockParams = { host: "h1", workspace: "space:r1" };
    const call = jest.spyOn(mockConn.rpc!, "call");
    const t = await render();
    expect(rowValue(t, "Space")).toBe("research");
    await pick(t, "Space", "New space");
    expect(rowValue(t, "Space")).toBe("New space");
    await pick(t, "Agent", "Shell");
    await pickRecent(t, "~/projects/webapp");
    await act(async () => byLabel(t, "Open shell here").props.onPress());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    const create = call.mock.calls.find(([m, p]) => m === "herdr.call" && (p as { method: string }).method === "workspace.create");
    expect((create?.[1] as { params: unknown }).params).toMatchObject({ backend: "core" });
  });
});
