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

/** Opens an earlier Claude session in a new tab. The current pane stays. */
export async function resumeSession(rpc: Rpc, a: AgentInfo, session: string): Promise<{ paneId: string }> {
  const { paneId } = await startSession(rpc, {
    cwd: cwdOf(a),
    kind: "claude",
    workspaceId: a.workspace_id,
    args: ["--resume", session],
  });
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
