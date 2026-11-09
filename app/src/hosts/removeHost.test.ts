jest.mock("../../modules/ssh", () => ({
  ensureKey: async () => ({ publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA herdling" }),
}));
jest.mock("./connection", () => ({ getHostConn: () => ({ status: "offline", attempt: 0 }) }));
jest.mock("expo-secure-store", () => {
  const items = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => items.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void items.set(k, v),
    deleteItemAsync: async (k: string) => void items.delete(k),
  };
});

import { Alert } from "react-native";

import { getDeviceId } from "../device";
import { confirmRemoveHost, removeHostEverywhere, removeMessage, unpairCommand } from "./removeHost";
import { useHosts } from "./store";

function seed(): string {
  useHosts.setState({ hosts: [] });
  return useHosts.getState().addHost({ name: "studio", address: "10.0.0.5", port: 22, user: "sam" }).id;
}

describe("removeHostEverywhere", () => {
  it("remove_revokes_then_deletes", async () => {
    const id = seed();
    const order: string[] = [];
    const call = jest.fn(async (_m: string, _p?: object) => {
      order.push(`call:${useHosts.getState().hosts.length}`);
      return { removed: true };
    });
    const res = await removeHostEverywhere(id, { rpc: { call: call as never } });
    expect(res).toEqual({ revoked: true });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe("pair.revoke");
    expect(call.mock.calls[0][1]).toEqual({
      device_id: await getDeviceId(),
      public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA herdling",
    });
    expect(order).toEqual(["call:1"]);
    expect(useHosts.getState().hosts).toHaveLength(0);
  });

  it("remove_revoke_error_still_deletes", async () => {
    const id = seed();
    const call = jest.fn(async () => {
      throw new Error("timeout");
    });
    const res = await removeHostEverywhere(id, { rpc: { call: call as never } });
    expect(res).toEqual({ revoked: false });
    expect(useHosts.getState().hosts).toHaveLength(0);
  });

  it("remove_offline_still_deletes", async () => {
    const id = seed();
    const res = await removeHostEverywhere(id);
    expect(res).toEqual({ revoked: false });
    expect(useHosts.getState().hosts).toHaveLength(0);
  });
});

describe("the remove text", () => {
  it("online_says_the_host_forgets_the_key", () => {
    expect(removeMessage(true, "d_abc")).not.toContain("herdlingd unpair");
  });

  it("offline_gives_the_unpair_command_with_the_device_id", () => {
    expect(unpairCommand("d_abc")).toBe("herdlingd unpair d_abc");
    const text = removeMessage(false, "d_abc");
    expect(text).toContain("keeps this phone's key and push token");
    expect(text).toContain("herdlingd unpair d_abc");
  });

  it("an_offline_remove_shows_the_command_with_this_device_id", async () => {
    const id = seed();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await confirmRemoveHost(useHosts.getState().hosts[0]);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe("Remove studio?");
    expect(message).toContain(`herdlingd unpair ${await getDeviceId()}`);
    // Remove, then the second alert with the command.
    await buttons?.find((b) => b.text === "Remove")?.onPress?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(useHosts.getState().hosts.find((h) => h.id === id)).toBeUndefined();
    expect(alert.mock.calls[1][0]).toBe("Run this on the host");
    expect(alert.mock.calls[1][1]).toContain(`herdlingd unpair ${await getDeviceId()}`);
    alert.mockRestore();
  });
});
