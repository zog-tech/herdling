/**
 * Voice input as a pure state machine. Press starts recording, release stops it and the
 * trimmed text goes to the prompt box (it is not sent), a slide of more than CANCEL_DISTANCE
 * from the press point arms cancel. No text comes after a cancel, an error or an empty transcript.
 *
 * Tap-to-toggle: a release less than TAP_MS after the press keeps recording ("latched");
 * the next tap (or ✓) stops. `toggle` (the VoiceOver action and ✓) starts latched or stops.
 * When transcription fails, the recording stays ("failed") until `retry` or `discard`.
 */

export type HoldState = {
  /** "finishing": the microphone is off and the text is on its way (transcribing). */
  phase: "idle" | "recording" | "armedCancel" | "finishing" | "failed";
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
  /** The microphone or recognition failed: nothing is kept. */
  | { type: "error" }
  /** The microphone stopped by itself (time limit, a call): transcribe what was recorded. */
  | { type: "halted" }
  /** Every engine failed to transcribe. The recording stays for a retry. */
  | { type: "failed" }
  | { type: "retry" }
  | { type: "discard" };

export type HoldEffect =
  | "start"
  | "stop"
  | "cancel"
  | "retry"
  | "discard"
  /** The text for the prompt box. */
  | { text: string }
  | "hapticStart"
  | "hapticCancel"
  | "hapticStop";

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
      // Second tap of tap-to-toggle: stop and transcribe.
      if (s.latched && s.phase === "recording") return { state: { ...s, phase: "finishing", latched: false }, effects: ["stop", "hapticStop"] };
      return same(s);
    case "toggle":
      if (s.phase === "idle") return { state: { phase: "recording", partial: "", latched: true }, effects: ["start", "hapticStart"] };
      if (live) return { state: { ...s, phase: "finishing", latched: false }, effects: ["stop", "hapticStop"] };
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
      if (s.phase === "recording") return { state: { ...s, phase: "finishing" }, effects: ["stop", "hapticStop"] };
      if (s.phase === "armedCancel") return { state: IDLE, effects: ["cancel", "hapticCancel"] };
      return same(s);
    case "cancel":
      // A latched recording outlives its touch; only a press, toggle or error ends it.
      if (s.latched && !e.force) return same(s);
      if (s.phase === "failed" && e.force) return { state: IDLE, effects: ["discard"] };
      return live ? { state: IDLE, effects: ["cancel", "hapticCancel"] } : same(s);
    case "partial":
      return live || s.phase === "finishing" ? same({ ...s, partial: e.text }) : same(s);
    case "final": {
      if (s.phase !== "finishing") return same(s);
      const text = e.text.trim();
      return { state: IDLE, effects: text ? [{ text }] : [] };
    }
    case "error":
      return live || s.phase === "finishing" ? { state: IDLE, effects: ["cancel"] } : same(s);
    case "halted":
      return live ? { state: { ...s, phase: "finishing", latched: false }, effects: ["stop"] } : same(s);
    case "failed":
      return s.phase === "finishing" ? same({ ...s, phase: "failed", partial: "" }) : same(s);
    case "retry":
      return s.phase === "failed" ? { state: { ...s, phase: "finishing" }, effects: ["retry"] } : same(s);
    case "discard":
      return s.phase === "failed" ? { state: IDLE, effects: ["discard"] } : same(s);
  }
}
