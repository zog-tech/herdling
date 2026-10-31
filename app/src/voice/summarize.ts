import type { Summary } from "@herdling/protocol";

import type { RpcClient } from "../rpc/RpcClient";
import { speechText } from "./speechText";

/** Same text as `INSTRUCTIONS` in the companion's `summary.rs`. */
export const SUMMARY_INSTRUCTIONS =
  "You summarize a coding agent's reply for someone listening on headphones. " +
  "Say in 2 or 3 short sentences what the agent did and what it needs from the user. No markdown, no code, no lists.";

/** The companion gives the host summary command 20 s; wait a little longer. */
const HOST_TIMEOUT_MS = 25_000;
/** Bound for the on-device check plus summary. A slower model falls to the host. */
export const LOCAL_TIMEOUT_MS = 8_000;
/** The on-device model has a ~4096-token window; longer input keeps its end. */
export const LOCAL_MAX_CHARS = 6_000;

export type SummaryDeps = {
  local: { available(): Promise<boolean>; summarize(t: string): Promise<string> };
  rpc?: Pick<RpcClient, "call">;
};

const filled = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : undefined);

/** The last `max` characters of `text`, counted by code point so a surrogate pair is never split. */
export function clipEnd(text: string, max: number): string {
  if (text.length <= max) return text;
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(-max).join("");
}

/** Rejects when `p` takes longer than `ms`. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function localSummary(local: SummaryDeps["local"], text: string): Promise<string | undefined> {
  if (!(await local.available())) return undefined;
  return filled(await local.summarize(clipEnd(text, LOCAL_MAX_CHARS)));
}

/**
 * The text to speak for a reply. Summary mode tries the on-device model, then the host summary
 * command (`summary.make`), then the full text. Any host error (`no_command`, `command_failed`,
 * `timeout`, `upstream_error`, offline) falls to the full text. A step that throws, gives no text, or (on device) takes
 * longer than `LOCAL_TIMEOUT_MS` falls to the next. The on-device input is clipped to its end.
 */
export async function speakableReply(
  markdown: string,
  mode: "full" | "summary",
  deps: SummaryDeps,
): Promise<{ text: string; source: "local" | "host" | "full" }> {
  const text = speechText(markdown);
  if (mode === "full" || !text) return { text, source: "full" };
  try {
    const s = await within(localSummary(deps.local, text), LOCAL_TIMEOUT_MS);
    if (s) return { text: s, source: "local" };
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
