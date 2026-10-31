import type { ThreadItem } from "@herdling/protocol";

/** Start of the tool result Claude Code writes when it launches a background subagent. It is internal: never show it. */
export const LAUNCH_TEXT = "Async agent launched successfully";

/** The summary to show. An older host sends the launch text as the summary; that gives none. */
export function shownSummary(summary?: string): string | undefined {
  if (!summary || !summary.trim() || summary.trimStart().startsWith(LAUNCH_TEXT)) return undefined;
  return summary;
}

/**
 * Subagents that run now. Only the status "running" counts: an older host keeps a background
 * subagent "async_launched" for ever.
 */
export function runningSubagents(items: readonly ThreadItem[]): number {
  let n = 0;
  for (const i of items) if (i.kind === "subagent" && i.status === "running") n++;
  return n;
}

/** `1` -> "1 subagent", `2` -> "2 subagents". */
export const subagentCount = (n: number) => `${n} subagent${n === 1 ? "" : "s"}`;
