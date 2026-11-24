import { CircleHelp, Eye, FolderInput, LayoutGrid, MailOpen, Pencil, Reply, RotateCcw } from "lucide-react-native";

import { EXPLAIN_LABEL } from "@/herdr/explain";
import type { MenuItem, MenuSection, MenuSpec } from "@/ui/menuRules";

/**
 * The menu of one agent (design rule 3): the "⋯" button and the long press of a Board row, and the
 * "⋯" button of the peek sheet. One layout everywhere: the open actions first, then the changes,
 * then help, and Restart last (destructive). An action that the agent or its host cannot do is
 * left out (the caller gives no handler for it).
 *
 * Pure: the caller finds what the agent can do and passes the handlers.
 */
export type AgentMenuInput = {
  /** The agent's title (the sheet title). */
  title: string;
  /** "host · agent" under the title. */
  detail?: string;
  reply?: () => void;
  peek?: () => void;
  openSpace?: () => void;
  /** Only for an unread agent ("ready"). */
  markRead?: () => void;
  /** The rename actions that the host supports, for example "Rename session" and "Rename tab". */
  renames?: readonly { label: string; onPick: () => void }[];
  move?: () => void;
  explain?: () => void;
  restart?: () => void;
};

export function agentMenu(i: AgentMenuInput): MenuSpec {
  const open: MenuItem[] = [];
  if (i.reply) open.push({ label: "Reply", Icon: Reply, onPick: i.reply });
  if (i.peek) open.push({ label: "Peek", Icon: Eye, onPick: i.peek });
  if (i.openSpace) open.push({ label: "Open space", Icon: LayoutGrid, onPick: i.openSpace });

  const change: MenuItem[] = [];
  if (i.markRead) change.push({ label: "Mark read", Icon: MailOpen, onPick: i.markRead });
  for (const r of i.renames ?? []) change.push({ label: r.label, Icon: Pencil, onPick: r.onPick });
  if (i.move) change.push({ label: "Move to space…", Icon: FolderInput, onPick: i.move });

  const help: MenuItem[] = i.explain ? [{ label: EXPLAIN_LABEL, Icon: CircleHelp, onPick: i.explain }] : [];
  const danger: MenuItem[] = i.restart ? [{ label: "Restart", Icon: RotateCcw, destructive: true, onPick: i.restart }] : [];

  const sections: MenuSection[] = [{ items: open }, { items: change }, { items: help }, { items: danger }].filter((s) => s.items.length > 0);
  return { title: i.title, detail: i.detail, sections };
}
