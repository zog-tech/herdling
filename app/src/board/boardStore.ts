import type { AgentPreview, AgentStatus } from "@herdling/protocol";
import { create } from "zustand";

import type { Bucket, GroupBy, PreviewEntry } from "./buckets";
import { trackFirstSeen } from "./buckets";

type State = {
  /** Latest preview per pane key (`hostId:paneId`). */
  previews: Record<string, PreviewEntry>;
  /** The app's own status start time per pane key, for when the companion does not know it. */
  firstSeen: Record<string, { status: AgentStatus; at: number }>;
  /** Chip filter. Kept while the app runs, not across launches. */
  filter: Bucket | null;
  groupBy: GroupBy;
};

/** Board state that lives in memory only. */
export const useBoard = create<State>(() => ({ previews: {}, firstSeen: {}, filter: null, groupBy: "status" }));

/**
 * Replaces the previews of `hostId`. `statusOf` gives each pane's herdr status now, so a
 * preview is shown only while the agent keeps that status.
 */
export function setHostPreviews(hostId: string, list: AgentPreview[], statusOf: (paneId: string) => AgentStatus | undefined): void {
  useBoard.setState((s) => {
    const prefix = `${hostId}:`;
    const previews: Record<string, PreviewEntry> = {};
    for (const [k, v] of Object.entries(s.previews)) if (!k.startsWith(prefix)) previews[k] = v;
    for (const p of list) {
      const status = statusOf(p.pane_id);
      if (status) previews[prefix + p.pane_id] = { ...p, status };
    }
    return { previews };
  });
}

export function updateFirstSeen(current: { key: string; status: AgentStatus }[], now: number): void {
  useBoard.setState((s) => {
    const firstSeen = trackFirstSeen(s.firstSeen, current, now);
    return firstSeen === s.firstSeen ? s : { firstSeen };
  });
}

export const setFilter = (filter: Bucket | null) => useBoard.setState({ filter });
export const setGroupBy = (groupBy: GroupBy) => useBoard.setState({ groupBy });
