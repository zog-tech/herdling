export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type RpcRequest = { id: number; method: string; params?: unknown };
export type RpcError = { code: string; message: string };
export type RpcResponse = { id: number; result?: unknown; error?: RpcError };
export type RpcEvent = { method: "event"; params: { stream: string; data: unknown } };

export type Hello = {
  host: string;
  os: "macos" | "linux";
  zogsshd: string;
  herdr_ok: boolean;
  herdr_version?: string;
  herdr_protocol?: number;
  /** Method names the host accepts. Missing on an older zogsshd. */
  methods?: string[];
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

/** cursor = byte offset for the older page (null at file start); end = file size at read time, used as thread.follow `from`. */
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

/** Input line of `zogsshd enroll` (password setup). Sent on stdin, never in the command line. */
export type EnrollRequest = {
  device_id: string;
  device_name: string;
  host_id: string;
  public_key: string;
};
/** The one JSON line `zogsshd enroll` prints. Failure `code` is "bad_request" or "io_error". */
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

/** `commands.list` item: one slash command or skill that Claude Code offers in the pane's folder. */
export type CommandInfo = {
  /** Without the leading `/`. Plugin items look like `plugin:name`. */
  name: string;
  description?: string;
  source: "builtin" | "user" | "project" | "plugin";
};
/** `commands.list` result, sorted by name. */
export type CommandList = { commands: CommandInfo[] };

/** `files.put` result: where the host saved the file (`~/.cache/zogsshd/uploads/...`). */
export type FilePut = { path: string };
