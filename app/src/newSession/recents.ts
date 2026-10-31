import type { RecentSession } from "@herdling/protocol";

import type { RpcClient } from "@/rpc/RpcClient";

import { baseName, displayPath } from "./paths";

/** Chips in the recent folder row. */
export const RECENT_FOLDER_CAP = 8;
/** Folders asked for recent sessions, and sessions per folder. */
export const SESSION_FOLDERS = 4;
export const SESSIONS_PER_FOLDER = 2;
/** Cards in the recent session row. */
export const RECENT_SESSION_CAP = 6;

export type RecentFolder = { path: string; label: string; display: string };

/**
 * The recent folder chips: herdlingd sends `recent_cwds` newest first. Keep that order, drop
 * empty and repeated paths (a trailing slash does not make a new path), cap the count.
 */
export function recentFolders(cwds: readonly string[], home: string, cap = RECENT_FOLDER_CAP): RecentFolder[] {
  const seen = new Set<string>();
  const out: RecentFolder[] = [];
  for (const raw of cwds) {
    const path = raw.replace(/(.)\/+$/, "$1");
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push({ path, label: path === home ? "~" : baseName(path), display: displayPath(path, home) });
    if (out.length >= cap) break;
  }
  return out;
}

/** One list from the answers of several folders: newest first, each session once. */
export function mergeRecentSessions(lists: readonly (readonly RecentSession[])[], cap = RECENT_SESSION_CAP): RecentSession[] {
  const byId = new Map<string, RecentSession>();
  for (const s of lists.flat()) {
    const had = byId.get(s.session);
    if (!had || had.last_activity < s.last_activity) byId.set(s.session, s);
  }
  return [...byId.values()].sort((a, b) => b.last_activity - a.last_activity).slice(0, cap);
}

/**
 * The latest sessions of `kind` on the host. `sessions.recent` needs a folder, so the app asks for
 * the newest recent folders and merges the answers. A folder that fails gives nothing.
 */
export async function loadRecentSessions(
  rpc: Pick<RpcClient, "call">,
  kind: string,
  cwds: readonly string[],
): Promise<RecentSession[]> {
  const asks = cwds
    .slice(0, SESSION_FOLDERS)
    .map((cwd) => rpc.call<RecentSession[]>("sessions.recent", { cwd, kind, limit: SESSIONS_PER_FOLDER }));
  const answers = await Promise.allSettled(asks);
  return mergeRecentSessions(answers.map((a) => (a.status === "fulfilled" && Array.isArray(a.value) ? a.value : [])));
}
