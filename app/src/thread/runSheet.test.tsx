import { TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import RunCommandScreen from "@/app/run-command";
import type { Snapshot } from "@/herdr/snapshot";
import { useSnapshots } from "@/herdr/snapshotStore";

import { useRunRequest } from "./runCommand";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/ui/draftGuard", () => ({ useDraftGuard: () => () => {} }));
type Call = { method: string; params: Record<string, unknown> };
const mockCalls: Call[] = [];
let mockStatus = "online";
/** The methods that the host lists in `hello`. Empty: an older herdlingd. */
let mockMethods: string[] = [];
/** A fake herdr: `w2:p1` runs vim, every other shell is idle. */
const mockRpc = {
  call: async (m: string, p: Call | Record<string, unknown>) => {
    if (m !== "herdr.call") {
      mockCalls.push({ method: m, params: p as Record<string, unknown> });
      return m === "shell.watch" ? { pane_id: (p as { pane_id: string }).pane_id, since: 1, expires_at: 2, busy: false } : {};
    }
    const c = p as Call;
    mockCalls.push(c);
    if (c.method === "workspace.create" || c.method === "tab.create") return { root_pane: { pane_id: "w9:p1" } };
    if (c.method === "pane.process_info") {
      return c.params.pane_id === "w2:p1"
        ? { process_info: { shell_pid: 41, foreground_process_group_id: 77, foreground_processes: [{ pid: 77, name: "vim" }] } }
        : { process_info: { shell_pid: 41, foreground_process_group_id: 41 } };
    }
    return {};
  },
};
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: mockStatus, rpc: mockStatus === "online" ? mockRpc : undefined, hello: { methods: mockMethods } }),
}));
jest.mock("@/device", () => ({ getDeviceId: async () => "d_test" }));

const SNAP: Snapshot = {
  agents: [{ pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", agent: "claude", agent_status: "idle", cwd: "/home/sam/proj", state_change_seq: 1 }],
  workspaces: [{ workspace_id: "w1", label: "proj", number: 1, agent_status: "idle" }],
  tabs: [],
  panes: [
    { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", agent: "claude", cwd: "/home/sam/proj" },
    { pane_id: "w2:p1", tab_id: "w2:t1", workspace_id: "w2", cwd: "/home/sam/other", label: "editor" },
    { pane_id: "w3:p1", tab_id: "w3:t1", workspace_id: "w3", cwd: "/srv/logs" },
  ],
};

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  mockCalls.length = 0;
  mockReplace.mockClear();
  mockStatus = "online";
  mockMethods = [];
  useSnapshots.setState({ byHost: { studio: SNAP } });
  useRunRequest.setState({ req: { hostId: "studio", paneId: "w1:p1", command: "ls\npwd" } });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

async function render() {
  await act(async () => {
    tree = create(<RunCommandScreen />);
  });
  return tree!;
}

const radios = (t: ReactTestRenderer) => t.root.findAll((n) => n.props.accessibilityRole === "radio" && typeof n.props.onPress === "function");
const runButton = (t: ReactTestRenderer) => t.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Run" && typeof n.props.onPress === "function");
const press = async (n: ReactTestInstance) => {
  await act(async () => n.props.onPress());
};

test("lists_a_new_shell_first_then_the_terminals_of_the_host", async () => {
  const t = await render();
  const rows = radios(t);
  expect(rows.map((r) => r.props.accessibilityLabel)).toEqual(["New shell in proj, ~/proj", "editor, ~/other, Busy: vim", "logs, /srv/logs"]);
  expect(rows.map((r) => r.props.accessibilityState.checked)).toEqual([true, false, false]);
  expect(t.root.findByType(TextInput).props.value).toBe("ls\npwd");
});

test("run_in_a_new_shell_opens_the_new_terminal", async () => {
  const t = await render();
  await press(runButton(t));
  expect(mockCalls.filter((c) => c.method !== "pane.process_info").map((c) => c.method)).toEqual(["workspace.get", "tab.create", "pane.send_input"]);
  expect(mockCalls.at(-1)!.params).toEqual({ pane_id: "w9:p1", text: "ls\npwd", keys: ["enter"] });
  expect(mockReplace).toHaveBeenCalledWith({ pathname: "/session/[hostId]/[paneId]", params: { hostId: "studio", paneId: "w9:p1", shell: "1" } });
});

test("run_in_an_existing_terminal_sends_the_edited_text", async () => {
  const t = await render();
  await act(async () => t.root.findByType(TextInput).props.onChangeText("make test\n\n"));
  await press(radios(t)[1]);
  expect(radios(t)[1].props.accessibilityState.checked).toBe(true);
  mockCalls.length = 0;
  await press(runButton(t));
  expect(mockCalls).toEqual([{ method: "pane.send_input", params: { pane_id: "w2:p1", text: "make test", keys: ["enter"] } }]);
  expect(mockReplace).toHaveBeenCalledWith({ pathname: "/session/[hostId]/[paneId]", params: { hostId: "studio", paneId: "w2:p1", shell: "1" } });
});

test("offline_or_empty_the_run_button_is_disabled", async () => {
  mockStatus = "offline";
  let t = await render();
  expect(runButton(t).props.disabled).toBe(true);
  act(() => t.unmount());
  mockStatus = "online";
  t = await render();
  await act(async () => t.root.findByType(TextInput).props.onChangeText("  \n"));
  expect(runButton(t).props.disabled).toBe(true);
  tree = t;
});

const notifySwitch = (t: ReactTestRenderer) =>
  t.root.findAll((n) => n.props.accessibilityLabel === "Notify me when it finishes" && typeof n.props.onValueChange === "function");

test("an_older_host_shows_no_notify_switch", async () => {
  const t = await render();
  expect(notifySwitch(t)).toHaveLength(0);
});

test("notify_asks_the_host_to_watch_the_new_terminal_after_the_run", async () => {
  mockMethods = ["shell.watch", "shell.unwatch", "shell.watches"];
  const t = await render();
  expect(notifySwitch(t)).toHaveLength(1);
  await act(async () => notifySwitch(t)[0].props.onValueChange(true));
  await press(runButton(t));
  const methods = mockCalls.filter((c) => c.method !== "pane.process_info").map((c) => c.method);
  expect(methods).toEqual(["workspace.get", "tab.create", "pane.send_input", "shell.watch"]);
  expect(mockCalls.at(-1)!.params).toEqual({ pane_id: "w9:p1", device_id: "d_test" });
  expect(mockReplace).toHaveBeenCalledWith({ pathname: "/session/[hostId]/[paneId]", params: { hostId: "studio", paneId: "w9:p1", shell: "1" } });
});

test("notify_off_sends_no_watch", async () => {
  mockMethods = ["shell.watch"];
  const t = await render();
  await press(runButton(t));
  expect(mockCalls.some((c) => c.method === "shell.watch")).toBe(false);
});
