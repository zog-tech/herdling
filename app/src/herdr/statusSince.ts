import type { AgentStatus } from "@zogssh/protocol";
import { useMemo } from "react";

import { useBoard } from "@/board/boardStore";

/**
 * Epoch ms when the pane's current status began. Order: the companion's `status_since` (from the
 * Board previews), then the time the Board first saw the status, then the time this hook saw it.
 */
export function useStatusSince(hostId: string, paneId: string, status: AgentStatus | undefined): number | undefined {
  const key = `${hostId}:${paneId}`;
  const preview = useBoard((s) => s.previews[key]);
  const first = useBoard((s) => s.firstSeen[key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new status starts a new local clock.
  const local = useMemo(() => Date.now(), [status, key]);
  if (status === undefined) return undefined;
  if (preview && preview.status === status && preview.status_since != null) return preview.status_since * 1000;
  if (first && first.status === status) return first.at;
  return local;
}
