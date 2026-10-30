import { NativeModule, requireNativeModule } from "expo";

export type VoiceEvents = {
  /** The transcript so far, while dictation runs. */
  onPartial: (e: { text: string }) => void;
  /** Recognition failed while the microphone was on. Call `cancelDictation()` to clean up. */
  onDictationError: (e: { code: string; message: string }) => void;
  /** Microphone level from 0 to 1, about 20 times a second, while dictation or a recording runs. */
  onLevel: (e: { level: number }) => void;
  /**
   * The microphone stopped by itself: "limit" (10 minutes) or "interrupted" (a call, Siri).
   * What was recorded stays: call `stopRecording()` to get it.
   */
  onRecordingHalted: (e: { reason: "limit" | "interrupted" }) => void;
};

/** A finished recording: a WAV file (16 kHz mono PCM16) in the caches folder. */
export type Recorded = {
  uri: string;
  durationMs: number;
  /** The live text, when live recognition ran and did not fail. */
  text?: string;
};

declare class VoiceNativeModule extends NativeModule<VoiceEvents> {
  requestPermission(): Promise<"granted" | "denied">;
  startDictation(o?: { locale?: string }): Promise<void>;
  stopDictation(): Promise<string>;
  cancelDictation(): Promise<void>;
  setSpeechAudio(): Promise<void>;
  releaseAudio(): Promise<void>;
  localSummaryAvailable(): Promise<boolean>;
  // Added after build 5. Older binaries do not have these: check `recordingAvailable()` first.
  requestMicPermission?(): Promise<"granted" | "denied">;
  startRecording?(o: { live: boolean; locale?: string }): Promise<void>;
  stopRecording?(): Promise<Recorded>;
  cancelRecording?(): Promise<void>;
  summarizeLocal(text: string, instructions: string): Promise<string>;
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

/** Whether Apple Intelligence's on-device model can run now (iOS 26+, supported device, turned on, downloaded). */
export function localSummaryAvailable(): Promise<boolean> {
  return Voice.localSummaryAvailable();
}

/** Runs `text` through the on-device model with `instructions`. Rejects with code "unavailable" or "failed". */
export function summarizeLocal(text: string, instructions: string): Promise<string> {
  return Voice.summarizeLocal(text, instructions);
}

/**
 * True when this binary can record to a file. Build 5 and older cannot: they use live
 * dictation only, so an OTA update never calls a native function that is not there.
 */
export function recordingAvailable(): boolean {
  return typeof Voice.startRecording === "function" && typeof Voice.stopRecording === "function";
}


const missing = () => Promise.reject(Object.assign(new Error("This build has no voice recording"), { code: "unavailable" }));

/** Asks for microphone access only. Older builds ask for speech recognition too. */
export function requestMicPermission(): Promise<"granted" | "denied"> {
  return Voice.requestMicPermission ? Voice.requestMicPermission() : Voice.requestPermission();
}

/**
 * Starts a recording to a WAV file. `live`: also run live recognition (the Apple engine).
 * Rejects with code "busy", "denied" or "unavailable".
 */
export function startRecording(o: { live: boolean; locale?: string }): Promise<void> {
  return Voice.startRecording ? Voice.startRecording(o) : missing();
}

/** Stops the recording and resolves with its file. Rejects with "not_recording" when none runs. */
export function stopRecording(): Promise<Recorded> {
  return Voice.stopRecording ? Voice.stopRecording() : missing();
}

/** Stops the recording and deletes its file. */
export function cancelRecording(): Promise<void> {
  return Voice.cancelRecording ? Voice.cancelRecording() : Voice.cancelDictation();
}


export function addListener<E extends keyof VoiceEvents>(event: E, listener: VoiceEvents[E]): { remove(): void } {
  return Voice.addListener(event, listener);
}
