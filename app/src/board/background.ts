import type { AgentBackground } from "@herdling/protocol";

/** True when the companion reports background work that still runs. */
export function hasBackground(b: AgentBackground | undefined): b is AgentBackground {
  return !!b && (b.count > 0 || (b.agents ?? 0) > 0);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "1 shell running", "2 shells running", "1 subagent running", "1 shell and 2 subagents running". */
export function backgroundText(b: AgentBackground | undefined): string | undefined {
  if (!hasBackground(b)) return undefined;
  const parts: string[] = [];
  if (b.count > 0) parts.push(plural(b.count, "shell"));
  if ((b.agents ?? 0) > 0) parts.push(plural(b.agents ?? 0, "subagent"));
  return `${parts.join(" and ")} running`;
}

/** The Board line: the text plus the shell commands when known, "1 shell running: npm run dev". */
export function backgroundLine(b: AgentBackground | undefined): string | undefined {
  const text = backgroundText(b);
  if (!text) return undefined;
  const commands = (b?.commands ?? []).filter((c) => c.trim().length > 0);
  return commands.length > 0 ? `${text}: ${commands.join(", ")}` : text;
}
