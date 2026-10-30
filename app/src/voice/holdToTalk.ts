/**
 * Hold-to-talk as a pure state machine. Press starts dictation, release sends the
 * trimmed final text, a slide of more than CANCEL_DISTANCE from the press point
 * arms cancel. It never sends after a cancel, an error or an empty transcript.
 */

export type HoldState = { phase: "idle" | "recording" | "armedCancel" | "finishing"; partial: string };

export type HoldEvent =
  | { type: "press" }
  /** dx, dy: translation from the press point, in pt. */
  | { type: "move"; dx: number; dy: number }
  | { type: "release" }
  /** The gesture ended without a release (the system took the touch, the button went away). */
  | { type: "cancel" }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error" };

export type HoldEffect = "start" | "stop" | "cancel" | { send: string } | "hapticStart" | "hapticCancel" | "hapticSend";

/** pt from the press point. */
export const CANCEL_DISTANCE = 80;

export const IDLE: HoldState = { phase: "idle", partial: "" };

type Result = { state: HoldState; effects: HoldEffect[] };

const same = (s: HoldState): Result => ({ state: s, effects: [] });

export function holdReducer(s: HoldState, e: HoldEvent): Result {
  const live = s.phase === "recording" || s.phase === "armedCancel";
  switch (e.type) {
    case "press":
      return s.phase === "idle" ? { state: { phase: "recording", partial: "" }, effects: ["start", "hapticStart"] } : same(s);
    case "move": {
      if (!live) return same(s);
      const phase = Math.hypot(e.dx, e.dy) > CANCEL_DISTANCE ? "armedCancel" : "recording";
      return phase === s.phase ? same(s) : same({ ...s, phase });
    }
    case "release":
      if (s.phase === "recording") return { state: { ...s, phase: "finishing" }, effects: ["stop"] };
      if (s.phase === "armedCancel") return { state: IDLE, effects: ["cancel", "hapticCancel"] };
      return same(s);
    case "cancel":
      return live ? { state: IDLE, effects: ["cancel", "hapticCancel"] } : same(s);
    case "partial":
      return s.phase === "idle" ? same(s) : same({ ...s, partial: e.text });
    case "final": {
      if (s.phase !== "finishing") return same(s);
      const text = e.text.trim();
      return { state: IDLE, effects: text ? [{ send: text }, "hapticSend"] : [] };
    }
    case "error":
      return s.phase === "idle" ? same(s) : { state: IDLE, effects: ["cancel"] };
  }
}
