/**
 * Close with explicit worktree group intent (herdr 0.9.0 and later).
 *
 * A primary workspace with open linked worktree workspaces is a group. herdr refuses a close that
 * would close the primary workspace of a group:
 * - `workspace.close` without `close_group` answers `workspace_group_close_required`
 *   ("workspace has linked worktree workspaces; use --group (close_group=true in the API) ...").
 * - `pane.close` and `tab.close` of the last pane or tab answer `confirmation_required`
 *   ("closing this pane would close a worktree group").
 * The only way past the refusal is `workspace.close` with `{ workspace_id, close_group: true }`
 * (`WorkspaceCloseParams` in `herdr api schema --json`). It closes the primary workspace and all
 * its linked worktree workspaces. herdr has no "close only the primary" option, so the app asks
 * the user, and never sends `close_group` without that answer.
 */
import type { RpcClient } from "@/rpc/RpcClient";
import * as haptics from "@/ui/haptics";
import { showActionSheet } from "@/ui/nativeSheet";

type Rpc = Pick<RpcClient, "call">;

const herdr = <T>(rpc: Rpc, method: string, params: object) => rpc.call<T>("herdr.call", { method, params });

/** True when herdr refused the close because it would close a worktree group. */
export function isGroupCloseRefusal(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "workspace_group_close_required") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return code === "confirmation_required" && /worktree group/i.test(msg);
}

/** The worktree provenance of a workspace (`WorkspaceWorktreeInfo`). Missing on a herdr before 0.9. */
type WorktreeInfo = { repo_key?: string; is_linked_worktree?: boolean } | null | undefined;
type ListedWorkspace = { workspace_id?: string; worktree?: WorktreeInfo };

/**
 * The number of open linked worktree workspaces in the group of `workspaceId`, from a
 * `workspace.list` result (`{ type: "workspace_list", workspaces: WorkspaceInfo[] }`).
 * Undefined when the list does not say.
 */
export function linkedWorktreeCount(result: unknown, workspaceId: string): number | undefined {
  const list = (result as { workspaces?: unknown } | null)?.workspaces;
  if (!Array.isArray(list)) return undefined;
  const all = list as ListedWorkspace[];
  const key = all.find((w) => w.workspace_id === workspaceId)?.worktree?.repo_key;
  if (!key) return undefined;
  const n = all.filter((w) => w.workspace_id !== workspaceId && w.worktree?.is_linked_worktree && w.worktree.repo_key === key).length;
  return n > 0 ? n : undefined;
}

/** Asks herdr how many worktree workspaces the group has. Undefined when the call fails. */
export async function groupWorktreeCount(rpc: Rpc, workspaceId: string): Promise<number | undefined> {
  try {
    return linkedWorktreeCount(await herdr(rpc, "workspace.list", {}), workspaceId);
  } catch {
    return undefined;
  }
}

/** The label of the group close option. */
export function groupCloseLabel(count: number | undefined): string {
  if (count === undefined) return "Close the workspace and its worktrees";
  return count === 1 ? "Close the workspace and its 1 worktree" : `Close the workspace and its ${count} worktrees`;
}

/** The text of the group close sheet. */
export const GROUP_CLOSE_TITLE = "This workspace has worktrees";
export const GROUP_CLOSE_MESSAGE =
  "This is the last pane of a workspace with open worktree workspaces. herdr closes them together or not at all. " +
  "The worktree folders and branches stay on the computer.";

/** Asks the user for the group close. Resolves true for the group close, false for Cancel. */
export function chooseGroupClose(count: number | undefined): Promise<boolean> {
  haptics.warn();
  return new Promise((resolve) =>
    showActionSheet(
      {
        title: GROUP_CLOSE_TITLE,
        message: GROUP_CLOSE_MESSAGE,
        options: [groupCloseLabel(count), "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (i) => resolve(i === 0),
    ),
  );
}

/** `workspace.close` with explicit group intent. Only after the user chose it. */
export async function closeWorkspaceGroup(rpc: Rpc, workspaceId: string): Promise<void> {
  await herdr(rpc, "workspace.close", { workspace_id: workspaceId, close_group: true });
}

/**
 * Runs `close` (for example `pane.close`). When herdr refuses it because of a worktree group,
 * it asks the user, and with a yes it closes the workspace and its worktrees. Resolves true when
 * something closed, false when the user kept the group. Other errors go to the caller.
 * `ask` is the sheet; tests pass a fake.
 */
export async function closeWithGroupIntent(
  rpc: Rpc,
  workspaceId: string | undefined,
  close: () => Promise<void>,
  ask: (count: number | undefined) => Promise<boolean> = chooseGroupClose,
): Promise<boolean> {
  try {
    await close();
    return true;
  } catch (e) {
    if (!workspaceId || !isGroupCloseRefusal(e)) throw e;
    const count = await groupWorktreeCount(rpc, workspaceId);
    if (!(await ask(count))) return false;
    await closeWorkspaceGroup(rpc, workspaceId);
    return true;
  }
}
