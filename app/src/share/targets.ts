/**
 * The agents that a share can go to: every agent on every online computer, from the list of
 * "Jump to a terminal" (`board/jump.ts`) without the plain terminals. Pure.
 */
import { filterJump, jumpTasks, type JumpHost, type JumpTask } from "@/board/jump";

/** The agents of `hosts` that match `query`, in the order of the jump list. */
export function shareTargets(hosts: readonly JumpHost[], query = ""): JumpTask[] {
  return filterJump(
    jumpTasks(hosts).filter((t) => t.status !== "terminal"),
    query,
  );
}

/** The agent to select at the start: the last one used when it is still there, else the only agent. */
export function initialTarget(targets: readonly JumpTask[], last?: { hostId: string; paneId: string }): JumpTask | undefined {
  if (last) {
    const hit = targets.find((t) => t.hostId === last.hostId && t.paneId === last.paneId);
    if (hit) return hit;
  }
  return targets.length === 1 ? targets[0] : undefined;
}
