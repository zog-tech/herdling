jest.mock("../../modules/ssh", () => ({
  ensureKey: async () => ({ publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA zogssh" }),
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

import { getDeviceId } from "../device";
import { removeHostEverywhere } from "./removeHost";
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
      public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA zogssh",
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
