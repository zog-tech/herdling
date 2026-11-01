import type { AgentStatus } from "@herdling/protocol";

import { backgroundText } from "./background";
import { useBoard } from "./boardStore";
import { usePreviewPolling } from "./usePreviewPolling";

/**
 * The background work of one agent for the session screen ("1 shell running"), from the Board
 * previews. A preview fetched under another status does not count. While the text shows and the
 * screen is focused, the previews keep polling, so the text goes away when the work ends.
 */
export function useSessionBackground(hostId: string, paneId: string, status: AgentStatus | undefined, focused: boolean): string | undefined {
  const entry = useBoard((s) => s.previews[`${hostId}:${paneId}`]);
  const text = entry && entry.status === status ? backgroundText(entry.background) : undefined;
  usePreviewPolling(hostId, focused && !!text);
  return text;
}
