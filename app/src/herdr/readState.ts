/**
 * The "read" rule of a session, and the marks that the app keeps on the computer. Pure.
 *
 * A finished agent counts as read when one of these covers its latest result:
 * - the local mark of this phone (the last `state_change_seq` the user saw here),
 * - `seen_turn`: the `herdling.seen` label that `agent.mark_seen` writes (any phone),
 * - `herdr_seen_turn`: the `herdr.seen` label of the Herdr desktop app.
 *
 * An agent at turn 0 never finished work (the core turn goes up each time the status leaves
 * `working`), so it has nothing to read.
 *
 * The labels stay on the computer, so a reinstalled app or a second phone shows the same state.
 */
import type { AgentInfo } from "./snapshot";

/** The same key as `paneKey` of `snapshot.ts` (no import: `snapshot.ts` imports this module). */
const keyOf = (hostId: string, paneId: string) => `${hostId}:${paneId}`;

/** The herdlingd method that writes the `herdling.seen` label. */
export const MARK_SEEN_METHOD = "agent.mark_seen";

export type ReadFields = Pick<AgentInfo, "state_change_seq" | "turn" | "seen_turn" | "herdr_seen_turn">;

const num = (n: unknown): number | undefined => (typeof n === "number" && Number.isFinite(n) ? n : undefined);

/** The highest turn that the computer says the user saw, in Herdling or on the desktop. */
export function hostSeenTurn(agent: Pick<AgentInfo, "seen_turn" | "herdr_seen_turn">): number | undefined {
  const a = num(agent.seen_turn);
  const b = num(agent.herdr_seen_turn);
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/** True when the computer marks the current turn of the agent as seen, or the agent is at turn 0. */
export function hostCovers(agent: Pick<AgentInfo, "turn" | "seen_turn" | "herdr_seen_turn">): boolean {
  const turn = num(agent.turn);
  if (turn === undefined) return false;
  if (turn <= 0) return true;
  const seen = hostSeenTurn(agent);
  return seen !== undefined && seen >= turn;
}

/** True when the local mark `localSeq` covers the current status of the agent. */
export function localCovers(agent: Pick<AgentInfo, "state_change_seq">, localSeq: number | undefined): boolean {
  return (agent.state_change_seq ?? 0) <= (localSeq ?? 0);
}

/** True when the user saw the latest result of the agent: the local mark or a host mark covers it. */
export function isRead(agent: ReadFields, localSeq: number | undefined): boolean {
  return localCovers(agent, localSeq) || hostCovers(agent);
}

export type SeenMark = { paneId: string; turn: number };

/**
 * The marks to send to the computer: finished agents that this phone saw (the local mark covers
 * the current status) but whose turn the computer does not mark yet. `sent` holds the turns that
 * are on the way or done this run (by pane key), so a mark goes once.
 */
export function pendingMarks(
  hostId: string,
  agents: readonly (ReadFields & Pick<AgentInfo, "pane_id" | "agent_status">)[],
  localSeen: Readonly<Record<string, number>>,
  sent: ReadonlyMap<string, number>,
): SeenMark[] {
  const out: SeenMark[] = [];
  for (const a of agents) {
    if (a.agent_status !== "idle" && a.agent_status !== "done") continue;
    const turn = num(a.turn);
    if (turn === undefined || hostCovers(a)) continue;
    const key = keyOf(hostId, a.pane_id);
    if (!localCovers(a, localSeen[key])) continue;
    if ((sent.get(key) ?? -1) >= turn) continue;
    out.push({ paneId: a.pane_id, turn });
  }
  return out;
}
