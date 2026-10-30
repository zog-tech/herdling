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
  setSpeechAudio(): Promise<void>;
  releaseAudio(): Promise<void>;
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

/**
 * Prepares the audio session for speech: playback that ducks other audio and can use Bluetooth.
 * Rejects with code "busy" while dictation runs.
 */
export function setSpeechAudio(): Promise<void> {
  return Voice.setSpeechAudio();
}

/** Ends the speech audio session so other audio gets its volume back. Does nothing while dictation runs. */
export function releaseAudio(): Promise<void> {
  return Voice.releaseAudio();
}

export function addListener<E extends keyof VoiceEvents>(event: E, listener: VoiceEvents[E]): { remove(): void } {
  return Voice.addListener(event, listener);
}
