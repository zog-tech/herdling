import type { Hello } from "@herdling/protocol";

import type { RpcClient } from "@/rpc/RpcClient";
import { RpcError } from "@/rpc/RpcClient";

import type { AgentInfo } from "./snapshot";
import { startSession } from "./startSession";

type Rpc = Pick<RpcClient, "call">;

/** herdr agent names: lowercase letter first, then letters, digits, "-" or "_", 32 max. */
export const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;

const herdr = (rpc: Rpc, method: string, params: object) => rpc.call("herdr.call", { method, params });

function cwdOf(a: AgentInfo): string {
  if (!a.cwd) throw new RpcError("no_cwd", "herdr did not report this agent's folder");
  return a.cwd;
}

/**
 * herdr has no agent stop: start the same kind in a new tab of the same workspace, then close
 * the old pane. A failed start leaves the old pane as it was.
 */
export async function restartAgent(rpc: Rpc, a: AgentInfo): Promise<{ paneId: string; closeError?: string }> {
  const { paneId } = await startSession(rpc, { cwd: cwdOf(a), kind: a.agent, workspaceId: a.workspace_id });
  // The new agent runs, so do not throw: the caller opens it and offers to close the old one.
  try {
    await herdr(rpc, "pane.close", { pane_id: a.pane_id });
  } catch (e) {
    return { paneId, closeError: e instanceof Error ? e.message : String(e) };
  }
  return { paneId };
}

/** The agent arguments that resume `session`, or `undefined` when the agent has no resume flag. */
export function resumeArgs(kind: string, session: string): string[] | undefined {
  switch (kind) {
    case "claude":
    // omp takes a session id (or its start); Gemini CLI takes the session UUID.
    case "omp":
    case "gemini":
      return ["--resume", session];
    case "codex":
      return ["resume", session];
    case "pi":
    case "opencode":
      return ["--session", session];
    default:
      return undefined;
  }
}

/**
 * True when the app can list and resume earlier sessions of `kind` on this host: the agent has a
 * resume flag and the host lists the kind in `thread_kinds`. A host without that field knows only Claude.
 */
export function canResume(hello: Hello | undefined, kind: string): boolean {
  if (!resumeArgs(kind, "x")) return false;
  return (hello?.thread_kinds ?? ["claude"]).includes(kind);
}

/** Opens an earlier session of the same agent in a new tab. The current pane stays. */
export async function resumeSession(rpc: Rpc, a: AgentInfo, session: string): Promise<{ paneId: string }> {
  const args = resumeArgs(a.agent, session);
  if (!args) throw new RpcError("no_resume", `${a.agent} cannot resume an earlier session`);
  const { paneId } = await startSession(rpc, { cwd: cwdOf(a), kind: a.agent, workspaceId: a.workspace_id, args });
  return { paneId };
}

export async function renameAgent(rpc: Rpc, paneId: string, name: string): Promise<void> {
  if (!AGENT_NAME_RE.test(name)) {
    throw new RpcError("bad_name", "Use lowercase letters, digits, - or _, starting with a letter (32 max).");
  }
  try {
    await herdr(rpc, "agent.rename", { target: paneId, name });
  } catch (e) {
    // herdr refuses a rename for some seconds after agent.start returns.
    if (e instanceof RpcError && e.code === "agent_launch_pending") {
      throw new RpcError("agent_launch_pending", "Still starting — try again in a few seconds.");
    }
    throw e;
  }
}

export async function closeAgent(rpc: Rpc, paneId: string): Promise<void> {
  await herdr(rpc, "pane.close", { pane_id: paneId });
}

/**
 * After "Resume older session": closes the resume modal, then replaces the old session screen
 * with the new one, so the old screen unmounts (it would keep speaking and polling).
 */
export function openResumedSession(router: { dismiss: () => void; replace: (href: never) => void }, hostId: string, paneId: string) {
  router.dismiss();
  router.replace(`/session/${hostId}/${paneId}` as never);
}
