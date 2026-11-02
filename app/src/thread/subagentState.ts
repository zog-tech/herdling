import type { ThreadItem } from "@herdling/protocol";

import type { ThreadLog } from "./ThreadLogContext";

export type SubagentItem = Extract<ThreadItem, { kind: "subagent" }>;

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

/** Statuses of a subagent that did not stop yet, but that an older host never changes to "running". */
const UNSETTLED = /(launched|pending|started)/i;

/** The subagents of the status pill sheet. Both lists are newest first. */
export type SubagentList = { running: SubagentItem[]; finished: SubagentItem[] };

/**
 * The subagents for the status pill and its sheet, from the loaded thread items.
 * `running`: every subagent with the status "running", also one from an earlier turn that runs in
 * the background. `finished`: the subagents of the current turn (after the last user message)
 * that stopped. Newest first: by start time, else by the time of the item.
 */
export function subagentList(items: readonly ThreadItem[]): SubagentList {
  let turnStart = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "user") {
      turnStart = i + 1;
      break;
    }
  }
  const running: { item: SubagentItem; at: number; index: number }[] = [];
  const finished: { item: SubagentItem; at: number; index: number }[] = [];
  items.forEach((item, index) => {
    if (item.kind !== "subagent") return;
    const entry = { item, at: item.started_at ?? item.ts, index };
    if (item.status === "running") running.push(entry);
    else if (index >= turnStart && !UNSETTLED.test(item.status)) finished.push(entry);
  });
  const newest = (a: { at: number; index: number }, b: { at: number; index: number }) => b.at - a.at || b.index - a.index;
  return { running: running.sort(newest).map((e) => e.item), finished: finished.sort(newest).map((e) => e.item) };
}

/**
 * The route of the subagent thread screen. Undefined until the agent id and the log are known.
 * The subagent card and the subagent sheet both open the thread with it.
 */
export function subagentHref(
  log: ThreadLog | null,
  s: { agentId?: string; description: string; startedAt?: number },
) {
  if (!log || !s.agentId) return undefined;
  return {
    pathname: "/subagent/[hostId]/[agentId]",
    params: {
      hostId: log.hostId,
      agentId: s.agentId,
      log: log.logPath,
      title: s.description,
      ...(s.startedAt ? { since: String(s.startedAt) } : {}),
    },
  } as const;
}
