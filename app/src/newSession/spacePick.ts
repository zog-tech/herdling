/**
 * The space picker of New session on Herdr 2 (spec goal 5): the spaces of `groups.list`, "New
 * space", the first choice, and a small machine that loads the groups. Pure: `app/new.tsx` runs it.
 */
import type { CoreGroup, Hello } from "@herdling/protocol";

import { folderPath } from "@/board/buckets";
import { coreActions } from "@/herdr/backend";
import type { Snapshot } from "@/herdr/snapshot";

/** One choice of the Space picker. `id` null is "New space". */
export type SpaceChoice = { id: string | null; label: string };

export const NEW_SPACE: SpaceChoice = { id: null, label: "New space" };

/**
 * True when New session starts agents on the Herdr 2 core of the host: the host has the plan C
 * methods (`session.start`) and reaches a core.
 */
export function startsOnCore(hello: Pick<Hello, "methods" | "backends"> | undefined): boolean {
  return coreActions(hello) && !!hello?.backends?.core;
}

/**
 * "New space", then the spaces and the label groups by name. A repo or folder group is left out:
 * herdlingd places a new terminal there by its folder, not by a label, so the choice would not hold.
 */
export function spaceChoices(groups: readonly CoreGroup[]): SpaceChoice[] {
  const list = groups
    .filter((g) => g.source === "space" || g.source === "label")
    .map((g) => ({ id: g.workspace_id, label: g.label.trim() || g.workspace_id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [NEW_SPACE, ...list];
}

/**
 * The choice to select first: the asked space when it is in the list; else the space that holds an
 * agent in the folder `cwd`; else "New space".
 */
export function firstChoice(
  choices: readonly SpaceChoice[],
  snapshot: Pick<Snapshot, "agents"> | undefined,
  cwd: string | undefined,
  asked?: string,
): string | null {
  const ids = new Set(choices.map((c) => c.id).filter((id): id is string => id !== null));
  if (asked && ids.has(asked)) return asked;
  const folder = folderPath(cwd);
  if (folder) {
    const hit = snapshot?.agents.find((a) => ids.has(a.workspace_id) && folderPath(a.cwd) === folder);
    if (hit) return hit.workspace_id;
  }
  return null;
}

/** The load of `groups.list`. Each load has a generation: an answer of an old load is dropped. */
export type GroupsLoad =
  | { kind: "idle"; gen: number }
  | { kind: "loading"; gen: number }
  | { kind: "ready"; gen: number; groups: CoreGroup[] }
  | { kind: "failed"; gen: number; error: string };

export type GroupsEvent = { type: "load" } | { type: "done"; gen: number; groups: CoreGroup[] } | { type: "fail"; gen: number; error: string } | { type: "reset" };

export type GroupsEffect = { type: "fetch"; gen: number };

export const initialGroups: GroupsLoad = { kind: "idle", gen: 0 };

export function groupsReducer(state: GroupsLoad, event: GroupsEvent): { state: GroupsLoad; effects: GroupsEffect[] } {
  switch (event.type) {
    case "load": {
      const gen = state.gen + 1;
      return { state: { kind: "loading", gen }, effects: [{ type: "fetch", gen }] };
    }
    case "done":
      if (state.kind !== "loading" || event.gen !== state.gen) return { state, effects: [] };
      return { state: { kind: "ready", gen: state.gen, groups: event.groups }, effects: [] };
    case "fail":
      if (state.kind !== "loading" || event.gen !== state.gen) return { state, effects: [] };
      return { state: { kind: "failed", gen: state.gen, error: event.error }, effects: [] };
    case "reset":
      return { state: { kind: "idle", gen: state.gen + 1 }, effects: [] };
  }
}

/** The detail line of the Space row while the spaces load or after the load failed. */
export function spaceDetail(load: GroupsLoad): string | undefined {
  if (load.kind === "loading") return "Loading the spaces…";
  if (load.kind === "failed") return "Can't list the spaces. The session starts in a new space.";
  return undefined;
}
