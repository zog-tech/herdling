import { createContext } from "react";

/**
 * What a tool card needs to show live output: the pane, the id of the newest running tool
 * (only that card polls), and whether the thread is on screen and focused.
 */
export type LiveTool = { hostId: string; paneId: string; newestRunningId?: string; active: boolean };

export const LiveToolContext = createContext<LiveTool | null>(null);

/**
 * The pane of a live thread, without the parts that change while the agent works. Rows read this,
 * not `LiveToolContext`: a context change re-renders every reader, even a memoized row.
 */
export type ThreadPane = { hostId: string; paneId: string };

export const ThreadPaneContext = createContext<ThreadPane | null>(null);

/** Id of the newest tool item that has no result yet. */
export function newestRunningTool(items: readonly { kind: string; id: string; result?: unknown }[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "tool" && !it.result) return it.id;
  }
  return undefined;
}
