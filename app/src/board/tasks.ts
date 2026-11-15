/**
 * The task model of the board for Herdr 2 (spec goals 2–4): helpers under their task, the repo line
 * of a card, and the letter tile of a group. Pure functions: the board, the search and the Spaces
 * tab use them, and the tests check them.
 */
import type { AgentStatus, GroupFields } from "@herdling/protocol";

import type { AgentInfo, Snapshot } from "@/herdr/snapshot";

const nonEmpty = (s: string | null | undefined): string | undefined => (s && s.trim() ? s.trim() : undefined);

/**
 * The helpers of a snapshot: helper pane id → the pane id of its task (the top agent of its
 * parent chain). A helper is an agent whose `parent_id` names another live agent of the same host.
 * A parent that is gone, a terminal that names itself and a loop of parents give no helper: those
 * agents stay cards of their own. A helper of a helper goes under the top task.
 */
export function helperParents(agents: readonly Pick<AgentInfo, "pane_id" | "parent_id">[]): Map<string, string> {
  const parent = new Map<string, string>();
  const live = new Set(agents.map((a) => a.pane_id));
  for (const a of agents) {
    const p = nonEmpty(a.parent_id);
    if (p && p !== a.pane_id && live.has(p)) parent.set(a.pane_id, p);
  }
  const out = new Map<string, string>();
  for (const id of parent.keys()) {
    const seen = new Set([id]);
    let top = parent.get(id)!;
    let loop = false;
    while (parent.has(top)) {
      if (seen.has(top)) {
        loop = true;
        break;
      }
      seen.add(top);
      top = parent.get(top)!;
    }
    if (!loop) out.set(id, top);
  }
  return out;
}

/** One helper under a task card. */
export type HelperInfo = { paneId: string; title: string; status: AgentStatus };

/**
 * The helper line of a task: "2 helpers · 1 needs you · 1 working". Undefined with no helpers.
 * Idle and finished helpers count only in the total.
 */
export function helperSummary(helpers: readonly Pick<HelperInfo, "status">[]): string | undefined {
  if (helpers.length === 0) return undefined;
  const blocked = helpers.filter((h) => h.status === "blocked").length;
  const working = helpers.filter((h) => h.status === "working").length;
  const parts = [`${helpers.length} ${helpers.length === 1 ? "helper" : "helpers"}`];
  if (blocked) parts.push(`${blocked} needs you`);
  if (working) parts.push(`${working} working`);
  return parts.join(" · ");
}

/** True when two names are the same for the eye: trimmed, any case. */
export const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The repo line of a card (goal 3): "repo · branch". The repo is left out when the group has the
 * same name, so the card does not say it twice. Undefined with no repo.
 */
export function repoLine(e: Pick<GroupFields, "repo" | "branch" | "group">): string | undefined {
  const repo = nonEmpty(e.repo);
  if (!repo) return undefined;
  const branch = nonEmpty(e.branch);
  const showRepo = !sameName(repo, e.group);
  if (showRepo && branch) return `${repo} · ${branch}`;
  return showRepo ? repo : branch;
}

/** The letter of a group tile: the first letter or digit, in upper case. "#" when it has none. */
export function groupLetter(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name);
  return m ? m[0].toLocaleUpperCase() : "#";
}

/** A stable index from 0 to n - 1 for a group name (the same name gets the same tile color). */
export function groupTone(name: string, n: number): number {
  if (n <= 0) return 0;
  let h = 5381;
  for (const ch of name.trim().toLowerCase()) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return h % n;
}

/** The group name of an entry, or undefined (herdr 1 and an older herdlingd send none). */
export const groupOf = (e: Pick<GroupFields, "group">): string | undefined => nonEmpty(e.group);

/** The count of agents that need the user (blocked) on the given hosts. Helpers count too. */
export function needsYouCount(snapshots: readonly (Pick<Snapshot, "agents"> | undefined)[]): number {
  let n = 0;
  for (const s of snapshots) for (const a of s?.agents ?? []) if (a.agent_status === "blocked") n++;
  return n;
}
