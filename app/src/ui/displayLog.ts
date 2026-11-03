import { create } from "zustand";

import { logTime } from "@/voice/speechLog";

/**
 * The display log: the last keyboard events and picker failures. It helps to find why the keyboard
 * covers the composer or a picker does not open, for example while the screen is shared with AirPlay.
 * It keeps only sizes, positions, event names and error messages. Not persisted, like the speech log.
 */

/** The log keeps this many events. */
export const DISPLAY_LOG_MAX = 30;

export type DisplayEvent = { at: number; text: string };

type DisplayLog = { events: DisplayEvent[]; clear: () => void };

export const useDisplayLog = create<DisplayLog>()((set) => ({ events: [], clear: () => set({ events: [] }) }));

/** Adds one event. The oldest events drop when the log is full. */
export function logDisplay(text: string, at = Date.now()): void {
  useDisplayLog.setState((s) => ({ events: [...s.events, { at, text }].slice(-DISPLAY_LOG_MAX) }));
}

/** The values of one keyboard measurement. */
export type KeyboardSample = {
  event: string;
  screenY: number;
  height: number;
  window: { width: number; height: number };
  screen: { width: number; height: number };
  viewY?: number;
  viewHeight?: number;
  top: number;
  pad?: number;
  note?: string;
};

const num = (n: number | undefined) => (n == null || !Number.isFinite(n) ? "?" : String(Math.round(n * 10) / 10));

/** One keyboard sample as one line of text. */
export function keyboardLine(s: KeyboardSample): string {
  return [
    `kb ${s.event}`,
    `y=${num(s.screenY)} h=${num(s.height)}`,
    `win=${num(s.window.width)}x${num(s.window.height)}`,
    `scr=${num(s.screen.width)}x${num(s.screen.height)}`,
    `view=${num(s.viewY)}+${num(s.viewHeight)}`,
    `top=${num(s.top)} pad=${num(s.pad)}`,
    ...(s.note ? [s.note] : []),
  ].join(" ");
}

/** The whole log as text, newest first, one line per event. */
export function displayLogText(events: readonly DisplayEvent[] = useDisplayLog.getState().events): string {
  return [...events]
    .reverse()
    .map((e) => `${logTime(e.at)} ${e.text}`)
    .join("\n");
}
