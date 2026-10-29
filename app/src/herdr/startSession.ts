import type { RpcClient } from "@/rpc/RpcClient";

export type StartOptions = {
  cwd: string;
  kind: string;
  prompt?: string;
  /** Existing workspace: add a tab to it instead of creating a workspace. */
  workspaceId?: string;
  /** Called before each step with a short progress label. */
  onProgress?: (label: string) => void;
};

/** `agent.start` waits for the agent to boot; herdr allows up to 30 s. */
const AGENT_START_TIMEOUT_MS = 40_000;

export const basename = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

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

/** Creates a workspace (or a tab), starts the agent in its first pane, then sends the prompt. */
export async function startSession(
  rpc: Pick<RpcClient, "call">,
  { cwd, kind, prompt, workspaceId, onProgress }: StartOptions,
): Promise<{ paneId: string }> {
  const name = basename(cwd);
  onProgress?.(workspaceId ? "Creating tab…" : "Creating workspace…");
  const created = workspaceId
    ? await herdr<Created>(rpc, "tab.create", { workspace_id: workspaceId, cwd, focus: false })
    : await herdr<Created>(rpc, "workspace.create", { cwd, label: name, focus: false });
  const paneId = created.root_pane?.pane_id;
  if (!paneId) throw new Error("herdr did not return a pane");

  onProgress?.(`Starting ${kind}…`);
  try {
    await retrying(SHELL_RETRIES, notShellYet, () =>
      herdr(rpc, "agent.start", { name, kind, pane_id: paneId }, AGENT_START_TIMEOUT_MS),
    );
  } catch (e) {
    // Do not leave an empty workspace or tab behind; a retry would offer to reuse it.
    const undo = workspaceId
      ? created.tab?.tab_id && herdr(rpc, "tab.close", { tab_id: created.tab.tab_id })
      : created.workspace?.workspace_id && herdr(rpc, "workspace.close", { workspace_id: created.workspace.workspace_id });
    await Promise.resolve(undo).catch(() => {});
    throw e;
  }

  const text = prompt?.trim();
  if (text) {
    onProgress?.("Sending prompt…");
    // `agent.prompt` addresses the agent by the name given to `agent.start`, not by pane id.
    await retrying(PROMPT_RETRIES, notReadyYet, () => herdr(rpc, "agent.prompt", { target: name, text }));
  }
  return { paneId };
}
