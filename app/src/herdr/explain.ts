/**
 * "Why this status?": herdr's own explanation of the status of one agent (`agent.explain`).
 *
 * herdr 0.9 socket API: `agent.explain`, params `{ target }` (`AgentTarget`: a pane id or an agent
 * name) → `{ type: "agent_explain", explain: {...} }`. The explain object is the same as the output
 * of `herdr agent explain --json`. The schema leaves it open, so every field here is optional.
 * Seen fields: `agent`, `state`, `manifest_source`, `manifest_version`, `matched_rule`
 * (`{ id, priority, region, state }` or null), `evaluated_rules` (`[{ id, matched, priority,
 * region, state, evidence: { region_preview } }]`), `fallback_reason`, `skip_state_update`,
 * `skipped_update_reason`, `screen_detection_skipped`, `screen_detection_skip_reason`, `warning`.
 * The app shows them as plain text, never as markdown.
 */
import type { RpcClient } from "@/rpc/RpcClient";

import { callHerdr } from "./support";

type Rpc = Pick<RpcClient, "call">;

export const EXPLAIN_METHOD = "agent.explain";
/** The label of the menu item and the peek sheet action. */
export const EXPLAIN_LABEL = "Why this status?";

type Rule = { id?: string; priority?: number; region?: string; state?: string };
type EvaluatedRule = Rule & { matched?: boolean; evidence?: { region_preview?: string } | null };

/** The fields of the explain object that the app reads. */
export type AgentExplain = {
  agent?: string | null;
  state?: string | null;
  manifest_source?: string | null;
  manifest_version?: string | null;
  matched_rule?: Rule | null;
  evaluated_rules?: EvaluatedRule[] | null;
  fallback_reason?: string | null;
  skip_state_update?: boolean | null;
  skipped_update_reason?: string | null;
  screen_detection_skipped?: boolean | null;
  screen_detection_skip_reason?: string | null;
  warning?: string | null;
};

/** The explain object from an `agent.explain` result (also accepts the bare object). */
export function parseExplain(result: unknown): AgentExplain {
  const r = (result ?? {}) as Record<string, unknown>;
  const e = r.explain && typeof r.explain === "object" ? r.explain : r;
  return e as AgentExplain;
}

export async function explainAgent(rpc: Rpc, hostId: string, paneId: string): Promise<AgentExplain> {
  return parseExplain(await callHerdr(rpc, hostId, EXPLAIN_METHOD, { target: paneId }));
}

const STATE_WORD: Record<string, string> = {
  working: "working",
  blocked: "needs you",
  idle: "idle",
  done: "done",
  unknown: "unknown",
};

/** The status as the app says it. An unknown word stays as herdr sends it. */
export const stateWord = (s: string | null | undefined) => (s ? (STATE_WORD[s] ?? s) : "unknown");

/** One labeled value of the sheet. `mono`: code, a rule id or screen text. */
export type ExplainField = { label: string; value: string; mono?: boolean };

/** What the sheet shows: one summary sentence, the reasons, the fields and the matched rules. */
export type ExplainView = {
  summary: string;
  reasons: string[];
  fields: ExplainField[];
  /** The rules that matched, strongest first. */
  matched: { id: string; detail: string }[];
  /** The screen text that the winning rule read, when herdr sends it. */
  evidence?: string;
  /** True when herdr did not find the status from a rule or a hook. An integration can help. */
  uncertain: boolean;
};

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Turns the explain object into plain lines for the sheet. */
export function explainView(e: AgentExplain): ExplainView {
  const state = stateWord(e.state);
  const rule = e.matched_rule ?? undefined;
  const reasons: string[] = [];
  if (e.screen_detection_skipped) {
    reasons.push(
      `herdr does not read the screen for this agent: ${text(e.screen_detection_skip_reason) ?? "an integration reports the status"}.`,
    );
  }
  if (rule?.id) reasons.push(`The rule "${rule.id}" matched${rule.region ? ` in the region "${rule.region}"` : ""}.`);
  const fallback = text(e.fallback_reason);
  if (fallback) reasons.push(`No rule decided the status. herdr used a fallback: ${fallback}.`);
  if (e.skip_state_update) reasons.push(`herdr kept the last status: ${text(e.skipped_update_reason) ?? "no reason given"}.`);
  const warning = text(e.warning);
  if (warning) reasons.push(`Warning: ${warning}`);
  if (reasons.length === 0) reasons.push("No rule matched the screen of this agent.");

  const fields: ExplainField[] = [];
  const agent = text(e.agent);
  if (agent) fields.push({ label: "Agent", value: agent });
  fields.push({ label: "Status", value: state });
  if (rule?.id) fields.push({ label: "Rule", value: rule.id, mono: true });
  if (rule?.priority !== undefined) fields.push({ label: "Rule priority", value: String(rule.priority) });
  const version = text(e.manifest_version);
  if (version) fields.push({ label: "Rule set version", value: version, mono: true });
  const source = text(e.manifest_source);
  if (source) fields.push({ label: "Rule set", value: source, mono: true });

  const rules = Array.isArray(e.evaluated_rules) ? e.evaluated_rules : [];
  if (rules.length > 0) {
    const hits = rules.filter((r) => r.matched).length;
    fields.push({ label: "Rules checked", value: `${rules.length} (${hits} matched)` });
  }
  const matched = rules
    .filter((r) => r.matched && r.id)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((r) => ({
      id: r.id as string,
      detail: [r.state ? stateWord(r.state) : undefined, r.region, r.priority !== undefined ? `priority ${r.priority}` : undefined]
        .filter(Boolean)
        .join(" · "),
    }));
  const evidence = text(rules.find((r) => r.id && r.id === rule?.id)?.evidence?.region_preview);

  return {
    summary: `herdr shows this agent as ${state}.`,
    reasons,
    fields,
    matched,
    evidence,
    uncertain: !e.screen_detection_skipped && (!rule?.id || e.state === "unknown"),
  };
}
