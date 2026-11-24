/**
 * The models of the "Model" item in the session menu of a Claude Code pane. A pick sends
 * `/model <id>` as a prompt. Claude Code switches at once when the conversation is empty. When it
 * has history, Claude Code asks "Switch model?" first; the thread shows that question as a choice
 * menu. Claude Code also saves the pick as the default model for new sessions on that computer.
 *
 * Typed during a turn, `/model` does not wait in the queue: it opens its question over the running
 * turn. Thus the pick is only for an idle or done agent.
 */
import type { AgentStatus } from "@herdling/protocol";

export type ModelChoice = { id: "default" | "opus" | "sonnet" | "haiku"; label: string };

export const MODELS: readonly ModelChoice[] = [
  { id: "default", label: "Default" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];

/** The prompt that switches to `m`. */
export const modelPrompt = (m: ModelChoice) => `/model ${m.id}`;

/** True when the session menu has "Model": only Claude Code has the `/model` command. */
export const hasModelItem = (kind: string | null | undefined) => kind === "claude";

/** True when a pick can go now: the agent waits for input. */
export const canSwitchModel = (status: AgentStatus | undefined) => status === "idle" || status === "done";

/** Why a pick cannot go now. */
export const MODEL_BUSY_MESSAGE = "Wait until the agent is idle. Claude Code changes the model only between turns.";

/**
 * The family pick that matches the model of the agent now (a raw id or a label: "claude-opus-5-5",
 * "Opus 5.5"), for the check in the model menu. Undefined when the model is unknown or of another
 * family. "Default" never gets the check: the app cannot see which model it is.
 */
export function currentModelChoice(model: string | undefined): ModelChoice["id"] | undefined {
  if (!model) return undefined;
  const words = model.toLowerCase().split(/[^a-z]+/);
  return MODELS.find((m) => m.id !== "default" && words.includes(m.id))?.id;
}
