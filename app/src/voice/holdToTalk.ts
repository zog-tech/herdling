/**
 * Hold-to-talk as a pure state machine. Press starts dictation, release sends the
 * trimmed final text, a slide of more than CANCEL_DISTANCE from the press point
 * arms cancel. It never sends after a cancel, an error or an empty transcript.
 *
 * Tap-to-toggle: a release less than TAP_MS after the press keeps recording ("latched");
 * the next tap stops and sends. `toggle` (the VoiceOver action) starts latched or stops.
 */

export type HoldState = {
  phase: "idle" | "recording" | "armedCancel" | "finishing";
  partial: string;
  /** Recording goes on after the finger lifts; the next tap sends. */
  latched?: boolean;
  /** Epoch ms of the press that started recording. */
  pressedAt?: number;
};

export type HoldEvent =
  /** `at`: epoch ms of the touch; without it a press never counts as a tap. */
  | { type: "press"; at?: number }
  /** dx, dy: translation from the press point, in pt. */
  | { type: "move"; dx: number; dy: number }
  | { type: "release"; at?: number }
  /** Start latched, or stop and send (VoiceOver activate). */
  | { type: "toggle" }
  /**
   * The gesture ended without a release (the system took the touch, the button went away).
   * `force`: also ends a latched recording (the button got disabled).
   */
  | { type: "cancel"; force?: boolean }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error" };

export type HoldEffect = "start" | "stop" | "cancel" | { send: string } | "hapticStart" | "hapticCancel" | "hapticSend";

/** pt from the press point. */
export const CANCEL_DISTANCE = 80;
/** A press shorter than this is a tap: recording stays on until the next tap. */
export const TAP_MS = 300;

export const IDLE: HoldState = { phase: "idle", partial: "" };

type Result = { state: HoldState; effects: HoldEffect[] };

const same = (s: HoldState): Result => ({ state: s, effects: [] });

export function holdReducer(s: HoldState, e: HoldEvent): Result {
  const live = s.phase === "recording" || s.phase === "armedCancel";
  switch (e.type) {
    case "press":
      if (s.phase === "idle") return { state: { phase: "recording", partial: "", pressedAt: e.at }, effects: ["start", "hapticStart"] };
      // Second tap of tap-to-toggle: stop and send.
      if (s.latched && s.phase === "recording") return { state: { ...s, phase: "finishing", latched: false }, effects: ["stop"] };
      return same(s);
    case "toggle":
      if (s.phase === "idle") return { state: { phase: "recording", partial: "", latched: true }, effects: ["start", "hapticStart"] };
      if (s.phase === "recording" || s.phase === "armedCancel") return { state: { ...s, phase: "finishing", latched: false }, effects: ["stop"] };
      return same(s);
    case "move": {
      if (!live || s.latched) return same(s);
      const phase = Math.hypot(e.dx, e.dy) > CANCEL_DISTANCE ? "armedCancel" : "recording";
      return phase === s.phase ? same(s) : same({ ...s, phase });
    }
    case "release":
      if (s.latched) return same(s);
      if (s.phase === "recording" && e.at !== undefined && s.pressedAt !== undefined && e.at - s.pressedAt < TAP_MS) {
        return same({ ...s, latched: true });
      }
      if (s.phase === "recording") return { state: { ...s, phase: "finishing" }, effects: ["stop"] };
      if (s.phase === "armedCancel") return { state: IDLE, effects: ["cancel", "hapticCancel"] };
      return same(s);
    case "cancel":
      // A latched recording outlives its touch; only a press, toggle or error ends it.
      if (s.latched && !e.force) return same(s);
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
