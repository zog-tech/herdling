/** Agent kinds `agent.start` accepts. No herdr API lists them, so the list is fixed here. */
export const AGENT_KINDS = [
  "claude", "codex", "pi", "gemini", "opencode", "amp", "cursor", "copilot", "droid", "kimi", "qwen", "grok",
  "devin", "agy", "cline", "omp", "mastracode", "kiro", "hermes", "kilo", "qodercli", "letta", "maki", "muse",
] as const;

export const DEFAULT_KIND = "claude";
/** Kinds shown as large chips; the rest sit under "More". */
export const PRIMARY_KIND_COUNT = 6;
