import type { AgentStatus } from "@herdling/protocol";

import { backgroundText } from "./background";
import { useBoard } from "./boardStore";
import { previewSince } from "./buckets";
import { usePreviewPolling } from "./usePreviewPolling";

/**
 * What the session screen takes from the Board previews for one agent. `background`: the background
 * work ("1 shell running"). `since`: epoch ms when the current status began (the companion's
 * `status_since`), undefined when the companion does not know. A preview fetched under another status
 * does not count. While the screen is focused and the agent works or has background work, the previews
 * keep polling: the background text goes away when the work ends, and a new working turn gets its own start.
 */
export function useSessionPreview(
  hostId: string,
  paneId: string,
  status: AgentStatus | undefined,
  focused: boolean,
): { background?: string; since?: number } {
  const entry = useBoard((s) => s.previews[`${hostId}:${paneId}`]);
  const background = entry && entry.status === status ? backgroundText(entry.background) : undefined;
  const since = previewSince(entry, status);
  usePreviewPolling(hostId, focused && (!!background || status === "working"));
  return { background, since };
}
