import { KEYS, sendKey, sendLine } from "./keys";

const fakeRpc = () => {
  const calls: { method: string; params: any }[] = [];
  return { calls, rpc: { call: async (method: string, params: unknown) => (calls.push({ method, params }), {}) as never } };
};

test("key_row_has_herdr_names", () => {
  expect(KEYS.map((k) => k.key)).toEqual(["esc", "tab", "ctrl+c", "up", "down", "left", "right", "enter"]);
});

test("keys_send_herdr_names", async () => {
  const { calls, rpc } = fakeRpc();
  await sendKey(rpc, "w1:p1", "ctrl+c");
  expect(calls).toEqual([{ method: "herdr.call", params: { method: "pane.send_keys", params: { pane_id: "w1:p1", keys: ["ctrl+c"] } } }]);
});

test("send_line_text_then_enter", async () => {
  const { calls, rpc } = fakeRpc();
  await sendLine(rpc, "w1:p1", "ls -la");
  expect(calls).toEqual([
    { method: "herdr.call", params: { method: "pane.send_text", params: { pane_id: "w1:p1", text: "ls -la" } } },
    { method: "herdr.call", params: { method: "pane.send_keys", params: { pane_id: "w1:p1", keys: ["enter"] } } },
  ]);
});

test("send_line_stops_when_text_fails", async () => {
  const calls: string[] = [];
  const rpc = {
    call: async (_m: string, p: any) => {
      calls.push(p.method);
      throw new Error("pane gone");
    },
  };
  await expect(sendLine(rpc as never, "w1:p1", "x")).rejects.toThrow("pane gone");
  expect(calls).toEqual(["pane.send_text"]);
});
