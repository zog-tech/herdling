import { canWatchShell, isShellWatched, unwatchShell, watchShell } from "./shellWatch";

const mockDevice = { id: "d_test" as string | undefined };
jest.mock("@/device", () => ({
  getDeviceId: async () => {
    if (!mockDevice.id) throw new Error("no keychain");
    return mockDevice.id;
  },
}));

function fakeRpc(answers: Record<string, unknown> = {}) {
  const calls: { method: string; params?: unknown }[] = [];
  return {
    calls,
    call: async <T,>(method: string, params?: unknown): Promise<T> => {
      calls.push({ method, params });
      return (answers[method] ?? {}) as T;
    },
  };
}

beforeEach(() => {
  mockDevice.id = "d_test";
});

test("only_a_host_that_lists_shell_watch_can_watch", () => {
  expect(canWatchShell(undefined)).toBe(false);
  expect(canWatchShell({ methods: undefined } as never)).toBe(false);
  expect(canWatchShell({ methods: ["hello", "pane.watch"] } as never)).toBe(false);
  expect(canWatchShell({ methods: ["shell.watch"] } as never)).toBe(true);
});

test("watch_sends_the_pane_and_this_device", async () => {
  const rpc = fakeRpc();
  await watchShell(rpc, "w1:p2");
  expect(rpc.calls).toEqual([{ method: "shell.watch", params: { pane_id: "w1:p2", device_id: "d_test" } }]);
});

test("watch_without_a_device_id_still_asks", async () => {
  mockDevice.id = undefined;
  const rpc = fakeRpc();
  await watchShell(rpc, "w1:p2");
  expect(rpc.calls).toEqual([{ method: "shell.watch", params: { pane_id: "w1:p2" } }]);
});

test("unwatch_and_list", async () => {
  const rpc = fakeRpc({
    "shell.unwatch": { removed: true },
    "shell.watches": { watches: [{ pane_id: "w1:p2", since: 1, expires_at: 2, busy: true }] },
  });
  expect(await unwatchShell(rpc, "w1:p2")).toBe(true);
  expect(await isShellWatched(rpc, "w1:p2")).toBe(true);
  expect(await isShellWatched(rpc, "w1:p3")).toBe(false);
  expect(rpc.calls[0]).toEqual({ method: "shell.unwatch", params: { pane_id: "w1:p2" } });
});
