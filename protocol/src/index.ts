export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type RpcRequest = { id: number; method: string; params?: unknown };
export type RpcError = { code: string; message: string };
export type RpcResponse = { id: number; result?: unknown; error?: RpcError };
export type RpcEvent = { method: "event"; params: { stream: string; data: unknown } };

export type Hello = {
  host: string;
  os: "macos" | "linux";
  herdlingd: string;
  herdr_ok: boolean;
  herdr_version?: string;
  herdr_protocol?: number;
  /** Method names the host accepts. Missing on an older herdlingd. */
  methods?: string[];
  /** herdr agent kinds with chat support. Missing on an older herdlingd, which supports only Claude. */
  thread_kinds?: string[];
  /** Agent kinds that `commands.list` answers for. Missing on an older herdlingd, which answers only for Claude. */
  command_kinds?: string[];
  /** When herdlingd starts on this computer. Missing on an older herdlingd. */
  boot?: Boot;
};

/**
 * When herdlingd starts: `hello.boot` and the result of `boot.check`.
 * herdlingd is a user service: it starts when the user logs in, or at boot with automatic login
 * (macOS) or lingering (Linux).
 */
export type Boot = {
  starts_at: "boot" | "login" | "unknown";
  /** A short text that says what to do. */
  how: string;
  /**
   * Why: `linger_on`, `linger_off`, `no_loginctl`, `auto_login_on`, `auto_login_off`,
   * `auto_login_other_user`, `filevault_on`, `no_defaults`. New values can come.
   */
  reason?: string;
  /** The user name that herdlingd runs as. */
  user?: string;
};

/** Pages that `mac.open_settings` can open. Any other value gets `bad_request`. */
export type MacSettingsPane = "users_groups" | "sharing" | "filevault";

/** Params of `mac.open_settings`. */
export type MacOpenSettingsParams = { pane: MacSettingsPane };

/** Result of `mac.open_settings`. */
export type MacOpenSettings = { opened: MacSettingsPane };

/** Params of `update.check`. Without `version` the host reads the latest release. */
export type UpdateCheckParams = { version?: string };

/** Result of `update.check`: the running herdlingd and the newest release for this computer. */
export type UpdateCheck = {
  /** Version of the running herdlingd. */
  current: string;
  /** Version in the release manifest. */
  latest: string;
  /** True when `latest` is newer than `current`. */
  update_available: boolean;
  /** Release notes. Can be empty. */
  notes: string;
  /** Release date, `YYYY-MM-DD`. */
  date?: string;
  /** The release asset target for this computer, for example `aarch64-apple-darwin`. */
  target: string;
};

/** Params of `update.apply`. Without `version` the host installs the latest release. */
export type UpdateApplyParams = { version?: string; allow_downgrade?: boolean };

/** Result of `update.apply`. The running rpc process keeps the old code: reconnect to use the new binary. */
export type UpdateApply = {
  from: string;
  to: string;
  status: "updated" | "up_to_date";
  /** False when no service is installed, or when the restart command failed. */
  service_restarted: boolean;
};

export type ThreadItem =
  | { kind: "user"; id: string; ts: number; text: string; images?: number }
  | { kind: "assistant"; id: string; ts: number; markdown: string }
  | { kind: "thinking"; id: string; ts: number; text: string | null }
  | {
      kind: "tool";
      id: string;
      ts: number;
      name: string;
      input_summary: string;
      input: unknown;
      /** `ts`: unix ms of the result line. A host before this field does not send it. */
      result?: { ok: boolean; text: string; truncated: boolean; ts?: number };
    }
  | {
      kind: "subagent";
      id: string;
      ts: number;
      agent_id: string;
      description: string;
      /** "running", "done", "completed", "error", "stopped" (no write for a long time), … */
      status: string;
      /** Only a real final result. A host before live subagents can send the launch text here. */
      result_summary?: string;
      /** Live fields. A host before live subagents does not send them. Times are unix ms. */
      started_at?: number;
      finished_at?: number;
      /** While running: its latest step, such as "Read parse.rs". Max 80 chars. */
      activity?: string;
      tool_count?: number;
      model?: string;
      agent_type?: string;
    }
  | { kind: "system"; id: string; ts: number; text: string };

/**
 * cursor = byte offset for the older page (null at file start); end = file size at read time, used as thread.follow `from`.
 * OpenCode logs use message `seq` values, and Gemini CLI logs use item indexes, for `cursor` and `before`. The app passes them back as they are.
 */
export type ThreadPage = { items: ThreadItem[]; cursor: number | null; end: number };
/** `thread.subagent` result: a page plus the subagent transcript path (the `thread.follow` log). */
export type SubagentPage = ThreadPage & {
  log_path: string;
  /** True while the subagent runs, false when it stopped. Missing when the host does not know. */
  running?: boolean;
};
export type ThreadRef = { kind: string; session: string | null; log_path: string | null; cwd: string | null };
export type RecentSession = { session: string; first_prompt: string; last_activity: number; cwd: string };

export type PushPrefs = { finished: boolean; needs_you: boolean; quiet_at_desk: boolean };
export type PushRegister = {
  device_id: string;
  host_id: string;
  name: string;
  expo_token: string | null;
  prefs: PushPrefs;
};

export type PairRequest = {
  code: string;
  device_id: string;
  device_name: string;
  host_id: string;
  public_key: string;
  expo_token: string | null;
};
export type PairResponse = {
  host_name: string;
  user: string;
  ssh_port: number;
  host_key_fingerprint: string | null;
};

/** Input line of `herdlingd enroll` (password setup). Sent on stdin, never in the command line. */
export type EnrollRequest = {
  device_id: string;
  device_name: string;
  host_id: string;
  public_key: string;
};
/** The one JSON line `herdlingd enroll` prints. Failure `code` is "bad_request" or "io_error". */
export type EnrollResult =
  | { ok: true; host_fingerprint: string | null; hostname: string }
  | { ok: false; code: string; message: string };

/** `stats.get`: host load. Memory in bytes; `mem_used = total - available`. */
export type Stats = { cpu_pct: number; mem_used: number; mem_total: number; load: [number, number, number]; uptime_s: number };

/** `usage.get`: plan usage of the CLIs on a host. `resets_at` is unix seconds. */
export type UsageWindow = { label: string; used_pct: number; resets_at: number | null };
export type ProviderUsage = {
  provider: "claude" | "codex";
  status: "ok" | "not_logged_in" | "unavailable";
  error?: string;
  windows: UsageWindow[];
};
/** Always both providers, Claude first. */
export type Usage = { providers: ProviderUsage[] };

/** `summary.make` result. */
export type Summary = { summary: string };

/** `tts.make` result: audio bytes as base64 (WAV, MP3 or Ogg) and their mime type. */
export type TtsAudio = { audio_b64: string; mime: "audio/wav" | "audio/mpeg" | "audio/ogg" };

/** `stt.make` result: the text of a recording, trimmed. */
export type SttText = { text: string };

/** `automations.list` item (companion adapter for `herdr-automate`). `content_hash` is what `automations.approve` must echo. */
export type Automation = {
  id: string;
  name: string;
  schedule?: string;
  enabled: boolean;
  pending_approval: boolean;
  plan?: string;
  caps?: string[];
  content_hash?: string;
};
/** `automations.runs` item. Times are unix seconds. */
export type AutomationRun = {
  id: string;
  automation_id: string;
  started_at: number;
  finished_at: number | null;
  status: "running" | "ok" | "failed" | "pending_approval";
  summary?: string;
};

/** `agents.preview` item: one short line per agent for the Agent Board. */
export type AgentPreview = {
  pane_id: string;
  /** While working: "Running pnpm test", "Editing auth.ts", "Thinking". */
  activity?: string;
  /** First ~140 chars of the last assistant text, markdown stripped, one line. */
  last_reply?: string;
  /** While blocked: the permission question ("Allow git push?"). */
  question?: string;
  /** Unix seconds when the current herdr status began; null when unknown. */
  status_since?: number | null;
  source: "log" | "screen";
};

/** `commands.list` item: one command or skill that Claude Code, Codex, Pi or OpenCode offers in the pane's folder. */
export type CommandInfo = {
  /** Without the leading `/` or `$`. Plugin items look like `plugin:name`. */
  name: string;
  /** The character that starts the item in the prompt. Missing means `/`. Codex skills use `$`. OpenCode skills use `@`. */
  trigger?: "/" | "$" | "@";
  description?: string;
  source: "builtin" | "user" | "project" | "plugin";
};
/** `commands.list` result, sorted by name. */
export type CommandList = { commands: CommandInfo[] };

/** `files.put` result: where the host saved the file (`~/.cache/herdling/uploads/...`). Any file type, at most 25 MiB (10 MiB on an older herdlingd). */
export type FilePut = { path: string };

/** Params of `git.status`: a folder, or a pane whose folder herdr reports. */
export type GitStatusParams = { cwd: string } | { pane_id: string };

/** One changed file in `git.status`. */
export type GitChangedFile = {
  /** Path from the repo root, with `/`. */
  path: string;
  /** The old path of a renamed or copied file. */
  orig_path?: string;
  /** `M` changed, `A` added, `D` deleted, `R` renamed, `C` copied, `U` conflict, `?` untracked. */
  status: string;
  /** The index has changes of this file. */
  staged: boolean;
  /** The work tree has changes of this file that are not in the index. */
  unstaged: boolean;
  /** Lines added and deleted, staged and unstaged together. Null when unknown (binary or too large). */
  added: number | null;
  deleted: number | null;
  binary: boolean;
};

/** Result of `git.status`. When `is_repo` is false, the other fields are empty. */
export type GitStatus = {
  is_repo: boolean;
  /** The root of the work tree. */
  root?: string;
  /** Null when HEAD is detached or the folder is not a repo. */
  branch: string | null;
  /** Short commit id of HEAD. Null before the first commit. */
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** At most 1000 files. */
  files: GitChangedFile[];
  /** True when there were more changed files than the list holds. */
  truncated: boolean;
};

/**
 * Params of `git.diff`. `path` limits the diff to one file (relative to the repo root).
 * `staged`: true gives the index against HEAD, false the work tree against the index, missing both.
 */
export type GitDiffParams = ({ cwd: string } | { pane_id: string }) & { path?: string; staged?: boolean };

/** Result of `git.diff`: unified diff text, at most 512 KiB. A binary file is one `Binary files ... differ` line. */
export type GitDiff = { diff: string; truncated: boolean; root: string };

/** Params of `git.worktree_add`: the repo folder (or a pane in it) and the new branch name. */
export type GitWorktreeAddParams = ({ cwd: string } | { pane_id: string }) & { branch: string };

/** Result of `git.worktree_add`: the new worktree folder, `<root>/.worktrees/<branch with "/" as "-">`. */
export type GitWorktree = { path: string; branch: string; root: string };
