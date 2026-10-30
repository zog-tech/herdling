import { create } from "zustand";

import { formatDuration } from "@/ui/format";

export type ToolResult = { ok: boolean; text: string; truncated: boolean; ts?: number };

/** The tool call the full-screen tool view shows. */
export type ToolView = {
  id: string;
  hostId: string;
  paneId: string;
  name: string;
  input: unknown;
  /** Epoch ms of the call. */
  ts: number;
  result?: ToolResult;
};

type State = { current?: ToolView };

/** In memory: the card writes the tool here before it opens the view, and keeps it fresh while open. */
export const useToolView = create<State>(() => ({}));

export function openToolView(v: ToolView): void {
  useToolView.setState({ current: v });
}

/** Updates the open view when it shows this tool (a result came in). */
export function refreshToolView(v: ToolView): void {
  const cur = useToolView.getState().current;
  if (cur && cur.id === v.id && cur.hostId === v.hostId && (cur.result !== v.result || cur.input !== v.input)) {
    useToolView.setState({ current: v });
  }
}

/** Full text of a tool input: strings as they are, other values as indented JSON. */
export function fullInputText(input: unknown): string {
  if (input == null) return "";
  return typeof input === "string" ? input : JSON.stringify(input, null, 2);
}

/** Last `n` lines of a screen, without the blank lines at the end. */
export function lastLines(text: string, n: number): string {
  const lines = text.replace(/\s+$/, "").split("\n");
  return lines.slice(-n).join("\n");
}

/** Timer text of a tool: "12s" while it runs (from `now`), the run time when done, "<1s" under a second. */
export function toolTime(ts: number, result: ToolResult | undefined, now: number): string | undefined {
  if (!(ts > 0)) return undefined;
  const end = result ? result.ts : now;
  if (end === undefined) return undefined;
  const ms = Math.max(0, end - ts);
  return ms < 1000 ? (result ? "<1s" : "0s") : formatDuration(ms / 1000);
}
