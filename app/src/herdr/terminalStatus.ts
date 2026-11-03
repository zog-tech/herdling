/**
 * The status of a terminal: idle (the shell is in the foreground) or running a command.
 * The rules read the answer of herdr `pane.process_info`; `fetchTerminalStatuses` does the I/O
 * through the rpc that the caller passes in. The store keeps the last status of each pane.
 */
import { create } from "zustand";

import type { RpcClient } from "@/rpc/RpcClient";

type Rpc = Pick<RpcClient, "call">;

/** One foreground process, as herdr reports it. */
export type ForegroundProcess = { pid?: number; name?: string; argv?: string[] | null; cmdline?: string | null };

/** The answer of herdr `pane.process_info`, as far as the app reads it. */
export type ProcessInfo = {
  process_info?: {
    shell_pid?: number | null;
    foreground_process_group_id?: number | null;
    foreground_processes?: ForegroundProcess[] | null;
  };
};

export type TerminalStatus = { kind: "idle" } | { kind: "running"; command: string };

/** The longest command text that a status line shows. */
export const STATUS_COMMAND_MAX = 40;

const nonEmpty = (s: string | null | undefined): string | undefined => (s && s.trim() ? s.trim().replace(/\s+/g, " ") : undefined);

/**
 * The process that keeps the shell busy: the group leader (its pid is the foreground group id),
 * else the first foreground process. Null when the shell is in the foreground. Undefined when
 * herdr does not say.
 */
export function foregroundProcess(r: ProcessInfo | undefined): ForegroundProcess | null | undefined {
  const info = r?.process_info;
  const fg = info?.foreground_process_group_id;
  if (!info?.shell_pid || !fg) return undefined;
  if (fg === info.shell_pid) return null;
  const procs = info.foreground_processes ?? [];
  return procs.find((p) => p.pid === fg) ?? procs[0] ?? {};
}

/** Cuts a text to `max` characters, with "…" at the end when it is longer. */
export function trimCommand(text: string, max = STATUS_COMMAND_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * The status of a terminal from `pane.process_info`, or undefined when herdr does not say.
 * A running command shows its command line, else its argv, else its name, cut to 40 characters.
 */
export function terminalStatus(r: ProcessInfo | undefined): TerminalStatus | undefined {
  const p = foregroundProcess(r);
  if (p === undefined) return undefined;
  if (p === null) return { kind: "idle" };
  const text = nonEmpty(p.cmdline) ?? nonEmpty(p.argv?.join(" ")) ?? nonEmpty(p.name) ?? "a process";
  return { kind: "running", command: trimCommand(text) };
}

/** The status line: "Running: npm run dev" or "Idle". */
export const statusLabel = (s: TerminalStatus): string => (s.kind === "idle" ? "Idle" : `Running: ${s.command}`);

/** The most panes that one poll of a host asks about. */
export const STATUS_PANE_CAP = 12;

/**
 * Asks herdr for the process info of each pane, one call after the other, for at most 12 panes.
 * A pane with no answer (an older herdr, a pane that closed) is not in the result.
 */
export async function fetchTerminalStatuses(rpc: Rpc, paneIds: string[]): Promise<Record<string, TerminalStatus>> {
  const out: Record<string, TerminalStatus> = {};
  for (const id of paneIds.slice(0, STATUS_PANE_CAP)) {
    try {
      const r = await rpc.call<ProcessInfo>("herdr.call", { method: "pane.process_info", params: { pane_id: id } });
      const s = terminalStatus(r);
      if (s) out[id] = s;
    } catch {
      // No answer: the row shows no status.
    }
  }
  return out;
}

/** The last known status of each terminal, by `hostId:paneId`. */
export const useTerminalStatus = create<{ byKey: Record<string, TerminalStatus> }>(() => ({ byKey: {} }));

/** Stores the statuses of one host. A pane that was asked about and gave no answer loses its status. */
export function setHostStatuses(hostId: string, asked: string[], statuses: Record<string, TerminalStatus>): void {
  useTerminalStatus.setState((s) => {
    const byKey = { ...s.byKey };
    for (const id of asked) {
      const key = `${hostId}:${id}`;
      const st = statuses[id];
      if (st) byKey[key] = st;
      else delete byKey[key];
    }
    return { byKey };
  });
}
