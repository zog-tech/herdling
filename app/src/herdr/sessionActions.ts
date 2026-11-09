import type { Hello, ThreadRef } from "@herdling/protocol";

import type { RpcClient } from "@/rpc/RpcClient";
import { RpcError } from "@/rpc/RpcClient";

import { assertAllows } from "./backend";
import { expectPane } from "./expectedPanes";
import { isGroupCloseRefusal } from "./groupClose";
import type { AgentInfo } from "./snapshot";
import { startSession, workspaceExists } from "./startSession";

type Rpc = Pick<RpcClient, "call">;

/** herdr agent names: lowercase letter first, then letters, digits, "-" or "_", 32 max. */
export const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;

const herdr = (rpc: Rpc, method: string, params: object) => rpc.call("herdr.call", { method, params });

function cwdOf(a: AgentInfo): string {
  if (!a.cwd) throw new RpcError("no_cwd", "herdr did not report this agent's folder");
  return a.cwd;
}

/** The agent kind. herdr sends null while it has not detected the agent yet. */
function kindOf(a: AgentInfo): string {
  if (!a.agent) throw new RpcError("no_kind", "herdr has not detected this agent yet");
  return a.agent;
}

/** What a restart does: resume `session` (keep the conversation) or not, and the extra agent arguments. */
export type RestartPlan = {
  /** The session id to resume. Undefined: a new conversation. */
  session?: string;
  /** Start options of the kind (`buildArgs`), after the resume arguments. */
  args?: string[];
};

/** The agent arguments of a restart: the resume arguments first (when the kind can resume), then the option arguments. */
export function restartArgs(kind: string, plan: RestartPlan): string[] {
  const resume = plan.session ? resumeArgs(kind, plan.session) : undefined;
  return [...(resume ?? []), ...(plan.args ?? [])];
}

/** True when the plan keeps the conversation: it has a session and the kind has a resume flag. */
export const keepsConversation = (kind: string, plan: RestartPlan) => !!plan.session && !!resumeArgs(kind, plan.session);

/** Error code: a kept-conversation restart cannot close the last pane of a workspace with worktrees. */
export const GROUP_RESTART = "group_restart";
const GROUP_RESTART_TEXT =
  "This agent is the last pane of a workspace with worktrees, and herdr closes that pane only with the whole group. " +
  "Nothing changed. Restart with a new conversation instead.";

/** Error code: the old agent closed, but the new one did not start. The conversation is still on the computer. */
export const RESTART_AFTER_CLOSE = "restart_after_close";

/**
 * herdr has no agent stop: start the same kind in a new tab of the same workspace, and close the
 * old pane. A new conversation starts first and closes the old pane after: a failed start leaves
 * the old pane as it was.
 *
 * A kept conversation closes the old pane first. Two agents on one session at the same time both
 * write its log (Claude Code appends to the same `.jsonl`), and the log can break. When the start
 * then fails, the error has the code `RESTART_AFTER_CLOSE`: the conversation is safe in its log,
 * "Try again" (`startRestarted`) or "Resume older session" brings it back.
 */
export async function restartAgent(rpc: Rpc, a: AgentInfo, plan: RestartPlan = {}): Promise<{ paneId: string; closeError?: string }> {
  assertAllows(a, "restart");
  const cwd = cwdOf(a);
  const kind = kindOf(a);
  const args = restartArgs(kind, plan);
  if (keepsConversation(kind, plan)) {
    // A failed close throws: nothing changed, the old agent still runs.
    try {
      await closeAgent(rpc, a.pane_id);
    } catch (e) {
      // herdr 0.9: the last pane of a workspace with worktrees closes only with the whole group.
      // A restart never closes the group.
      if (isGroupCloseRefusal(e)) throw new RpcError(GROUP_RESTART, GROUP_RESTART_TEXT);
      throw e;
    }
    return startRestarted(rpc, a, args);
  }
  const { paneId } = await startSession(rpc, { cwd, kind, workspaceId: a.workspace_id, args });
  // The new agent runs, so do not throw: the caller opens it and offers to close the old one.
  try {
    await herdr(rpc, "pane.close", { pane_id: a.pane_id });
  } catch (e) {
    return { paneId, closeError: e instanceof Error ? e.message : String(e) };
  }
  return { paneId };
}

/**
 * The start half of a restart that closed the old pane first. The workspace of the old pane can be
 * gone (the old pane was its last one): then the agent gets a new workspace. A failed start throws
 * an error with the code `RESTART_AFTER_CLOSE`.
 */
export async function startRestarted(rpc: Rpc, a: AgentInfo, args: string[]): Promise<{ paneId: string }> {
  try {
    const workspaceId = a.workspace_id && (await workspaceExists(rpc, a.workspace_id)) ? a.workspace_id : undefined;
    const { paneId } = await startSession(rpc, { cwd: cwdOf(a), kind: kindOf(a), workspaceId, args });
    return { paneId };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new RpcError(RESTART_AFTER_CLOSE, `The old agent is closed, but the new one did not start: ${why}. The conversation is safe on the computer.`);
  }
}

/** The session id of the conversation in `paneId` (`thread.resolve`), or undefined when there is none or the call fails. */
export async function paneSession(rpc: Rpc, paneId: string, kind: string): Promise<string | undefined> {
  try {
    const r = await rpc.call<ThreadRef>("thread.resolve", { pane_id: paneId });
    return r?.kind === kind && typeof r.session === "string" && r.session ? r.session : undefined;
  } catch {
    return undefined;
  }
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
  assertAllows(a, "resume");
  return resumeInFolder(rpc, { cwd: cwdOf(a), kind: kindOf(a), session, workspaceId: a.workspace_id });
}

/**
 * Opens an earlier session of `kind` in `cwd`: a new tab of `workspaceId`, or a new workspace.
 * New session uses it for its recent sessions, where no agent pane is open.
 */
export async function resumeInFolder(
  rpc: Rpc,
  o: { cwd: string; kind: string; session: string; workspaceId?: string },
): Promise<{ paneId: string }> {
  const args = resumeArgs(o.kind, o.session);
  if (!args) throw new RpcError("no_resume", `${o.kind} cannot resume an earlier session`);
  const { paneId } = await startSession(rpc, { cwd: o.cwd, kind: o.kind, workspaceId: o.workspaceId, args });
  return { paneId };
}

export async function renameAgent(rpc: Rpc, paneId: string, name: string): Promise<void> {
  assertAllows(paneId, "rename");
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
 * with the new one, so the old screen unmounts (it would keep speaking and polling). The new pane
 * expects an agent: it does not show as a terminal while the snapshot lags.
 */
export function openResumedSession(router: { dismiss: () => void; replace: (href: never) => void }, hostId: string, paneId: string) {
  expectPane(hostId, paneId, "agent");
  router.dismiss();
  router.replace(`/session/${hostId}/${paneId}` as never);
}
