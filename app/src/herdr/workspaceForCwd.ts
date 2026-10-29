import type { Snapshot, WorkspaceInfo } from "./snapshot";

const norm = (p: string) => p.replace(/\/+$/, "") || "/";

/** The workspace whose agents or panes already run in `cwd`, if any. */
export function workspaceForCwd(snapshot: Snapshot | undefined, cwd: string): WorkspaceInfo | undefined {
  if (!snapshot) return undefined;
  const want = norm(cwd);
  const cwdOf = (x: object) => (x as { cwd?: unknown }).cwd;
  const hit = [...snapshot.agents, ...snapshot.panes].find((x) => {
    const c = cwdOf(x);
    return typeof c === "string" && norm(c) === want;
  });
  return hit ? snapshot.workspaces.find((w) => w.workspace_id === hit.workspace_id) : undefined;
}
