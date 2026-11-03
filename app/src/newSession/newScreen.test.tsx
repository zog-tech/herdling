import type { Hello } from "@herdling/protocol";
import { TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import NewSessionScreen from "@/app/new";
import { DemoTransport } from "@/demo/DemoTransport";
import { RpcClient } from "@/rpc/RpcClient";

import { useAgentMemory } from "./agentMemory";

// The screen with the demo host behind it: real `fs.dirs`, `agents.installed` and `sessions.recent` answers.
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, dismiss: jest.fn() }),
  useNavigation: () => ({ dispatch: jest.fn(), setOptions: jest.fn() }),
  usePreventRemove: () => {},
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-file-system", () => ({ File: jest.fn() }));
jest.mock("@/voice/MicButton", () => ({ MicButton: () => null }));
jest.mock("@/voice/useDictation", () => ({ useDictation: () => ({ state: { phase: "idle" }, dispatch: jest.fn() }) }));
jest.mock("@/hosts/store", () => ({ useHosts: (sel: (s: unknown) => unknown) => sel({ hosts: [{ id: "h1", name: "studio" }] }) }));
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
  mockConn = { status: "online", rpc, hello: await hello };
  useAgentMemory.setState({ byHost: {} });
  mockReplace.mockClear();
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

test("opens at home with the agent row, recent folders and recent sessions", async () => {
  const t = await render();
  expect(pathInput(t).props.value).toBe("~");
  expect(has(t, "Claude Code")).toBe(true);
  // The demo computer has no omp: dimmed and marked.
  expect(has(t, "omp, not installed")).toBe(true);
  expect(has(t, "Recent folder ~/projects/webapp")).toBe(true);
  expect(t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Resume: ")).length).toBeGreaterThan(0);
  expect(has(t, "Show hidden folders")).toBe(true);
});

test("browses down and up with rows, breadcrumbs and the Up button", async () => {
  const t = await render();
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
  await act(async () => byLabel(t, "Codex").props.onPress());
  expect(useAgentMemory.getState().byHost.h1).toBe("codex");
  expect(has(t, "Start Codex here")).toBe(true);
});

test("starts the agent in the open folder", async () => {
  const t = await render();
  await act(async () => byLabel(t, "Recent folder ~/projects/api-server").props.onPress());
  await settle();
  await act(async () => byLabel(t, "Start Claude Code here").props.onPress());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5000);
  });
  expect(mockReplace).toHaveBeenCalledWith(expect.stringMatching(/^\/session\/h1\//));
});

test("opens a shell with no agent, runs the typed command and does not remember Shell", async () => {
  const t = await render();
  await act(async () => byLabel(t, "Codex").props.onPress());
  await act(async () => byLabel(t, "Shell").props.onPress());
  // The agent memory keeps the agent, so the next session starts with it.
  expect(useAgentMemory.getState().byHost.h1).toBe("codex");
  expect(has(t, "Open shell here")).toBe(true);
  // No recent agent sessions for a shell; the prompt box asks for a command.
  expect(t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Resume: "))).toHaveLength(0);
  const box = t.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === "Command (optional)")!;
  act(() => box.props.onChangeText("pwd"));
  await act(async () => byLabel(t, "Recent folder ~/projects/api-server").props.onPress());
  await settle();
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

test("offers the new git worktree option in a repo", async () => {
  const t = await render();
  expect(has(t, "In a new git worktree")).toBe(false);
  await act(async () => byLabel(t, "Recent folder ~/projects/webapp").props.onPress());
  await settle();
  expect(has(t, "In a new git worktree")).toBe(true);
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
  expect(has(t, "omp")).toBe(true);
  expect(has(t, "omp, not installed")).toBe(false);
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

    await act(async () => byLabel(t, "Recent folder ~/projects/api-server").props.onPress());
    await settle();
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
    await act(async () => byLabel(t, "Recent folder ~/projects/api-server").props.onPress());
    await settle();
    await act(async () => byLabel(t, "Start Claude Code here").props.onPress());
    await settle();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(t.root.findAll((n) => n.props.children === "Upload failed, nothing started: disk full").length).toBeGreaterThan(0);
    expect(has(t, "Pasted text #1 · 30 lines")).toBe(true);
  });

  test("a shell command makes no chip", async () => {
    const t = await render();
    await act(async () => byLabel(t, "Shell").props.onPress());
    act(() => box(t, "Command (optional)").props.onChangeText(block));
    expect(box(t, "Command (optional)").props.value).toBe(block);
    expect(has(t, "Pasted text #1 · 30 lines")).toBe(false);
  });
});
