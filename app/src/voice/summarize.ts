import type { Summary } from "@zogssh/protocol";

import type { RpcClient } from "../rpc/RpcClient";
import { speechText } from "./speechText";

/** Same text as `SYSTEM` in the companion's `summary.rs`. */
export const SUMMARY_INSTRUCTIONS =
  "You summarize a coding agent's reply for someone listening on headphones. " +
  "Say in 2 or 3 short sentences what the agent did and what it needs from the user. No markdown, no code, no lists.";

/** The companion waits up to 15 s for the Messages API; give it a little more. */
const HOST_TIMEOUT_MS = 20_000;

export type SummaryDeps = {
  local: { available(): Promise<boolean>; summarize(t: string): Promise<string> };
  rpc?: Pick<RpcClient, "call">;
};

const filled = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : undefined);

/**
 * The text to speak for a reply. Summary mode tries the on-device model, then the host's
 * `summary.make`, then the full text. A step that throws or gives no text falls to the next.
 */
export async function speakableReply(
  markdown: string,
  mode: "full" | "summary",
  deps: SummaryDeps,
): Promise<{ text: string; source: "local" | "host" | "full" }> {
  const text = speechText(markdown);
  if (mode === "full" || !text) return { text, source: "full" };
  try {
    if (await deps.local.available()) {
      const s = filled(await deps.local.summarize(text));
      if (s) return { text: s, source: "local" };
    }
  } catch {
    // Fall through to the host.
  }
  if (deps.rpc) {
    try {
      const r = await deps.rpc.call<Summary>("summary.make", { text }, HOST_TIMEOUT_MS);
      const s = filled(r?.summary);
      if (s) return { text: s, source: "host" };
    } catch {
      // Fall through to the full text.
    }
  }
  return { text, source: "full" };
}
