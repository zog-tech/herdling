/** Agent kinds `agent.start` accepts. No herdr API lists them, so the list is fixed here. */
export const AGENT_KINDS = [
  "claude", "codex", "pi", "gemini", "opencode", "amp", "cursor", "copilot", "droid", "kimi", "qwen", "grok",
  "devin", "agy", "cline", "omp", "mastracode", "kiro", "hermes", "kilo", "qodercli", "letta", "maki", "muse",
] as const;

export const DEFAULT_KIND = "claude";

/** Kinds at the start of the agent picker: the agents with a chat view. The rest follow in `AGENT_KINDS` order. */
export const FEATURED_KINDS = ["claude", "codex", "pi", "opencode", "omp", "gemini"] as const;

/** Product names for the picker and the start button. A kind not here shows as its kind name. */
const LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "Pi",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  amp: "Amp",
  cursor: "Cursor",
  copilot: "Copilot",
  droid: "Droid",
  kimi: "Kimi",
  qwen: "Qwen Code",
  grok: "Grok",
  devin: "Devin",
  cline: "Cline",
  mastracode: "Mastra Code",
  kiro: "Kiro",
  hermes: "Hermes",
  kilo: "Kilo Code",
  qodercli: "Qoder",
  letta: "Letta",
};

export const agentLabel = (kind: string): string => LABELS[kind] ?? kind;

/** Every kind in picker order: `FEATURED_KINDS`, then the others. */
export const PICKER_KINDS: readonly string[] = [
  ...FEATURED_KINDS,
  ...AGENT_KINDS.filter((k) => !(FEATURED_KINDS as readonly string[]).includes(k)),
];
