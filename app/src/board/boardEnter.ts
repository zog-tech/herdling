import { motion } from "@/theme/tokens";

/** The first-load window: cards that mount this long after the first one do not animate. */
const WINDOW_MS = 600;

let firstAt: number | undefined;
let claimed = 0;

/**
 * The enter delay of a card that mounts now, or undefined when it should not animate. Only the
 * first cards of the first Board load per app launch get one (`motion.boardEnter`): a refresh, a
 * new agent later, or a return to the screen shows cards at once.
 */
export function claimEnterDelay(now = Date.now()): number | undefined {
  const { stepMs, maxCards } = motion.boardEnter;
  if (firstAt === undefined) firstAt = now;
  if (now - firstAt > WINDOW_MS || claimed >= maxCards) return undefined;
  return claimed++ * stepMs;
}

/** Tests only: start a new app launch. */
export function resetBoardEnter() {
  firstAt = undefined;
  claimed = 0;
}
