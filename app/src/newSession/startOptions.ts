/**
 * Start options of New session: the permission mode, the model and extra command line flags of
 * the agent. Pure rules only: the definitions per agent kind, the argument list for `agent.start`,
 * the short summary, the command preview and the choice lists of the option pills. The flags were checked against the real CLIs on
 * 2026-11-04. A kind with no entry here gets extra flags only.
 */

/** One permission mode of an agent. `args` go first on the agent command line. */
export type PermissionMode = {
  id: string;
  label: string;
  /** One short line that tells what the mode lets the agent do (the options sheet). */
  detail: string;
  args: readonly string[];
  /** The agent runs commands and edits files with no approval. */
  danger?: boolean;
};

/** One thinking level choice (Pi). */
export type ThinkingLevel = { id: string; label: string };

/** What New session offers for one agent kind. */
export type KindOptions = {
  /** Empty when the agent has no permission prompts. The first mode is always Default (no flags). */
  modes: readonly PermissionMode[];
  /** The flag that takes a model name, for example `--model`. Undefined: no model field. */
  modelFlag?: string;
  /** The flag that takes a thinking level, and the levels. Undefined: no thinking choice. */
  thinking?: { flag: string; levels: readonly ThinkingLevel[] };
};

/** The choice of the user for one agent kind. Every field is optional: empty means "as the agent starts by default". */
export type StartChoice = {
  /** A mode id of the kind. Unknown or missing: Default. */
  mode?: string;
  model?: string;
  /** A thinking level id. Unknown or missing: no flag. */
  thinking?: string;
  /** Extra flags as typed, split like a shell does (see `splitFlags`). */
  extra?: string;
};

export const DEFAULT_MODE_ID = "default";

/** The Default mode of a kind (no flags). `detail` tells what the agent does with no flag. */
const defaultMode = (detail: string): PermissionMode => ({ id: DEFAULT_MODE_ID, label: "Default", detail, args: [] });

const NO_APPROVAL = "Runs commands and edits files with no approval.";
const EDITS_ONLY = "Edits files without asking. Asks before commands.";

const KINDS: Record<string, KindOptions> = {
  claude: {
    modes: [
      defaultMode("Asks before it edits files or runs commands."),
      { id: "plan", label: "Plan", detail: "Reads and plans. Asks before it changes files.", args: ["--permission-mode", "plan"] },
      { id: "acceptEdits", label: "Accept edits", detail: EDITS_ONLY, args: ["--permission-mode", "acceptEdits"] },
      { id: "auto", label: "Auto", detail: "Decides when to ask.", args: ["--permission-mode", "auto"] },
      { id: "skip", label: "Skip permissions", detail: NO_APPROVAL, args: ["--dangerously-skip-permissions"], danger: true },
    ],
    modelFlag: "--model",
  },
  codex: {
    modes: [
      defaultMode("Uses the sandbox and approval settings of the agent."),
      { id: "readOnly", label: "Read only", detail: "Reads files. Asks before it edits files or runs commands.", args: ["--sandbox", "read-only"] },
      {
        id: "auto",
        label: "Auto",
        detail: "Edits files in the folder. Asks when it needs more access.",
        args: ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"],
      },
      {
        id: "fullAccess",
        label: "Full access",
        detail: "No sandbox. Runs commands and edits files with no approval.",
        args: ["--dangerously-bypass-approvals-and-sandbox"],
        danger: true,
      },
    ],
    modelFlag: "-m",
  },
  gemini: {
    modes: [
      defaultMode("Asks before it edits files or runs commands."),
      { id: "autoEdit", label: "Auto edit", detail: EDITS_ONLY, args: ["--approval-mode", "auto_edit"] },
      { id: "yolo", label: "YOLO", detail: NO_APPROVAL, args: ["--yolo"], danger: true },
    ],
    modelFlag: "-m",
  },
  opencode: {
    modes: [
      defaultMode("Uses the permission settings of the agent."),
      { id: "auto", label: "Auto approve", detail: "Approves every permission request.", args: ["--auto"], danger: true },
    ],
  },
  // Pi has no permission prompts, so it has no modes.
  pi: {
    modes: [],
    modelFlag: "--model",
    thinking: {
      flag: "--thinking",
      levels: [
        { id: "off", label: "Off" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ],
    },
  },
};

const EXTRA_ONLY: KindOptions = { modes: [] };

/** One quick model choice: `id` is the value for the model flag. */
export type ModelAlias = { id: string; label: string };

/** The model aliases that Claude Code accepts for `--model`. Other kinds get only the model name field. */
const MODEL_ALIASES: Record<string, readonly ModelAlias[]> = {
  claude: [
    { id: "opus", label: "Opus" },
    { id: "sonnet", label: "Sonnet" },
    { id: "haiku", label: "Haiku" },
  ],
};

/** The quick model choices of `kind`. Empty: the kind has only the model name field. */
export function modelAliases(kind: string): readonly ModelAlias[] {
  return MODEL_ALIASES[kind] ?? [];
}

/** The model of `choice` as the start bar shows it: an alias label (for example "Opus") or the name as typed. Undefined: no model. */
export function modelLabel(kind: string, choice: StartChoice): string | undefined {
  const model = choice.model?.trim();
  if (!model || !optionsFor(kind).modelFlag) return undefined;
  return modelAliases(kind).find((a) => a.id === model)?.label ?? model;
}

/** True when `choice` starts the agent as it starts with no flags. */
export function isDefaultChoice(kind: string, choice: StartChoice): boolean {
  return buildArgs(kind, choice).length === 0;
}

/** The options of `kind`. A kind with no entry gets extra flags only. */
export function optionsFor(kind: string): KindOptions {
  return KINDS[kind] ?? EXTRA_ONLY;
}

/** The selected mode of `kind`: the chosen one, else Default. Undefined when the kind has no modes. */
export function modeOf(kind: string, choice: StartChoice): PermissionMode | undefined {
  const { modes } = optionsFor(kind);
  return modes.find((m) => m.id === choice.mode) ?? modes[0];
}

/** The selected thinking level of `kind`, or undefined (no flag). */
export function thinkingOf(kind: string, choice: StartChoice): ThinkingLevel | undefined {
  return optionsFor(kind).thinking?.levels.find((l) => l.id === choice.thinking);
}

/**
 * Splits typed flags into arguments, like a shell without expansion: spaces separate, and single
 * or double quotes keep spaces in one argument. An unbalanced quote takes the rest of the text
 * into the same argument; that is simpler to correct than an error that starts nothing.
 */
export function splitFlags(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let started = false;
  let quote: "'" | '"' | undefined;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) out.push(cur);
      cur = "";
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

/** The arguments for `agent.start`: mode, then model, then thinking level, then the extra flags. */
export function buildArgs(kind: string, choice: StartChoice): string[] {
  const opts = optionsFor(kind);
  const args = [...(modeOf(kind, choice)?.args ?? [])];
  const model = choice.model?.trim();
  if (opts.modelFlag && model) args.push(opts.modelFlag, model);
  const level = thinkingOf(kind, choice);
  if (opts.thinking && level) args.push(opts.thinking.flag, level.id);
  if (choice.extra) args.push(...splitFlags(choice.extra));
  return args;
}

/** True when the selected mode runs the agent with no approval. */
export function isDanger(kind: string, choice: StartChoice): boolean {
  return !!modeOf(kind, choice)?.danger;
}

/** A short text of all options, for example "Default" or "Plan · opus". */
export function summary(kind: string, choice: StartChoice): string {
  const parts: string[] = [];
  const mode = modeOf(kind, choice);
  if (mode && mode.id !== DEFAULT_MODE_ID) parts.push(mode.label);
  const opts = optionsFor(kind);
  const model = choice.model?.trim();
  if (opts.modelFlag && model) parts.push(model);
  const level = thinkingOf(kind, choice);
  if (level) parts.push(`Thinking ${level.label.toLowerCase()}`);
  const extra = choice.extra ? splitFlags(choice.extra).length : 0;
  if (extra > 0) parts.push(extra === 1 ? "1 extra flag" : `${extra} extra flags`);
  return parts.length > 0 ? parts.join(" · ") : "Default";
}

/**
 * A stored choice made safe for `kind`: only strings stay, and an unknown mode or thinking level
 * (for example from an older app) falls back to Default.
 */
export function cleanChoice(kind: string, raw: unknown): StartChoice {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
  const opts = optionsFor(kind);
  const mode = str(r.mode);
  const thinking = str(r.thinking);
  const out: StartChoice = {};
  if (mode && opts.modes.some((m) => m.id === mode && m.id !== DEFAULT_MODE_ID)) out.mode = mode;
  const model = str(r.model);
  if (model && opts.modelFlag) out.model = model;
  if (thinking && opts.thinking?.levels.some((l) => l.id === thinking)) out.thinking = thinking;
  const extra = str(r.extra);
  if (extra) out.extra = extra;
  return out;
}

/** The number of extra flags in `choice`. */
export function extraFlagCount(choice: StartChoice): number {
  return choice.extra ? splitFlags(choice.extra).length : 0;
}

/** One argument as a shell shows it: quoted when it is empty or has a space or a quote. */
function shellWord(arg: string): string {
  if (arg !== "" && !/[\s'"]/.test(arg)) return arg;
  return arg.includes("'") ? `"${arg}"` : `'${arg}'`;
}

/**
 * The command line that the options start, for example `claude --permission-mode plan --model opus`.
 * The binary name is the agent kind. Only for display: `agent.start` gets the argument list.
 */
export function commandPreview(kind: string, choice: StartChoice): string {
  return [kind, ...buildArgs(kind, choice)].map(shellWord).join(" ");
}

/**
 * The rows of an action sheet that picks one item: the item labels with a check mark on the
 * current one, then Cancel. `ids[i]` is the id of row `i` (undefined for Cancel). Items with
 * `danger` are the destructive rows.
 */
export type ChoiceMenu = {
  options: string[];
  ids: (string | undefined)[];
  destructiveButtonIndex: number[];
  cancelButtonIndex: number;
};

export const CHECK_MARK = "✓ ";

function choiceMenu(items: readonly { id: string; label: string; danger?: boolean }[], current: string): ChoiceMenu {
  const options = items.map((i) => (i.id === current ? CHECK_MARK + i.label : i.label));
  const destructiveButtonIndex = items.flatMap((i, n) => (i.danger ? [n] : []));
  return {
    options: [...options, "Cancel"],
    ids: [...items.map((i) => i.id), undefined],
    destructiveButtonIndex,
    cancelButtonIndex: items.length,
  };
}

/** The permission mode sheet of `kind`. Undefined when the kind has no modes. */
export function modeMenu(kind: string, choice: StartChoice): ChoiceMenu | undefined {
  const { modes } = optionsFor(kind);
  const mode = modeOf(kind, choice);
  return mode ? choiceMenu(modes, mode.id) : undefined;
}

/** The id of the "agent's default" thinking level in `thinkingMenu`. It sets no flag. */
export const DEFAULT_THINKING_ID = "default";

/** The thinking level sheet of `kind` (Pi), with "Default" first. Undefined when the kind has no levels. */
export function thinkingMenu(kind: string, choice: StartChoice): ChoiceMenu | undefined {
  const t = optionsFor(kind).thinking;
  if (!t) return undefined;
  return choiceMenu([{ id: DEFAULT_THINKING_ID, label: "Default" }, ...t.levels], thinkingOf(kind, choice)?.id ?? DEFAULT_THINKING_ID);
}

/** `choice` with the mode `id`. Default is stored as no mode. */
export function withMode(choice: StartChoice, id: string): StartChoice {
  return { ...choice, mode: id === DEFAULT_MODE_ID ? undefined : id };
}

/** `choice` with the thinking level `id`. Default is stored as no level. */
export function withThinking(choice: StartChoice, id: string): StartChoice {
  return { ...choice, thinking: id === DEFAULT_THINKING_ID ? undefined : id };
}
