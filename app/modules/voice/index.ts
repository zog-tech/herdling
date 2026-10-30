import { NativeModule, requireNativeModule } from "expo";

export type VoiceEvents = {
  /** The transcript so far, while dictation runs. */
  onPartial: (e: { text: string }) => void;
  /** Recognition failed while the microphone was on. Call `cancelDictation()` to clean up. */
  onDictationError: (e: { code: string; message: string }) => void;
};

declare class VoiceNativeModule extends NativeModule<VoiceEvents> {
  requestPermission(): Promise<"granted" | "denied">;
  startDictation(o?: { locale?: string }): Promise<void>;
  stopDictation(): Promise<string>;
  cancelDictation(): Promise<void>;
}

const Voice = requireNativeModule<VoiceNativeModule>("VoiceModule");

/** Asks for microphone and speech recognition access. "granted" only when both are on. */
export function requestPermission(): Promise<"granted" | "denied"> {
  return Voice.requestPermission();
}

/**
 * Turns the microphone on and starts recognition (on-device when the locale supports it).
 * Rejects with code "busy", "denied" or "unavailable".
 */
export function startDictation(o?: { locale?: string }): Promise<void> {
  return Voice.startDictation(o ?? {});
}

/** Turns the microphone off and resolves with the final text ("" when nothing was said or nothing runs). */
export function stopDictation(): Promise<string> {
  return Voice.stopDictation();
}

/** Turns the microphone off and drops the transcript. */
export function cancelDictation(): Promise<void> {
  return Voice.cancelDictation();
}

export function addListener<E extends keyof VoiceEvents>(event: E, listener: VoiceEvents[E]): { remove(): void } {
  return Voice.addListener(event, listener);
}
