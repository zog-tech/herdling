import type { Hello } from "@herdling/protocol";

import { DEFAULT_KIND, FEATURED_KINDS, PICKER_KINDS } from "@/herdr/agentKinds";

import { agentFor, rememberAgent, useAgentMemory } from "./agentMemory";
import { availability, fetchInstalled, pickerOrder } from "./installed";

const hello = (methods?: string[]): Hello => ({ host: "studio.local", os: "macos", herdlingd: "0.1.1", herdr_ok: true, methods });

describe("agent memory", () => {
  beforeEach(() => useAgentMemory.setState({ byHost: {} }));

  it("remembers the last agent per host", () => {
    rememberAgent("h1", "codex");
    rememberAgent("h2", "pi");
    const { byHost } = useAgentMemory.getState();
    expect(agentFor(byHost, "h1")).toBe("codex");
    expect(agentFor(byHost, "h2")).toBe("pi");
    rememberAgent("h1", "gemini");
    expect(agentFor(useAgentMemory.getState().byHost, "h1")).toBe("gemini");
  });

  it("falls back to Claude Code for a new host, no host, or an unknown kind", () => {
    expect(agentFor({}, "h1")).toBe(DEFAULT_KIND);
    expect(agentFor({ h1: "codex" }, undefined)).toBe(DEFAULT_KIND);
    expect(agentFor({ h1: "not-an-agent" }, "h1")).toBe(DEFAULT_KIND);
  });
});

describe("installed agents", () => {
  it("does not call a herdlingd without agents.installed and shows every agent", async () => {
    const call = jest.fn();
    // herdlingd 0.1.0 lists its methods without the new one; an older one does not list them.
    expect(await fetchInstalled({ call }, hello(["hello", "fs.dirs"]))).toBeUndefined();
    expect(await fetchInstalled({ call }, hello(undefined))).toBeUndefined();
    expect(call).not.toHaveBeenCalled();
    expect(availability("codex", undefined)).toBe("unknown");
    expect(pickerOrder(undefined)).toEqual([...PICKER_KINDS]);
  });

  it("treats a failed or malformed answer as unknown", async () => {
    const h = hello(["agents.installed"]);
    expect(await fetchInstalled({ call: jest.fn().mockRejectedValue(new Error("x")) }, h)).toBeUndefined();
    expect(await fetchInstalled({ call: jest.fn().mockResolvedValue({ installed: "claude" }) }, h)).toBeUndefined();
  });

  it("marks missing agents and moves them to the end of the picker", async () => {
    const info = { installed: ["claude", "pi"], missing: ["codex", "cursor"] };
    const got = await fetchInstalled({ call: jest.fn().mockResolvedValue(info) }, hello(["agents.installed"]));
    expect(got).toEqual(info);
    expect(availability("claude", info)).toBe("installed");
    expect(availability("codex", info)).toBe("missing");
    // No known program name: shown normally.
    expect(availability("devin", info)).toBe("unknown");
    const order = pickerOrder(info);
    expect(order.slice(0, 2)).toEqual(["claude", "pi"]);
    expect(order.slice(-2)).toEqual(["codex", "cursor"]);
    expect(order).toHaveLength(PICKER_KINDS.length);
  });

  it("starts the picker with the agents that have a chat view", () => {
    expect(PICKER_KINDS.slice(0, FEATURED_KINDS.length)).toEqual([...FEATURED_KINDS]);
    expect(new Set(PICKER_KINDS).size).toBe(PICKER_KINDS.length);
  });
});
