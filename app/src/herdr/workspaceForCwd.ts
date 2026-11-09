import { isCore } from "./backend";
import type { Snapshot, WorkspaceInfo } from "./snapshot";

const norm = (p: string) => p.replace(/\/+$/, "") || "/";

/**
 * The workspace whose agents already run in `cwd`, if any. Plain panes do not count: a shell can
 * `cd` anywhere, so its folder says nothing about the project of its workspace.
 * Only herdr 1 workspaces count: New session cannot start an agent in a Herdr 2 workspace.
 */
export function workspaceForCwd(snapshot: Snapshot | undefined, cwd: string): WorkspaceInfo | undefined {
  if (!snapshot) return undefined;
  const want = norm(cwd);
  const cwdOf = (x: object) => (x as { cwd?: unknown }).cwd;
  const hit = snapshot.agents.find((x) => {
    if (isCore(x) || isCore(x.workspace_id)) return false;
    const c = cwdOf(x);
    return typeof c === "string" && norm(c) === want;
  });
  return hit ? snapshot.workspaces.find((w) => w.workspace_id === hit.workspace_id && !isCore(w)) : undefined;
}
