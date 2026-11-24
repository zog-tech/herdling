import { TextSearch } from "lucide-react-native";

import type { MenuSpec } from "@/ui/menuRules";

import { BOARD_GROUPS, groupLabel, sortLabel, SORTS, type BoardGroup, type SortBy } from "./arrange";
import { BUCKETS, BUCKET_LABEL, type Bucket, type Counts } from "./buckets";

/**
 * The list options of the Board (design rule 2, "Filter a list"): one button above the agent list
 * opens one menu with checks. It replaces the status filter chips and the separate group and sort
 * menus. Five status filters and "All" do not fit a `Segmented` on a phone, so they are menu rows.
 *
 * Sections: "Show" (all agents, or one status, with its live count), "Group by" and "Sort by".
 * `onJump` adds a last row "Jump to a terminal" (`app/jump.tsx`). It lives here and not in the
 * header, so the header keeps at most two buttons (design rule 4); the text filter keeps ⌘F.
 * Pure: no I/O.
 */

/** The sum of all buckets: the count of "All agents". */
export function totalCount(counts: Counts): number {
  return BUCKETS.reduce((n, b) => n + counts[b], 0);
}

export function listMenu({
  counts,
  filter,
  groupBy,
  sortBy,
  onFilter,
  onGroup,
  onSort,
  onJump,
}: {
  counts: Counts;
  filter: Bucket | null;
  groupBy: BoardGroup;
  sortBy: SortBy;
  onFilter: (f: Bucket | null) => void;
  onGroup: (g: BoardGroup) => void;
  onSort: (s: SortBy) => void;
  onJump?: () => void;
}): MenuSpec {
  return {
    title: "Agent list",
    sections: [
      {
        title: "Show",
        items: [
          { label: "All agents", value: String(totalCount(counts)), checked: filter === null, onPick: () => onFilter(null) },
          ...BUCKETS.map((b) => ({ label: BUCKET_LABEL[b], value: String(counts[b]), checked: filter === b, onPick: () => onFilter(b) })),
        ],
      },
      { title: "Group by", items: BOARD_GROUPS.map((g) => ({ label: g.label, checked: groupBy === g.id, onPick: () => onGroup(g.id) })) },
      { title: "Sort by", items: SORTS.map((s) => ({ label: s.label, checked: sortBy === s.id, onPick: () => onSort(s.id) })) },
      ...(onJump
        ? [{ items: [{ label: "Jump to a terminal", Icon: TextSearch, detail: "Search every agent and terminal", onPick: onJump }] }]
        : []),
    ],
  };
}

/**
 * The words above the list. With no status filter: "All agents" and the total. With a filter: the
 * status word and its count, so the user always sees that the list is filtered.
 */
export function listTitle(counts: Counts, filter: Bucket | null): { title: string; count: number } {
  return filter === null ? { title: "All agents", count: totalCount(counts) } : { title: BUCKET_LABEL[filter], count: counts[filter] };
}

/** The line under the list title: how the list is grouped and sorted, in words. */
export function arrangeLine(groupBy: BoardGroup, sortBy: SortBy): string {
  const sort = `Sorted by ${sortLabel(sortBy).toLowerCase()}`;
  return groupBy === "none" ? `Not grouped · ${sort}` : `Grouped by ${groupLabel(groupBy).toLowerCase()} · ${sort}`;
}
