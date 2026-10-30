import { create } from "zustand";

/** The log keeps this many events. */
export const SPEECH_LOG_MAX = 20;

export type SpeechEvent = { at: number; text: string };

type SpeechLog = { events: SpeechEvent[]; clear: () => void };

/** The last speech events, oldest first. Not persisted. It helps to find why a reply stays silent. */
export const useSpeechLog = create<SpeechLog>()((set) => ({ events: [], clear: () => set({ events: [] }) }));

/** Adds one event. The oldest events drop when the log is full. */
export function logSpeech(text: string, at = Date.now()): void {
  useSpeechLog.setState((s) => ({ events: [...s.events, { at, text }].slice(-SPEECH_LOG_MAX) }));
}

const two = (n: number) => String(n).padStart(2, "0");

/** Local time as HH:MM:SS. */
export function logTime(at: number): string {
  const d = new Date(at);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** The whole log as text, newest first, one line per event. */
export function speechLogText(events: readonly SpeechEvent[] = useSpeechLog.getState().events): string {
  return [...events]
    .reverse()
    .map((e) => `${logTime(e.at)} ${e.text}`)
    .join("\n");
}
