import type { BoardItem } from "./buckets";
import { pillText } from "./elapsed";

/** What VoiceOver reads for a card: title, status with elapsed time, host · workspace, the preview line, unread. */
export function cardLabel(item: BoardItem, now: number): string {
  const title = item.agent.terminal_title_stripped || item.agent.agent;
  const parts = [title, pillText(item.bucket, item.since, now), `${item.hostName} · ${item.workspace}`];
  if (item.line) parts.push(item.line);
  if (item.bucket === "ready") parts.push("unread");
  return parts.join(", ");
}

/** VoiceOver actions of a card: the same as tap, long-press and the swipe actions. */
export const CARD_ACTIONS = [
  { name: "activate" },
  { name: "longpress", label: "Peek" },
  { name: "markRead", label: "Mark read" },
  { name: "reply", label: "Reply" },
  { name: "restart", label: "Restart" },
];

type Handlers = {
  onOpen: (item: BoardItem) => void;
  onPeek: (item: BoardItem) => void;
  onMarkRead: (item: BoardItem) => void;
  onReply: (item: BoardItem) => void;
  onRestart: (item: BoardItem) => void;
};

/** Runs the handler of a VoiceOver action. Unknown actions do nothing. */
export function runCardAction(name: string, item: BoardItem, h: Handlers): void {
  const map: Record<string, ((i: BoardItem) => void) | undefined> = {
    activate: h.onOpen,
    longpress: h.onPeek,
    markRead: h.onMarkRead,
    reply: h.onReply,
    restart: h.onRestart,
  };
  map[name]?.(item);
}
