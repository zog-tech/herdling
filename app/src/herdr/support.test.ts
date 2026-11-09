import { RpcError } from "@/rpc/RpcClient";

import { callHerdr, herdrSupports, isMissingMethod, UNSUPPORTED, useHerdrSupport } from "./support";

beforeEach(() => useHerdrSupport.setState({ missing: {} }));

describe("isMissingMethod", () => {
  it("knows the answers of an older herdr and of a proxy", () => {
    expect(isMissingMethod(new RpcError("invalid_request", "unknown variant `agent.explain`, expected one of ..."))).toBe(true);
    expect(isMissingMethod(new RpcError("unknown_method", "unknown method: x"))).toBe(true);
    expect(isMissingMethod(new Error("unknown method: integration.list"))).toBe(true);
  });

  it("does not take other errors for a missing method", () => {
    expect(isMissingMethod(new RpcError("invalid_request", "missing field `target`"))).toBe(false);
    expect(isMissingMethod(new RpcError("agent_not_found", "agent w1:p1 not found"))).toBe(false);
    expect(isMissingMethod(new RpcError("timeout", "timed out"))).toBe(false);
  });
});

describe("callHerdr", () => {
  it("sends the method through herdr.call", async () => {
    const rpc = { call: jest.fn(async () => ({ type: "ok" }) as never) };
    expect(await callHerdr(rpc, "h1", "agent.explain", { target: "w1:p1" }, 5000)).toEqual({ type: "ok" });
    expect(rpc.call).toHaveBeenCalledWith("herdr.call", { method: "agent.explain", params: { target: "w1:p1" } }, 5000);
    expect(herdrSupports("h1", "agent.explain")).toBe(true);
  });

  it("remembers a missing method per host and throws UNSUPPORTED", async () => {
    const rpc = {
      call: jest.fn(async () => {
        throw new RpcError("invalid_request", "unknown variant `agent.explain`");
      }),
    };
    await expect(callHerdr(rpc, "h1", "agent.explain", {})).rejects.toMatchObject({ code: UNSUPPORTED });
    expect(herdrSupports("h1", "agent.explain")).toBe(false);
    // Other hosts and other methods stay supported.
    expect(herdrSupports("h2", "agent.explain")).toBe(true);
    expect(herdrSupports("h1", "integration.list")).toBe(true);
  });

  it("passes other errors through and remembers nothing", async () => {
    const rpc = {
      call: jest.fn(async () => {
        throw new RpcError("agent_not_found", "gone");
      }),
    };
    await expect(callHerdr(rpc, "h1", "agent.explain", {})).rejects.toMatchObject({ code: "agent_not_found" });
    expect(herdrSupports("h1", "agent.explain")).toBe(true);
  });
});
