/**
 * "Run" on a shell code block of a reply: which blocks get the button, the command text of a
 * block, and the run itself (a new shell, or an existing terminal on the same host).
 * The rules are pure; `runCommand` does the I/O through the rpc that the caller passes in.
 */
import { create } from "zustand";

import type { Snapshot } from "@/herdr/snapshot";
import { startShell, workspaceExists } from "@/herdr/startSession";
import { terminalFolder } from "@/herdr/terminals";
import { workspaceForCwd } from "@/herdr/workspaceForCwd";
import type { RpcClient } from "@/rpc/RpcClient";
import type { RunHost } from "@/thread/LiveToolContext";
import { sendLine } from "@/terminal/keys";

type Rpc = Pick<RpcClient, "call">;

/** Fence languages that hold shell commands. */
const SHELL_LANGS = new Set(["bash", "sh", "zsh", "shell", "console", "terminal", "fish", "shellsession"]);
/** Languages that mix commands (after a prompt) with their output. */
const SESSION_LANGS = new Set(["console", "terminal", "shellsession"]);
/** A `$ ` or `% ` prompt at the start of a line. */
const PROMPT = /^\s*[$%] /;

/** The language of a fence from its info string (` ```bash title=x ` gives "bash"), in lower case. */
export function fenceLang(info: string | undefined): string {
  return (info ?? "").trim().split(/\s+/)[0].toLowerCase();
}

/** True when the fence language is a shell language. */
export const isShellLang = (lang: string | undefined): boolean => SHELL_LANGS.has(fenceLang(lang));

/**
 * The command to run for a code block, or null when the block is not a shell block or holds no
 * command. It removes a `$ ` or `% ` prompt from each line. In a session block (`console`,
 * `terminal`, `shellsession`) with prompts, only the prompt lines stay: the other lines are output.
 */
export function runnableCommand(lang: string | undefined, content: string): string | null {
  const l = fenceLang(lang);
  if (!SHELL_LANGS.has(l)) return null;
  let lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (SESSION_LANGS.has(l) && lines.some((x) => PROMPT.test(x))) lines = lines.filter((x) => PROMPT.test(x));
  lines = lines.map((x) => x.replace(PROMPT, ""));
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  const text = lines.join("\n");
  return text.trim() ? text : null;
}

/** The answer of herdr `pane.process_info`, as far as the app reads it. */
export type ProcessInfo = {
  process_info?: {
    shell_pid?: number | null;
    foreground_process_group_id?: number | null;
    foreground_processes?: { pid?: number; name?: string }[] | null;
  };
};

/**
 * The name of the process that keeps the shell of a terminal busy, or undefined when the shell is
 * in the foreground or herdr does not say.
 */
export function busyProcess(r: ProcessInfo | undefined): string | undefined {
  const info = r?.process_info;
  const fg = info?.foreground_process_group_id;
  if (!info?.shell_pid || !fg || fg === info.shell_pid) return undefined;
  const procs = info.foreground_processes ?? [];
  const leader = procs.find((p) => p.pid === fg) ?? procs[0];
  return leader?.name?.trim() || "a process";
}

/** The folder of a pane: the agent's folder, else the folder herdr reports for the pane. */
export function paneFolder(snapshot: Pick<Snapshot, "agents" | "panes"> | undefined, paneId: string): string | undefined {
  const cwd = snapshot?.agents.find((a) => a.pane_id === paneId)?.cwd?.trim();
  if (cwd) return cwd;
  const pane = snapshot?.panes.find((p) => p.pane_id === paneId);
  return pane ? terminalFolder(pane) : undefined;
}

/** Where the command runs: a new shell in a folder, or an existing terminal pane. */
export type RunTarget = { kind: "new"; cwd: string } | { kind: "pane"; paneId: string };

/**
 * Runs the command. A new shell opens as a tab of the workspace that already uses the folder,
 * else as a new workspace (the same default as New session). An existing terminal gets the text
 * and Enter; each line of a multi-line command runs. It throws when no pane exists to open.
 * `commandError` is set when a new shell opened but the command did not go through.
 */
export async function runCommand(
  rpc: Rpc,
  snapshot: Snapshot | undefined,
  target: RunTarget,
  command: string,
): Promise<{ paneId: string; commandError?: string }> {
  if (target.kind === "pane") {
    await sendLine(rpc, target.paneId, command);
    return { paneId: target.paneId };
  }
  const ws = workspaceForCwd(snapshot, target.cwd);
  const reuse = ws && (await workspaceExists(rpc, ws.workspace_id));
  return startShell(rpc, { cwd: target.cwd, command, workspaceId: reuse && ws ? ws.workspace_id : undefined });
}

/**
 * What the run sheet opens with: the pane of the reply and the command of the block. With no pane
 * (a subagent whose parent is not known), the sheet offers only the terminals of the host.
 */
export type RunRequest = { hostId: string; paneId?: string; command: string };

export const useRunRequest = create<{ req?: RunRequest }>(() => ({}));

/** Opens the run sheet for a code block. The sheet is the confirmation: nothing runs before it. */
export function openRunSheet(req: RunRequest): void {
  useRunRequest.setState({ req });
  // Loaded on first use: the router module is large, and thread rows load this module.
  const { router } = require("expo-router") as typeof import("expo-router");
  router.push("/run-command" as never);
}

/**
 * Opens the run sheet for a command of a reply on this host: through the `open` of the thread
 * (the peek sheet closes first), else at once.
 */
export function runAt(at: RunHost, command: string): void {
  const req: RunRequest = { hostId: at.hostId, paneId: at.paneId, command };
  if (at.open) at.open(req);
  else openRunSheet(req);
}
