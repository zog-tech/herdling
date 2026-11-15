import { colors } from "@/theme/tokens";

import type { SpacePane } from "./spaces";

/**
 * The fill of a pane cell in a tab map: ember when it needs you, the lantern while it works, sage
 * when it finished, else a quiet step. The map is a hint next to the name and the attention count,
 * so color is never the only cue.
 */
export function paneCellColor(status: SpacePane["status"]): string {
  switch (status) {
    case "blocked":
      return colors.status.blocked;
    case "working":
      return colors.status.working;
    case "done":
      return colors.status.done;
    default:
      return colors.raisedHigh;
  }
}
