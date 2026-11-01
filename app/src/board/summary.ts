import { BUCKETS, type Bucket, type Counts } from "./buckets";

/** What the headline number counts. "quiet": no agent needs anything. */
export type SummaryTone = "needs_you" | "working" | "ready" | "quiet";

export type BoardSummary = {
  /** The large number. */
  value: number;
  /** The words after the number: "need you", "working", "ready", "agents, all quiet". */
  label: string;
  tone: SummaryTone;
  /** The other buckets that are not empty, in Board order: "3 working · 1 ready". All quiet: "2 in background". */
  detail: string;
  /** What VoiceOver reads for the whole summary. */
  spoken: string;
};

const DETAIL_WORD: Record<Bucket, string> = {
  needs_you: "need you",
  ready: "ready",
  working: "working",
  background: "in background",
  idle: "idle",
};

/**
 * The headline at the top of the Board: one large number for the most urgent bucket that is not
 * empty (needs you, then working, then ready). With none of them, the number of agents, all quiet;
 * the detail then names the agents with background work.
 */
export function boardSummary(c: Counts): BoardSummary {
  const total = c.needs_you + c.ready + c.working + c.background + c.idle;
  let tone: SummaryTone;
  let value: number;
  let label: string;
  if (c.needs_you > 0) {
    tone = "needs_you";
    value = c.needs_you;
    label = c.needs_you === 1 ? "needs you" : "need you";
  } else if (c.working > 0) {
    tone = "working";
    value = c.working;
    label = "working";
  } else if (c.ready > 0) {
    tone = "ready";
    value = c.ready;
    label = "ready";
  } else {
    tone = "quiet";
    value = total;
    label = total === 1 ? "agent, all quiet" : "agents, all quiet";
  }
  const shown = (b: Bucket) => (tone === "quiet" ? b === "background" : b !== tone);
  const parts = BUCKETS.filter((b) => shown(b) && c[b] > 0).map((b) => `${c[b]} ${DETAIL_WORD[b]}`);
  const detail = parts.join(" · ");
  const head = tone === "quiet" ? `${value} ${label}` : `${value} ${value === 1 ? "agent" : "agents"} ${label}`;
  return { value, label, tone, detail, spoken: detail ? `${head}. ${parts.join(", ")}.` : `${head}.` };
}
