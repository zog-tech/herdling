import type { AgentStatus, ThreadItem } from "@herdling/protocol";

/** The assistant markdown after the last user item, joined with a blank line. Null when there is none. */
export function replyToSpeak(items: ThreadItem[]): string | null {
  let start = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "user") {
      start = i + 1;
      break;
    }
  }
  const parts: string[] = [];
  for (const it of items.slice(start)) {
    if (it.kind === "assistant" && it.markdown.trim()) parts.push(it.markdown);
  }
  return parts.length ? parts.join("\n\n") : null;
}

/** True when the agent just finished: working to idle or done. */
export function shouldSpeak(prev: AgentStatus | undefined, next: AgentStatus): boolean {
  return prev === "working" && (next === "idle" || next === "done");
}
