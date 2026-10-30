import { RpcError } from "../rpc/RpcClient";
import { speakableReply, SUMMARY_INSTRUCTIONS } from "./summarize";
import { speechText } from "./speechText";

const md = "**Done.** Edited `main.rs`.\n\n```rust\nfn main() {}\n```\nShould I run the tests?";

function deps(o: { available?: boolean; local?: () => Promise<string>; rpc?: () => Promise<unknown> | null } = {}) {
  const available = jest.fn(async () => o.available ?? true);
  const summarize = jest.fn(o.local ?? (async () => "Local summary."));
  const call = jest.fn(o.rpc ?? (async () => ({ summary: "Host summary." })));
  return { available, summarize, call, d: { local: { available, summarize }, rpc: { call: call as any } } };
}

describe("speakableReply", () => {
  it("uses_local_first", async () => {
    const x = deps();
    await expect(speakableReply(md, "summary", x.d)).resolves.toEqual({ text: "Local summary.", source: "local" });
    expect(x.summarize).toHaveBeenCalledWith(speechText(md));
    expect(x.call).not.toHaveBeenCalled();
  });

  it("falls_back_to_host", async () => {
    const x = deps({ available: false });
    await expect(speakableReply(md, "summary", x.d)).resolves.toEqual({ text: "Host summary.", source: "host" });
    expect(x.summarize).not.toHaveBeenCalled();
    expect(x.call).toHaveBeenCalledWith("summary.make", { text: speechText(md) }, expect.any(Number));
  });

  it("falls back to the host when the local model throws", async () => {
    const x = deps({ local: async () => Promise.reject(new Error("guardrail")) });
    await expect(speakableReply(md, "summary", x.d)).resolves.toEqual({ text: "Host summary.", source: "host" });
  });

  it("falls_back_to_full_on_no_key", async () => {
    const x = deps({ available: false, rpc: async () => Promise.reject(new RpcError("no_key", "no key")) });
    await expect(speakableReply(md, "summary", x.d)).resolves.toEqual({ text: speechText(md), source: "full" });
  });

  it("falls back to full when there is no rpc, or the host answers with no text", async () => {
    const x = deps({ available: false });
    await expect(speakableReply(md, "summary", { local: x.d.local })).resolves.toEqual({ text: speechText(md), source: "full" });
    const y = deps({ available: false, rpc: async () => ({ summary: "  " }) });
    await expect(speakableReply(md, "summary", y.d)).resolves.toEqual({ text: speechText(md), source: "full" });
    const z = deps({ local: async () => " ", rpc: async () => Promise.reject(new RpcError("upstream_error", "HTTP 500")) });
    await expect(speakableReply(md, "summary", z.d)).resolves.toEqual({ text: speechText(md), source: "full" });
  });

  it("falls back when availability itself throws", async () => {
    const x = deps();
    x.available.mockRejectedValueOnce(new Error("no module"));
    await expect(speakableReply(md, "summary", x.d)).resolves.toEqual({ text: "Host summary.", source: "host" });
  });

  it("full_mode_skips_summary", async () => {
    const x = deps();
    await expect(speakableReply(md, "full", x.d)).resolves.toEqual({ text: speechText(md), source: "full" });
    expect(x.available).not.toHaveBeenCalled();
    expect(x.summarize).not.toHaveBeenCalled();
    expect(x.call).not.toHaveBeenCalled();
  });

  it("does not summarize an empty reply", async () => {
    const x = deps();
    await expect(speakableReply("   ", "summary", x.d)).resolves.toEqual({ text: "", source: "full" });
    expect(x.available).not.toHaveBeenCalled();
    expect(x.call).not.toHaveBeenCalled();
  });

  it("uses the same instructions as the companion", () => {
    expect(SUMMARY_INSTRUCTIONS).toBe(
      "You summarize a coding agent's reply for someone listening on headphones. " +
        "Say in 2 or 3 short sentences what the agent did and what it needs from the user. No markdown, no code, no lists.",
    );
  });
});
