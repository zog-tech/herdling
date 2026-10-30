import { RpcError } from "../rpc/RpcClient";
import { clipEnd, LOCAL_MAX_CHARS, LOCAL_TIMEOUT_MS, speakableReply, SUMMARY_INSTRUCTIONS } from "./summarize";
import { speechText } from "./speechText";

const md = "**Done.** Edited `main.rs`.\n\n```rust\nfn main() {}\n```\nShould I run the tests?";

function deps(o: { available?: boolean; local?: (t: string) => Promise<string>; rpc?: () => Promise<unknown> | null } = {}) {
  const available = jest.fn(async () => o.available ?? true);
  const summarize = jest.fn(o.local ?? (async (_t: string) => "Local summary."));
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

  it.each(["no_command", "command_failed", "timeout", "upstream_error"])("falls back to full on host error %s", async (code) => {
    const x = deps({ available: false, rpc: async () => Promise.reject(new RpcError(code, "host summary command")) });
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

  it("falls back to the host when the local model never answers", async () => {
    jest.useFakeTimers();
    try {
      const x = deps({ local: () => new Promise<string>(() => {}) });
      const p = speakableReply(md, "summary", x.d);
      await jest.advanceTimersByTimeAsync(LOCAL_TIMEOUT_MS - 1);
      expect(x.call).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await expect(p).resolves.toEqual({ text: "Host summary.", source: "host" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("bounds a never-answering availability check too", async () => {
    jest.useFakeTimers();
    try {
      const x = deps();
      x.available.mockImplementationOnce(() => new Promise<boolean>(() => {}));
      const p = speakableReply(md, "summary", x.d);
      await jest.advanceTimersByTimeAsync(LOCAL_TIMEOUT_MS);
      await expect(p).resolves.toEqual({ text: "Host summary.", source: "host" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("clips the local input to its end, but sends the host the whole text", async () => {
    const long = `${"a".repeat(9_997)}END`;
    const x = deps();
    await speakableReply(long, "summary", x.d);
    const sent = x.summarize.mock.calls[0][0] as string;
    expect(sent.length).toBe(LOCAL_MAX_CHARS);
    expect(sent.endsWith("END")).toBe(true);
    const y = deps({ available: false });
    await speakableReply(long, "summary", y.d);
    expect(y.call).toHaveBeenCalledWith("summary.make", { text: long }, expect.any(Number));
  });

  it("clipEnd never splits a surrogate pair", () => {
    expect(clipEnd("short", 10)).toBe("short");
    const clipped = clipEnd("\u{1F600}".repeat(5), 3);
    expect(Array.from(clipped)).toHaveLength(3);
    expect(clipped).toBe("\u{1F600}".repeat(3));
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
