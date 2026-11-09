import { RpcError } from "@/rpc/RpcClient";

import {
  actionLabel,
  groupIntegrations,
  installConfirm,
  installIntegration,
  listIntegrations,
  needsIntegration,
  parseIntegrations,
  stateLabel,
  type IntegrationInfo,
} from "./integrations";
import { herdrSupports, UNSUPPORTED, useHerdrSupport } from "./support";

beforeEach(() => useHerdrSupport.setState({ missing: {} }));

const item = (over: Partial<IntegrationInfo>): IntegrationInfo => ({
  target: "claude",
  label: "Claude Code",
  command: "claude",
  available: true,
  state: "current",
  ...over,
});

/** The shape of herdr 0.9.5 `integration.list`. */
const LIST = {
  type: "integration_list",
  integrations: [
    { target: "claude", label: "Claude Code", command: "claude", available: true, state: "current" },
    { target: "codex", label: "Codex", command: "codex", available: true, state: "not_installed" },
    { target: "pi", label: "Pi", command: "pi", available: true, state: "outdated" },
    { target: "cursor", label: "Cursor", command: "cursor-agent", available: false, state: "not_installed" },
  ],
};

describe("parseIntegrations", () => {
  it("reads the herdr list", () => {
    expect(parseIntegrations(LIST)).toEqual(LIST.integrations);
  });

  it("drops items without a target and fills missing fields", () => {
    expect(parseIntegrations({ integrations: [{ label: "x" }, { target: "kimi", state: "weird" }] })).toEqual([
      { target: "kimi", label: "kimi", command: "kimi", available: true, state: "not_installed" },
    ]);
    expect(parseIntegrations(null)).toEqual([]);
    expect(parseIntegrations({ integrations: "no" })).toEqual([]);
  });
});

describe("groupIntegrations", () => {
  it("puts old versions first, then missing ones, and keeps absent agents apart", () => {
    const g = groupIntegrations(parseIntegrations(LIST));
    expect(g.missing.map((i) => i.target)).toEqual(["pi", "codex"]);
    expect(g.installed.map((i) => i.target)).toEqual(["claude"]);
    expect(g.absent.map((i) => i.target)).toEqual(["cursor"]);
  });

  it("lists an old version even when herdr does not find the agent", () => {
    const g = groupIntegrations([item({ target: "pi", state: "outdated", available: false })]);
    expect(g.missing).toHaveLength(1);
    expect(g.absent).toHaveLength(0);
  });
});

describe("labels", () => {
  it("names each state and the button", () => {
    expect(stateLabel(item({}))).toBe("Installed");
    expect(stateLabel(item({ state: "outdated" }))).toBe("Old version");
    expect(stateLabel(item({ state: "not_installed" }))).toBe("Not installed");
    expect(stateLabel(item({ state: "not_installed", available: false }))).toBe("Agent not found");
    expect(actionLabel(item({}))).toBeUndefined();
    expect(actionLabel(item({ state: "outdated" }))).toBe("Update");
    expect(actionLabel(item({ state: "not_installed" }))).toBe("Install");
  });

  it("says what an install changes on the computer", () => {
    const c = installConfirm(item({ state: "not_installed" }), "studio");
    expect(c.title).toBe("Install the Claude Code integration?");
    expect(c.message).toContain("adds a hook to the Claude Code configuration in your home folder on studio");
    expect(c.message).toContain("herdr integration uninstall claude");
    expect(c.action).toBe("Install");
    const u = installConfirm(item({ state: "outdated" }), "studio");
    expect(u.title).toBe("Update the Claude Code integration?");
    expect(u.action).toBe("Update");
  });

  it("finds the integration of an agent kind that is not current", () => {
    const list = parseIntegrations(LIST);
    expect(needsIntegration(list, "codex")?.target).toBe("codex");
    expect(needsIntegration(list, "claude")).toBeUndefined();
    expect(needsIntegration(list, "cursor-agent")?.target).toBe("cursor");
    expect(needsIntegration(list, null)).toBeUndefined();
  });
});

describe("rpc", () => {
  it("lists through herdr.call", async () => {
    const rpc = { call: jest.fn(async () => LIST as never) };
    expect(await listIntegrations(rpc, "h1")).toHaveLength(4);
    expect(rpc.call).toHaveBeenCalledWith("herdr.call", { method: "integration.list", params: {} }, undefined);
  });

  it("installs one target and returns herdr's lines", async () => {
    const rpc = {
      call: jest.fn(async () => ({ type: "integration_install", target: "codex", details: { messages: ["installed codex", 3] } }) as never),
    };
    expect(await installIntegration(rpc, "h1", "codex")).toEqual(["installed codex"]);
    expect(rpc.call).toHaveBeenCalledWith("herdr.call", { method: "integration.install", params: { target: "codex" } }, 30_000);
  });

  it("marks the host when herdr does not know the list", async () => {
    const rpc = {
      call: jest.fn(async () => {
        throw new RpcError("invalid_request", "unknown variant `integration.list`");
      }),
    };
    await expect(listIntegrations(rpc, "h1")).rejects.toMatchObject({ code: UNSUPPORTED });
    expect(herdrSupports("h1", "integration.list")).toBe(false);
  });
});
