import { KEYS, keyFallbackText, sendInput, sendInputWithFallback, sendInputWorks, sendKey, sendLine } from "./keys";

const err = (code: string) => Object.assign(new Error(code), { code });

/** A fake client that records herdr calls; `fail(method)` can throw for one herdr method. */
const fakeRpc = (fail?: (method: string) => Error | undefined) => {
  const calls: { method: string; params: any }[] = [];
  return {
    calls,
    rpc: {
      call: async (_m: string, p: any) => {
        calls.push(p);
        const e = fail?.(p.method);
        if (e) throw e;
        return {} as never;
      },
    },
  };
};

test("key_row_has_herdr_names", () => {
  expect(KEYS.map((k) => k.key)).toEqual(["esc", "tab", "ctrl+c", "up", "down", "left", "right", "enter"]);
});

test("a_key_is_one_send_input", async () => {
  const { calls, rpc } = fakeRpc();
  await sendKey(rpc, "w1:p1", "ctrl+c");
  expect(calls).toEqual([{ method: "pane.send_input", params: { pane_id: "w1:p1", keys: ["ctrl+c"] } }]);
  expect(sendInputWorks(rpc)).toBe(true);
});

test("a_line_is_one_send_input_text_then_enter", async () => {
  const { calls, rpc } = fakeRpc();
  await sendLine(rpc, "w1:p1", "ls -la");
  expect(calls).toEqual([{ method: "pane.send_input", params: { pane_id: "w1:p1", text: "ls -la", keys: ["enter"] } }]);
});

test("older_herdr_uses_two_calls_and_the_connection_remembers", async () => {
  const { calls, rpc } = fakeRpc((m) => (m === "pane.send_input" ? err("invalid_request") : undefined));
  await sendLine(rpc, "w1:p1", "ls");
  await sendLine(rpc, "w1:p1", "pwd");
  expect(calls.map((c) => c.method)).toEqual(["pane.send_input", "pane.send_text", "pane.send_keys", "pane.send_text", "pane.send_keys"]);
  expect(calls[2].params).toEqual({ pane_id: "w1:p1", keys: ["enter"] });
  expect(sendInputWorks(rpc)).toBe(false);
});

test("fallback_presses_no_enter_when_the_text_fails", async () => {
  const { calls, rpc } = fakeRpc((m) => (m === "pane.send_input" ? err("unknown_method") : m === "pane.send_text" ? err("pane_not_found") : undefined));
  await expect(sendLine(rpc, "w1:p1", "x")).rejects.toThrow("pane_not_found");
  expect(calls.map((c) => c.method)).toEqual(["pane.send_input", "pane.send_text"]);
});

test("other_errors_do_not_fall_back", async () => {
  const { calls, rpc } = fakeRpc((m) => (m === "pane.send_input" ? err("invalid_key") : undefined));
  await expect(sendInput(rpc, "w1:p1", { keys: ["nokey"] })).rejects.toThrow("invalid_key");
  expect(calls).toHaveLength(1);
});

test("after_one_success_invalid_request_is_a_real_error", async () => {
  let n = 0;
  const { calls, rpc } = fakeRpc((m) => (m === "pane.send_input" && n++ > 0 ? err("invalid_request") : undefined));
  await sendKey(rpc, "w1:p1", "esc");
  await expect(sendKey(rpc, "w1:p1", "esc")).rejects.toThrow("invalid_request");
  expect(calls.map((c) => c.method)).toEqual(["pane.send_input", "pane.send_input"]);
});

describe("sendInputWithFallback", () => {
  test("a_refused_key_name_on_herdr_one_sends_the_text_once", async () => {
    const calls: unknown[] = [];
    let n = 0;
    const rpc = {
      call: async (_m: string, p: any) => {
        calls.push(p);
        n += 1;
        if (n === 1) throw err("bad_request");
        return {} as never;
      },
    };
    await sendInputWithFallback(rpc, "w1:p1", { keys: ["shift+tab"] });
    expect(calls).toEqual([
      { method: "pane.send_input", params: { pane_id: "w1:p1", keys: ["shift+tab"] } },
      { method: "pane.send_input", params: { pane_id: "w1:p1", text: "\x1b[Z" } },
    ]);
  });

  test("no_fallback_on_a_network_error_a_core_pane_or_a_key_without_one", async () => {
    for (const [pane, keys, code] of [
      ["w1:p1", ["shift+tab"], "disconnected"],
      ["w1:p1", ["shift+tab"], "timeout"],
      ["hc:t3", ["shift+tab"], "bad_request"],
      ["w1:p1", ["ctrl+c"], "bad_request"],
    ] as const) {
      const calls: unknown[] = [];
      const rpc = {
        call: async (_m: string, p: any) => {
          calls.push(p);
          throw err(code);
        },
      };
      await expect(sendInputWithFallback(rpc, pane, { keys: [...keys] })).rejects.toMatchObject({ code });
      expect(calls.length).toBeLessThanOrEqual(2);
      expect(JSON.stringify(calls)).not.toContain("\\u001b[Z");
    }
    expect(keyFallbackText({ text: "a", keys: ["home"] })).toBeUndefined();
    expect(keyFallbackText({ keys: ["home", "end"] })).toBe("\x1b[H\x1b[F");
  });
});
