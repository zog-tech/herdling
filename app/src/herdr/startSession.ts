import type { RpcClient } from "@/rpc/RpcClient";
import { sendLine } from "@/terminal/keys";

import { allows } from "./backend";

export type StartOptions = {
  cwd: string;
  kind: string;
  prompt?: string;
  /** Existing workspace: add a tab to it instead of creating a workspace. */
  workspaceId?: string;
  /** A new workspace that herdr already made (herdr `worktree.create`): use its root pane. */
  fresh?: FreshPane;
  /** Native agent arguments, for example `["--resume", id]`. */
  args?: string[];
  /** Called before each step with a short progress label. */
  onProgress?: (label: string) => void;
};

/**
 * `agent.start` waits for the agent to boot; herdr allows up to 30 s and the companion
 * gives up after 40 s. Wait longer than the companion, so its error arrives first.
 */
export const AGENT_START_TIMEOUT_MS = 45_000;

/**
 * Unique agent name for a pane. herdr allows lowercase letters, digits, "-" and "_", starting
 * with a letter (max 32). The pane id suffix keeps same-named folders and extra tabs apart.
 */
export function agentName(cwd: string, paneId: string): string {
  const suffix = "-" + paneId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  let base = basename(cwd).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/, "");
  if (!/^[a-z]/.test(base)) base = "s-" + base;
  return base.slice(0, Math.max(1, 32 - suffix.length)) + suffix;
}

export const basename = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

/** The root pane of a workspace that herdr made for the session, for example for a worktree. */
export type FreshPane = { workspaceId: string; paneId: string };

type Created = {
  workspace?: { workspace_id?: string };
  tab?: { tab_id?: string };
  root_pane?: { pane_id?: string };
};

/** A fresh pane needs a moment before herdr treats it as a shell. */
const SHELL_RETRIES = 12;
const SHELL_RETRY_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const notShellYet = (e: unknown) => e instanceof Error && /not an available shell/i.test(e.message);
/** `agent.start` returns while the agent still boots; `agent.prompt` fails until it is ready. */
const PROMPT_RETRIES = 60;
const notReadyYet = (e: unknown) => e instanceof Error && /not an active named agent|agent_not_ready/i.test(e.message);

async function retrying(retries: number, retryable: (e: unknown) => boolean, run: () => Promise<unknown>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (!retryable(e) || attempt >= retries) throw e;
      await sleep(SHELL_RETRY_MS);
    }
  }
}

const herdr = <T>(rpc: Pick<RpcClient, "call">, method: string, params: object, timeoutMs?: number) =>
  rpc.call<T>("herdr.call", { method, params }, timeoutMs);

/**
 * The pane for a new session: the root pane of a `fresh` workspace, a new tab of `workspaceId`,
 * or a new workspace. A `fresh` workspace is new, so a failed start closes it.
 */
async function paneFor(
  rpc: Pick<RpcClient, "call">,
  { cwd, workspaceId, fresh, onProgress }: { cwd: string; workspaceId?: string; fresh?: FreshPane; onProgress?: (label: string) => void },
): Promise<Created> {
  if (fresh) return { workspace: { workspace_id: fresh.workspaceId }, root_pane: { pane_id: fresh.paneId } };
  onProgress?.(workspaceId ? "Creating tab…" : "Creating workspace…");
  return workspaceId
    ? await herdr<Created>(rpc, "tab.create", { workspace_id: workspaceId, cwd, focus: false })
    : await herdr<Created>(rpc, "workspace.create", { cwd, label: basename(cwd), focus: false });
}

/**
 * Creates a workspace (or a tab), starts the agent in its first pane, then sends the prompt.
 * Once the agent runs, a failed prompt does not throw: it comes back as `promptError`, so the
 * caller opens the session instead of offering a second Start (a duplicate agent).
 */
export async function startSession(
  rpc: Pick<RpcClient, "call">,
  { cwd, kind, prompt, workspaceId: asked, fresh, args, onProgress }: StartOptions,
): Promise<{ paneId: string; promptError?: string }> {
  // herdr 1 cannot add a tab to a Herdr 2 workspace: the agent gets a new herdr 1 workspace.
  const workspaceId = asked && allows(asked, "newTab") ? asked : undefined;
  const created = await paneFor(rpc, { cwd, workspaceId, fresh, onProgress });
  const paneId = created.root_pane?.pane_id;
  if (!paneId) throw new Error("herdr did not return a pane");

  const name = agentName(cwd, paneId);
  onProgress?.(`Starting ${kind}…`);
  try {
    await retrying(SHELL_RETRIES, notShellYet, () =>
      herdr(rpc, "agent.start", { name, kind, pane_id: paneId, ...(args?.length ? { args } : {}) }, AGENT_START_TIMEOUT_MS),
    );
  } catch (e) {
    // Do not leave an empty workspace or tab behind; a retry would offer to reuse it.
    // A plain close is enough: the workspace of a new session has no linked worktrees. Never send
    // `close_group` here: when herdr refuses, the workspace stays (see `groupClose.ts`).
    const undo = workspaceId && !fresh
      ? created.tab?.tab_id && herdr(rpc, "tab.close", { tab_id: created.tab.tab_id })
      : created.workspace?.workspace_id && herdr(rpc, "workspace.close", { workspace_id: created.workspace.workspace_id });
    await Promise.resolve(undo).catch(() => {});
    throw e;
  }

  const text = prompt?.trim();
  if (text) {
    onProgress?.("Sending prompt…");
    try {
      await retrying(PROMPT_RETRIES, notReadyYet, () => herdr(rpc, "agent.prompt", { target: paneId, text }));
    } catch (e) {
      return { paneId, promptError: e instanceof Error ? e.message : String(e) };
    }
  }
  return { paneId };
}

type ProcessInfo = { process_info?: { shell_pid?: number | null; foreground_process_group_id?: number | null } };

/** True when the shell of the pane runs and is in the foreground, so it reads what is typed. */
const shellReady = (r: ProcessInfo | undefined) => {
  const info = r?.process_info;
  return !!info?.shell_pid && info.foreground_process_group_id === info.shell_pid;
};

/**
 * Waits until the shell of a fresh pane is in the foreground (`pane.process_info`). It does not
 * throw: a herdr without the method, or a shell that stays busy, gets the command anyway. The
 * terminal keeps typed text until the shell reads it.
 */
async function waitForShell(rpc: Pick<RpcClient, "call">, paneId: string): Promise<void> {
  for (let attempt = 0; attempt < SHELL_RETRIES; attempt++) {
    try {
      if (shellReady(await herdr<ProcessInfo>(rpc, "pane.process_info", { pane_id: paneId }))) return;
    } catch {
      return;
    }
    await sleep(SHELL_RETRY_MS);
  }
}

/**
 * Creates a workspace (or a tab) and leaves its shell as it is: no agent. With a `command`, it
 * types the command and presses Enter once the shell is ready. Once the pane exists, a failed
 * command does not throw: it comes back as `commandError`, so the caller still opens the pane.
 */
export async function startShell(
  rpc: Pick<RpcClient, "call">,
  {
    cwd,
    command,
    workspaceId: asked,
    fresh,
    onProgress,
  }: { cwd: string; command?: string; workspaceId?: string; fresh?: FreshPane; onProgress?: (label: string) => void },
): Promise<{ paneId: string; commandError?: string }> {
  // The same rule as `startSession`: a Herdr 2 workspace gets no herdr 1 tab.
  const workspaceId = asked && allows(asked, "newTab") ? asked : undefined;
  const created = await paneFor(rpc, { cwd, workspaceId, fresh, onProgress });
  const paneId = created.root_pane?.pane_id;
  if (!paneId) throw new Error("herdr did not return a pane");

  const text = command?.trim();
  if (text) {
    onProgress?.("Running command…");
    try {
      await waitForShell(rpc, paneId);
      await sendLine(rpc, paneId, text);
    } catch (e) {
      return { paneId, commandError: e instanceof Error ? e.message : String(e) };
    }
  }
  return { paneId };
}

/** True when herdr still has the workspace (the app's snapshot can lag behind). */
export async function workspaceExists(rpc: Pick<RpcClient, "call">, workspaceId: string): Promise<boolean> {
  try {
    await herdr(rpc, "workspace.get", { workspace_id: workspaceId });
    return true;
  } catch {
    return false;
  }
}
