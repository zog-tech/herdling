/**
 * "Send now" on a queued prompt of a Claude Code pane, as a pure state machine.
 *
 * Claude Code keeps a prompt that arrives during a turn in its queue. One Esc stops the turn, and
 * Claude Code then submits all queued prompts itself (tested with Claude Code 2.1). So "Send now"
 * is one Esc for the pane, not for one bubble. No Enter follows.
 *
 * A second Esc soon after the first one opens the rewind menu of Claude Code. Thus the flow holds
 * the lock in `sent` for SENT_HOLD_MS after the key, and a tap in `sending` or `sent` does nothing.
 * Each attempt has a generation number: a key result or a timer of an old attempt does nothing.
 */

export type SendNowState =
  | { phase: "idle"; gen: number }
  /** The Esc is on its way to the computer. */
  | { phase: "sending"; gen: number }
  /** The computer pressed Esc. The queued prompts go to the agent; the lock stays on for a short time. */
  | { phase: "sent"; gen: number }
  /** The key did not reach the pane. A tap tries again. */
  | { phase: "failed"; gen: number; error: string };

export type SendNowEvent =
  /** A tap on "Send now". `working`: the agent status is "working" now. */
  | { type: "tap"; working: boolean }
  | { type: "keyOk"; gen: number }
  | { type: "keyFailed"; gen: number; error: string }
  /** The timer of the attempt `gen` ran out. */
  | { type: "timer"; gen: number };

export type SendNowEffect =
  | { type: "pressEsc"; gen: number }
  | { type: "startTimer"; gen: number; ms: number }
  | { type: "haptic"; kind: "commit" | "fail" };

/**
 * The lock time after the Esc. Longer than the double-Esc time of Claude Code, and long enough for
 * the log to show the prompt, so that the bubble goes away before a tap can stop the new turn.
 */
export const SENT_HOLD_MS = 5_000;
/** How long the error line shows before "Send now" comes back. */
export const FAILED_HOLD_MS = 6_000;

export const SEND_NOW_IDLE: SendNowState = { phase: "idle", gen: 0 };

type Result = { state: SendNowState; effects: SendNowEffect[] };

const same = (s: SendNowState): Result => ({ state: s, effects: [] });

export function sendNowReducer(s: SendNowState, e: SendNowEvent): Result {
  switch (e.type) {
    case "tap": {
      // The lock: one Esc for each attempt. An agent that does not work has no queue to send.
      if (s.phase === "sending" || s.phase === "sent" || !e.working) return same(s);
      const gen = s.gen + 1;
      return { state: { phase: "sending", gen }, effects: [{ type: "pressEsc", gen }] };
    }
    case "keyOk":
      if (s.phase !== "sending" || e.gen !== s.gen) return same(s);
      return {
        state: { phase: "sent", gen: s.gen },
        effects: [{ type: "startTimer", gen: s.gen, ms: SENT_HOLD_MS }, { type: "haptic", kind: "commit" }],
      };
    case "keyFailed":
      if (s.phase !== "sending" || e.gen !== s.gen) return same(s);
      return {
        state: { phase: "failed", gen: s.gen, error: e.error },
        effects: [{ type: "startTimer", gen: s.gen, ms: FAILED_HOLD_MS }, { type: "haptic", kind: "fail" }],
      };
    case "timer":
      if ((s.phase !== "sent" && s.phase !== "failed") || e.gen !== s.gen) return same(s);
      return same({ phase: "idle", gen: s.gen });
  }
}

/** The state line under a queued bubble while the flow runs. Undefined when idle. */
export function sendNowLabel(s: SendNowState): string | undefined {
  switch (s.phase) {
    case "idle":
      return undefined;
    case "sending":
    case "sent":
      return "Sending now…";
    case "failed":
      return `Can't send now: ${s.error}`;
  }
}

/** True when a pending bubble in `state` of an agent `kind` with `status` shows "Send now". */
export function showsSendNow(kind: string | null | undefined, status: string | undefined, state: string): boolean {
  return kind === "claude" && status === "working" && state === "queued";
}
