import { groupBoard, type BoardItem, type BoardSection, type GroupBy } from "./buckets";

/**
 * How the Board arranges its agents: the sort inside each group, the grouping (with a flat "none"
 * list), and the collapsed sections. Pure functions; `buckets.ts` keeps the bucket rules.
 */

/** How the Board groups its agents. "none": one flat list with no section headers. */
export type BoardGroup = GroupBy | "none";

/** The groups in the order the menu shows them, with their names. */
export const BOARD_GROUPS: readonly { id: BoardGroup; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "host", label: "Computer" },
  { id: "workspace", label: "Workspace" },
  { id: "none", label: "None" },
];

/**
 * The sort inside each group.
 * - `status`: the Board order (`sortBoard`): bucket, then the newest status change.
 * - `recent`: the newest status change first, in all buckets.
 * - `name`: A to Z by title.
 * - `longest`: working agents first, the one that works longest at the top; then the Board order.
 */
export type SortBy = "status" | "recent" | "name" | "longest";

export const SORTS: readonly { id: SortBy; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "recent", label: "Recent activity" },
  { id: "name", label: "Name" },
  { id: "longest", label: "Running longest" },
];

export const groupLabel = (g: BoardGroup) => BOARD_GROUPS.find((o) => o.id === g)?.label ?? "Status";
export const sortLabel = (s: SortBy) => SORTS.find((o) => o.id === s)?.label ?? "Status";

const NAME = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * Sorts Board items (already in the Board order from `mergeBoard`). The JS sort is stable, so two
 * items that tie keep their Board order.
 * "Recent activity" uses `since`: the start of the current status (the host's `status_since`, else
 * the app's first sighting). With no `since`, the higher `state_change_seq` comes first, after all
 * items with a time.
 */
export function sortItems(items: BoardItem[], by: SortBy): BoardItem[] {
  switch (by) {
    case "status":
      return items;
    case "recent":
      return [...items].sort((a, b) => {
        if (a.since !== undefined && b.since !== undefined) return b.since - a.since;
        if (a.since !== undefined) return -1;
        if (b.since !== undefined) return 1;
        return b.agent.state_change_seq - a.agent.state_change_seq;
      });
    case "name":
      return [...items].sort((a, b) => NAME.compare(a.title, b.title));
    case "longest": {
      const working = items.filter((i) => i.bucket === "working");
      const rest = items.filter((i) => i.bucket !== "working");
      // The oldest start works longest. An unknown start goes last among the working agents.
      working.sort((a, b) => (a.since ?? Number.POSITIVE_INFINITY) - (b.since ?? Number.POSITIVE_INFINITY));
      return [...working, ...rest];
    }
  }
}

/**
 * Sections in display order. "none" gives one section with no title. Status sections stay in the
 * bucket order; computer and workspace sections follow their first item. Items keep the given order.
 */
export function groupItems(items: BoardItem[], by: BoardGroup): BoardSection[] {
  if (by === "none") return items.length > 0 ? [{ key: "all", title: "", data: items }] : [];
  return groupBoard(items, by);
}

/** True when a group's section headers can collapse: computer and workspace. */
export const collapsible = (by: BoardGroup) => by === "host" || by === "workspace";

/** A Board section with the number of its items, which stays when the section is collapsed. */
export type ShownSection = BoardSection & { count: number; collapsed: boolean };

/** Empties the collapsed sections (their header stays, with the count). */
export function collapseSections(sections: BoardSection[], by: BoardGroup, collapsed: readonly string[]): ShownSection[] {
  const shut = new Set(collapsible(by) ? collapsed : []);
  return sections.map((s) => {
    const c = shut.has(s.key);
    return { ...s, count: s.data.length, collapsed: c, data: c ? [] : s.data };
  });
}

/** Adds a key to the list, or removes it when it is there. */
export function toggleKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}
