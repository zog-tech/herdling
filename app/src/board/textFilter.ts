/**
 * The text filter of the Board: keeps the agents whose name, agent kind, terminal title, computer
 * or folder contain every word of the query (any case). Pure, so the Board filters before it sorts
 * and groups, and each bucket keeps its place.
 */
import { agentLabel } from "@/herdr/agentKinds";
import { agentKind } from "@/herdr/names";

import type { BoardItem } from "./buckets";

/** The words of the query, in lower case. No words: no filter. */
export function queryWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** The text that the filter looks in, in lower case. */
export function filterText(item: BoardItem): string {
  const kind = agentKind(item.agent);
  return [
    item.title,
    kind,
    kind ? agentLabel(kind) : "",
    item.terminalTitle ?? "",
    item.agent.terminal_title_stripped ?? "",
    item.hostName,
    item.workspace,
    item.agent.cwd ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

/** True when every word of the query is in the text of the item. */
export function matchesQuery(item: BoardItem, query: string): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  const text = filterText(item);
  return words.every((w) => text.includes(w));
}

/** The items that match the query, in the same order. An empty query keeps the same array. */
export function filterByText(items: BoardItem[], query: string): BoardItem[] {
  if (queryWords(query).length === 0) return items;
  return items.filter((i) => matchesQuery(i, query));
}
