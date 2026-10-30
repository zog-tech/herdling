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

beforeEach(() => useNotifPrefs.setState({ finished: true, needs_you: true }));

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
      prefs: { finished: true, needs_you: true },
    });
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
    expect(rpc.call.mock.calls[0][1]).toMatchObject({ prefs: { finished: false, needs_you: true } });
  });

  it("register_token_error_sends_null_token", async () => {
    const rpc = fakeRpc();
    await registerPush(rpc, "h_1", {
      token: async () => {
        throw new Error("no aps-environment");
      },
    });
    expect(rpc.call.mock.calls[0][1]).toMatchObject({ expo_token: null });
  });

  it("register_rpc_error_is_logged_not_thrown", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = { call: jest.fn(async () => Promise.reject(new Error("unknown_method"))) };
    await expect(registerPush(rpc, "h_1", { token: async () => null })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
