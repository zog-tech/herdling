/**
 * herdr 0.9 answers of the demo host: the agent integrations (`integration.list`,
 * `integration.install`) and "Why this status?" (`agent.explain`). The shapes follow
 * `herdr api schema --json`. No file changes: an install only changes the state in memory.
 */
import type { AgentInfo } from "@/herdr/snapshot";

import { DemoError } from "./scenario";

type DemoIntegration = { target: string; label: string; command: string; available: boolean; state: "not_installed" | "current" | "outdated" };

/** Where a real herdr puts the hook of each demo target, for the install message. */
const HOOK_PATH: Record<string, string> = {
  claude: "~/.claude/hooks/herdr-agent-state.sh",
  codex: "~/.codex/herdr-agent-state.sh",
  opencode: "~/.config/opencode/plugins/herdr-agent-state.js",
  pi: "~/.pi/agent/extensions/herdr-agent-state.ts",
  cursor: "~/.cursor/herdr-agent-state.sh",
};

export class DemoIntegrations {
  private list: DemoIntegration[] = [
    { target: "claude", label: "Claude Code", command: "claude", available: true, state: "current" },
    { target: "codex", label: "Codex", command: "codex", available: true, state: "not_installed" },
    { target: "opencode", label: "OpenCode", command: "opencode", available: true, state: "outdated" },
    { target: "pi", label: "Pi", command: "pi", available: false, state: "not_installed" },
    { target: "cursor", label: "Cursor", command: "cursor-agent", available: false, state: "not_installed" },
  ];

  /** `integration.list` → `{ type: "integration_list", integrations }`. */
  listResult() {
    return { type: "integration_list", integrations: this.list.map((i) => ({ ...i })) };
  }

  /** `integration.install` → `{ type: "integration_install", target, details: { messages } }`. */
  install(target: string) {
    const item = this.list.find((i) => i.target === target);
    if (!item) throw new DemoError("invalid_request", `unknown variant \`${target}\``);
    if (!item.available && item.state !== "outdated") {
      throw new DemoError("integration_install_failed", `${item.label} is not installed on this computer`);
    }
    item.state = "current";
    const path = HOOK_PATH[target] ?? `~/.${target}/herdr-agent-state.sh`;
    return {
      type: "integration_install",
      target,
      details: { messages: [`Demo: no file changed. A real install writes ${path}.`] },
    };
  }
}

/** Rules of the demo rule set, as herdr's Claude rule set names them. */
const RULES = [
  { id: "osc_title_working", state: "working", region: "osc_title", preview: "◐ Claude Code", priority: 1100 },
  { id: "live_prompt_box", state: "idle", region: "prompt_box_body", preview: "❯", priority: 950 },
  { id: "bash_permission_prompt", state: "blocked", region: "whole_recent", preview: "Do you want to proceed?\n❯ 1. Yes\n  2. No", priority: 850 },
];

/** `agent.explain` for a demo agent → `{ type: "agent_explain", explain }`. A done agent shows the idle prompt. */
export function demoExplain(agent: AgentInfo | undefined, target: string) {
  if (!agent) throw new DemoError("agent_not_found", `agent ${target} not found`);
  const kind = agent.agent ?? "unknown";
  const want = agent.agent_status === "done" ? "idle" : agent.agent_status;
  const rule = RULES.find((r) => r.state === want);
  const evaluated = RULES.map((r) => ({
    id: r.id,
    matched: r === rule,
    priority: r.priority,
    region: r.region,
    state: r.state,
    evidence: { region_preview: r.preview },
  }));
  return {
    type: "agent_explain",
    explain: {
      agent: kind,
      state: agent.agent_status,
      manifest_source: `remote:/home/demo/.local/state/herdr/agent-detection/remote/${kind}.toml`,
      manifest_version: "2026.10.11.1",
      matched_rule: rule ? { id: rule.id, priority: rule.priority, region: rule.region, state: agent.agent_status } : null,
      evaluated_rules: evaluated,
      fallback_reason: rule ? null : "no rule matched; the last known state stays",
      skip_state_update: false,
      skipped_update_reason: null,
      screen_detection_skipped: false,
      warning: null,
    },
  };
}
