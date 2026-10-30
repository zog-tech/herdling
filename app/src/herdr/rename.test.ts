import { Alert } from "react-native";

import { RpcError } from "@/rpc/RpcClient";

import { promptRename, rename, renameItems, renameSupported, useRenameSupport } from "./rename";
import type { Snapshot } from "./snapshot";
import { useSnapshots } from "./snapshotStore";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/ui/haptics", () => ({ commit: jest.fn(), fail: jest.fn() }));

const H = "studio";
const target = { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1" };
const snapshot = (): Snapshot => ({
  agents: [{ ...target, agent: "claude", agent_status: "idle", state_change_seq: 1, name: "old" }],
  workspaces: [{ workspace_id: "w1", label: "api", number: 1, agent_status: "idle" }],
  tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "main", number: 1, agent_status: "idle" }],
  panes: [],
});
const snap = () => useSnapshots.getState().byHost[H];

function fakeRpc(fail?: Error) {
  const calls: { method: string; params: any }[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return {
    calls,
    release,
    call: jest.fn(async (_m: string, p: any) => {
      calls.push({ method: p.method, params: p.params });
      await gate;
      if (fail) throw fail;
      return {};
    }),
  } as any;
}

beforeEach(() => {
  useSnapshots.setState({ byHost: { [H]: snapshot() }, errors: {} });
  useRenameSupport.setState({ missing: {} });
});

test("each_rename_sends_the_herdr_params", async () => {
  const rpc = fakeRpc();
  rpc.release();
  await rename(rpc, H, "workspace", target, " web ");
  await rename(rpc, H, "tab", target, "review");
  await rename(rpc, H, "session", target, "reviewer");
  await rename(rpc, H, "session", target, "");
  expect(rpc.calls).toEqual([
    { method: "workspace.rename", params: { workspace_id: "w1", label: "web" } },
    { method: "tab.rename", params: { tab_id: "w1:t1", label: "review" } },
    { method: "agent.rename", params: { target: "w1:p1", name: "reviewer" } },
    { method: "agent.rename", params: { target: "w1:p1", name: null } },
  ]);
});

test("empty_tab_or_workspace_name_and_same_name_send_nothing", async () => {
  const rpc = fakeRpc();
  rpc.release();
  await expect(rename(rpc, H, "tab", target, "  ")).resolves.toBe(false);
  await expect(rename(rpc, H, "workspace", target, "api")).resolves.toBe(false);
  expect(rpc.calls).toEqual([]);
});

test("the_store_changes_at_once_and_stays_on_success", async () => {
  const rpc = fakeRpc();
  const p = rename(rpc, H, "workspace", target, "web");
  expect(snap().workspaces[0].label).toBe("web");
  rpc.release();
  await p;
  expect(snap().workspaces[0].label).toBe("web");
});

test("a_refused_rename_rolls_back", async () => {
  const rpc = fakeRpc(new RpcError("bad", "no"));
  const p = rename(rpc, H, "tab", target, "review");
  expect(snap().tabs[0].label).toBe("review");
  rpc.release();
  await expect(p).rejects.toThrow("no");
  expect(snap().tabs[0].label).toBe("main");
});

test("a_bad_agent_name_never_reaches_herdr_and_rolls_back", async () => {
  const rpc = fakeRpc();
  rpc.release();
  await expect(rename(rpc, H, "session", target, "Bad Name")).rejects.toThrow(/lowercase/);
  expect(rpc.calls).toEqual([]);
  expect(snap().agents[0].name).toBe("old");
});

test("an_unknown_method_hides_that_rename_for_the_host", async () => {
  const rpc = fakeRpc(new RpcError("invalid_request", "invalid request: unknown method tab.rename"));
  rpc.release();
  expect(renameItems(rpc, H, target).map((i) => i.label)).toEqual(["Rename session", "Rename tab", "Rename workspace"]);
  await expect(rename(rpc, H, "tab", target, "review")).rejects.toThrow("can't rename");
  expect(renameSupported(H, "tab")).toBe(false);
  expect(renameSupported("buildbox", "tab")).toBe(true);
  expect(renameItems(rpc, H, target).map((i) => i.label)).toEqual(["Rename session", "Rename workspace"]);
});

test("the_prompt_starts_with_the_current_name", () => {
  const spy = jest.spyOn(Alert, "prompt").mockImplementation(() => {});
  promptRename(fakeRpc(), H, "workspace", target);
  expect(spy.mock.calls[0][0]).toBe("Rename workspace");
  expect(spy.mock.calls[0][4]).toBe("api");
  spy.mockRestore();
});
