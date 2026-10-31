jest.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
jest.mock("expo-device", () => ({ deviceName: "Sam-iPhone" }));
jest.mock("../device", () => ({ getDeviceId: async () => "d_x", deviceName: () => "Sam-iPhone" }));
jest.mock("./token", () => ({ getExpoToken: jest.fn(async () => null) }));

import { useNotifPrefs } from "./prefs";
import { registerPush } from "./register";

function fakeRpc() {
  return { call: jest.fn(async (_method: string, _params?: unknown) => ({ ok: true }) as never) };
}

beforeEach(() => useNotifPrefs.setState({ finished: true, needs_you: true, quiet_at_desk: true }));

describe("registerPush", () => {
  it("register_sends_device_and_prefs", async () => {
    const rpc = fakeRpc();
    await registerPush(rpc, "h_1", { token: async () => "ExponentPushToken[test]" });
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(rpc.call).toHaveBeenCalledWith("push.register", {
      device_id: "d_x",
      host_id: "h_1",
      name: "Sam-iPhone",
      expo_token: "ExponentPushToken[test]",
      prefs: { finished: true, needs_you: true, quiet_at_desk: true },
    });
  });

  it("register_sends_choice_actions_only_to_a_host_with_pane_answer", async () => {
    const hello = (methods?: string[]) => ({ host: "studio.local", os: "macos" as const, herdlingd: "0.1.2", herdr_ok: true, methods });
    const rpc = fakeRpc();
    await registerPush(rpc, "h_1", { token: async () => null, hello: hello(["push.register", "pane.answer"]) });
    expect(rpc.call.mock.calls[0][1]).toMatchObject({ capabilities: ["choice_actions"] });
    await registerPush(rpc, "h_1", { token: async () => null, hello: hello(["push.register"]) });
    await registerPush(rpc, "h_1", { token: async () => null, hello: hello(undefined) });
    await registerPush(rpc, "h_1", { token: async () => null });
    for (const [, p] of rpc.call.mock.calls.slice(1)) expect(p).not.toHaveProperty("capabilities");
  });

  it("register_with_denied_permission_sends_null_token", async () => {
    const rpc = fakeRpc();
    await registerPush(rpc, "h_1", { token: async () => null });
    expect(rpc.call.mock.calls[0][1]).toMatchObject({ expo_token: null });
  });

  it("register_sends_current_prefs", async () => {
    useNotifPrefs.getState().setPref("finished", false);
    const rpc = fakeRpc();
    await registerPush(rpc, "h_1", { token: async () => null });
    expect(rpc.call.mock.calls[0][1]).toMatchObject({ prefs: { finished: false, needs_you: true, quiet_at_desk: true } });
  });

  it("register_sends_quiet_at_desk", async () => {
    useNotifPrefs.getState().setPref("quiet_at_desk", false);
    const rpc = fakeRpc();
    await registerPush(rpc, "h_1", { token: async () => null });
    expect(rpc.call.mock.calls[0][1]).toMatchObject({ prefs: { finished: true, needs_you: true, quiet_at_desk: false } });
  });

  it("register_token_error_skips_register", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = fakeRpc();
    await registerPush(rpc, "h_1", {
      token: async () => {
        throw new Error("no aps-environment");
      },
    });
    expect(rpc.call).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("failure_after_good_token_does_not_send_null", async () => {
    const rpc = fakeRpc();
    let fail = false;
    const token = async () => {
      if (fail) throw new Error("network down");
      return "ExponentPushToken[test]";
    };
    await registerPush(rpc, "h_1", { token });
    fail = true;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await registerPush(rpc, "h_1", { token });
    warn.mockRestore();
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(rpc.call.mock.calls.every(([, p]) => (p as { expo_token: unknown }).expo_token !== null)).toBe(true);
  });

  it("register_rpc_error_is_logged_not_thrown", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = { call: jest.fn(async () => Promise.reject(new Error("unknown_method"))) };
    await expect(registerPush(rpc, "h_1", { token: async () => null })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
