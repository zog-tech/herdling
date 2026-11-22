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
  /**
   * The `pane.watch` formats the host accepts. `vt` is the raw terminal stream for an emulator in
   * the app. Missing on an older herdlingd (only `text` and `ansi`).
   */
  watch_formats?: string[];
  /**
   * The herdr backends that herdlingd reaches. Missing on an older herdlingd.
   * `herdr_ok` keeps its meaning: it tells only about herdr 1.
   */
  backends?: Backends;
  /**
   * When no Herdr 2 core answers (herdlingd 0.2.0 and later): what herdlingd does about it.
   * `installing`: it installs the pinned core now. `failed`: the last install failed. `missing`:
   * no core is installed. `message` is the text for the user. Missing when all is well.
   */
  core_setup?: CoreSetup;
};

/** `hello.core_setup`. */
export type CoreSetup = { state: "installing" | "failed" | "missing" | (string & {}); message: string };

/** herdr 1: the herdr app with its JSON socket API. */
export type HerdrBackend = { version?: string; protocol?: number };

/** Herdr 2 (herdr-core): the terminal core. `generation` is the protocol generation of the core (1 now). */
export type CoreBackend = { version: string; generation: number };

/** `hello.backends`: each field is present only when herdlingd reaches that backend. */
export type Backends = { herdr?: HerdrBackend; core?: CoreBackend };

/**
 * The backend of a snapshot entry. herdr 1 entries have no `backend` field.
 * Herdr 2 entries have `backend: "core"` and ids that start with `hc:`.
 */
export type SnapshotBackend = "core";

/** Where the group name of a Herdr 2 terminal comes from (`docs/protocol.md`, "Placement"). */
export type GroupSource = "space" | "label" | "repo" | "folder";

/**
 * The optional group and task fields of a Herdr 2 agent or pane entry. An older herdlingd, and
 * herdr 1, send none of them.
 */
export type GroupFields = {
  /** The name of the group of the terminal (a Herdr app space or a fallback group). */
  group?: string | null;
  group_source?: GroupSource | null;
  /** The name of the git repo, when the folder is in one. */
  repo?: string | null;
  /** The root folder of the repo. */
  repo_root?: string | null;
  /** The branch of the repo, when it has one. */
  branch?: string | null;
  /** The pane id of the parent terminal of a helper (`hc:<address>`). */
  parent_id?: string | null;
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
  /** What the update does with herdr-core first. Missing from an older herdlingd. */
  core?: UpdateCore;
};

/**
 * The herdr 1 guard in `update.check`. When the release needs herdr-core and the computer has
 * none, `update.apply` installs the core first. When that fails, the update stops and the old
 * herdlingd stays. Show `notice` before the update.
 */
export type UpdateCore = {
  /** True when the release needs herdr-core. */
  requires_core: boolean;
  /** True when a `herdr-core` is on the computer. */
  installed: boolean;
  /** True when herdr 1 (`herdr`) is on the computer. */
  herdr1: boolean;
  /** True when the update installs herdr-core before it replaces herdlingd. */
  install_first: boolean;
  /** The herdr-core version that the update installs. */
  pinned: string;
  /** Text for the user before the update. */
  notice?: string;
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
  /** The herdr-core step, when the release needs the core. Error `core_install_failed` when it fails. */
  core?: CoreInstall;
  /** Text for the user, for example that herdr 1 sessions do not show any more. */
  notice?: string;
};

/**
 * Result of `herdr.update` (no params). herdlingd runs `herdr update --handoff` on the computer.
 * `from` and `to` come from `herdr --version` before and after; each is missing when herdr gave no version.
 */
export type HerdrUpdate = {
  from?: string | null;
  to?: string | null;
  status: "updated" | "up_to_date";
  /** "complete": the panes moved to the new herdr server. "failed" or "none": herdlingd cannot tell that they did. */
  handoff: "complete" | "failed" | "none";
  /** The output of `herdr update`, at most the last 16 KiB. */
  output: string;
};

/**
 * Result of `core.status` (no params): herdr-core (Herdr 2) on the computer. Only reads.
 * Check `hello.methods` for `core.status` first.
 */
export type CoreStatus = {
  /** True when a `herdr-core` is on the computer. */
  found: boolean;
  /** Version of the installed `herdr-core`. Null when none is found or it gave no version. */
  installed?: string | null;
  /** True when a package manager owns the core (not in `~/.local/bin`). herdlingd never replaces it. */
  managed: boolean;
  /** True when a core answers on its socket. */
  running: boolean;
  /** Version of the running core, when it says one. */
  running_version?: string | null;
  /** The herdr-core version that this herdlingd installs. */
  pinned: string;
  /** True when the installed or running core is newer than the pin. herdlingd keeps it. */
  newer_than_pin: boolean;
  /** True when `core.install` would install or update the core. */
  update_available: boolean;
  /** True when this herdlingd needs the core to work. */
  required: boolean;
  /** Upstream build target, for example `macos-aarch64`. Null: no build for this computer. */
  target?: string | null;
  /** True when herdr 1 (`herdr`) is on the computer. */
  herdr1: boolean;
};

/**
 * Result of `core.install` (no params): installs the pinned herdr-core when it is missing, updates
 * herdlingd's own core when it is older (never down), and makes sure that the core runs.
 * Errors: `unsupported_target`, `download_failed`, `checksum_mismatch`, `install_failed`,
 * `core_not_running`, `busy`.
 */
export type CoreInstall = {
  from?: string | null;
  to?: string | null;
  status: "installed" | "updated" | "up_to_date" | "kept_newer" | "kept_unknown" | "kept_managed";
  /** True when herdlingd started the core. */
  started: boolean;
  pinned: string;
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

/**
 * `fs.dirs` params. `hidden` and `recent` are new in herdlingd 0.1.1; an older herdlingd ignores
 * them (no hidden folders, always `recent_cwds`).
 */
export type FsDirsParams = { path?: string; hidden?: boolean; recent?: boolean };
/** `fs.dirs` result: the canonical folder, its sub-folders and the recent agent folders. */
export type FsDirs = {
  path: string;
  dirs: string[];
  /** Empty when the call had `recent: false`. */
  recent_cwds: string[];
  /** Names in `dirs` that have a `.git` (a repo or worktree root). Missing on herdlingd 0.1.0. */
  git_dirs?: string[];
  /** Echo of the `hidden` param. Missing on herdlingd 0.1.0, which cannot list hidden folders. */
  hidden?: boolean;
};

/**
 * `agents.installed` result: the herdr agent kinds with a program on the computer, and the ones
 * without. A kind in neither list has no known program name.
 */
export type AgentsInstalled = { installed: string[]; missing: string[] };

export type PushPrefs = {
  finished: boolean;
  needs_you: boolean;
  quiet_at_desk: boolean;
  /**
   * One notification per agent: a new push replaces the old one of the same pane (`collapseId`, `tag`).
   * Missing: herdlingd keeps the saved value, else true. An older herdlingd ignores it.
   */
  replace?: boolean;
  /** Group the notifications of one computer (iOS `threadId`). Missing: as `replace`. */
  group?: boolean;
  /** A "finished" push has no sound and no banner (iOS `interruptionLevel: passive`). Missing: as `replace`. */
  quiet_finished?: boolean;
};
export type PushRegister = {
  device_id: string;
  host_id: string;
  name: string;
  expo_token: string | null;
  prefs: PushPrefs;
  /**
   * Push features this app can show. `"choice_actions"`: Yes and No buttons on a "needs you" push.
   * Send it only to a host whose `hello.methods` has `pane.answer`. Missing means none.
   */
  capabilities?: string[];
};

/** Known push capabilities. `choice_actions`: the app shows the Yes and No buttons of the `herdling_choice` category. */
export type PushCapability = "choice_actions";

/** One option of a push's `data.choice`. `label` has at most 60 characters. */
export type PushChoiceOption = { key: string; label: string };

/**
 * `data` of a push. `choice` is on a "needs you" push with `categoryId: "herdling_choice"`, only for
 * a device that registered `"choice_actions"`. It has the first ("Yes…") and the last ("No…") option, no question text.
 * `question` is a short digest of the question (16 hex characters, not the text), from a newer herdlingd.
 */
export type PushData = {
  hostId: string;
  paneId: string;
  choice?: { yes: PushChoiceOption; no: PushChoiceOption; revision: number; question?: string };
};

/**
 * Params of `pane.answer`: answers a permission menu with `key` when the option still has `expect_label`.
 * `expect_question` is the `choice.question` of the push: when set, the question must also be the same.
 * An older herdlingd ignores it.
 */
export type PaneAnswerParams = { pane_id: string; key: string; expect_label: string; expect_question?: string };

/** Result of `pane.answer`. A changed or gone menu gives the error code `stale`, and no key is sent. */
export type PaneAnswer = { answered: true };

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

/**
 * Pairing v2 (CPace, see `docs/protocol.md`). Binary values are lower-case hex.
 * `POST /pair/v2/start` body: `sid` is the phone's 16-byte nonce, `ya` its CPace message (32 bytes).
 */
export type PairV2StartRequest = { device_id: string; sid: string; ya: string };
/** `POST /pair/v2/start` answer: `session` is the host's 16-byte session id (the CPace ADb), `yb` its message. */
export type PairV2StartResponse = { session: string; yb: string };
/** `POST /pair/v2/finish` body. `tag_a` is the phone's HMAC-SHA-512 tag (64 bytes). */
export type PairV2FinishRequest = {
  session: string;
  device_name: string;
  host_id: string;
  public_key: string;
  tag_a: string;
};
/** `POST /pair/v2/finish` answer: the `PairResponse` fields and the host's tag `tag_b` (64 bytes). */
export type PairV2FinishResponse = PairResponse & { tag_b: string };

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
  /**
   * Background work that still runs (a herdlingd newer than 0.1.2, Claude Code only). Missing when
   * nothing runs, or on an older herdlingd. The app shows an idle agent with it as "Background".
   */
  background?: AgentBackground;
};

/** Shells and subagents that keep running after the agent's turn ended. */
export type AgentBackground = {
  /** Running background shells. */
  count: number;
  /** Commands of the running shells, newest first, one line each (at most 3, 40 chars each). */
  commands?: string[];
  /** Running background subagents. Missing means 0. */
  agents?: number;
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

/**
 * Params of `files.get`. `path` is absolute, `~/…`, or relative to `cwd` (else to the folder of
 * `pane_id`). `hidden` lists hidden entries of a folder. `offset` asks for the next part of an image.
 */
export type FileGetParams = { path: string; cwd?: string; pane_id?: string; hidden?: boolean; offset?: number };

/** One entry of a folder in `files.get`. `kind` comes from the name: herdlingd does not read the file. */
export type FileEntry = { name: string; kind: "dir" | "image" | "file"; size?: number };

/** `files.get` result for a folder: folders first, then files. At most 1000 entries. */
export type FileDir = { path: string; name: string; kind: "dir"; entries: FileEntry[]; truncated: boolean; hidden: boolean };

/**
 * `files.get` result for an image. At most 384 KiB of bytes per call, from `offset`; `eof` is true
 * for the last part. Each part except the last is a multiple of 3 bytes, so the base64 parts join as text. An image larger than 20 MiB has `too_large: true` and no bytes.
 */
export type FileImage = {
  path: string;
  name: string;
  kind: "image";
  size: number;
  mime: string;
  too_large?: boolean;
  offset?: number;
  data_b64?: string;
  eof?: boolean;
};

/** `files.get` result for a text file: the first 256 KiB of text. */
export type FileText = { path: string; name: string; kind: "text"; size: number; text: string; truncated: boolean };

/** `files.get` result for a file that the viewer does not show. `mime` when herdlingd knows the type. */
export type FileOther = { path: string; name: string; kind: "other"; size: number; mime?: string };

/** `files.get` result. A missing path is the error `not_found`. */
export type FileGet = FileDir | FileImage | FileText | FileOther;

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
export type GitWorktreeAddParams = ({ cwd: string } | { pane_id: string }) & {
  branch: string;
  /** `"core"`: open the worktree in a new Herdr 2 space. Then `via` is `"herdr"` and the ids are core ids. */
  backend?: "core";
};

/**
 * Result of `git.worktree_add`: the new worktree folder, `<root>/.worktrees/<branch with "/" as "-">`.
 * A newer herdlingd makes the worktree with herdr `worktree.create` when herdr has it. Then `via` is
 * `"herdr"`, and herdr opened the worktree as a new workspace: `workspace_id`, `tab_id` and its root
 * pane `pane_id`. With `via: "git"` or an older herdlingd, these fields are missing.
 */
export type GitWorktree = {
  path: string;
  branch: string;
  root: string;
  via?: "herdr" | "git";
  workspace_id?: string;
  tab_id?: string;
  pane_id?: string;
};

/** `pane.watch` params. herdlingd clamps `interval_ms` to 50–1000 (default 80) and `lines` to 1–1000 (default 200). */
export type PaneWatchParams = {
  pane_id: string;
  lines?: number;
  /** `vt`: the raw terminal stream (`PaneWatchVtEvent`). Only when `hello.watch_formats` has it. */
  format?: "text" | "ansi" | "vt";
  interval_ms?: number;
  /**
   * The phone grid. With both, a Herdr 2 pane is laid out at this size while the stream lives
   * (the computer pane gets this size too). Clamped to 20–500 columns and 5–200 rows. herdr 1
   * panes and older herdlingd ignore them.
   */
  cols?: number;
  rows?: number;
};
/** `pane.watch` result. `drive` is true when the stream drives the size of a Herdr 2 pane. */
export type PaneWatchResult = { stream: string; drive?: boolean; format?: "vt" };
/**
 * `pane.watch` event data. A screen comes first at once, then only when the screen changes.
 * `error` (a herdr error code, for example `pane_not_found`) or `closed` (herdr stopped) ends the stream.
 */
export type PaneWatchEvent =
  | { revision: number; text: string; truncated: boolean }
  | { error: string; message?: string }
  | { closed: true };

/**
 * `pane.watch` event data with `format: "vt"`. `reset`: a new attach; make a fresh emulator of
 * this size (the paint of the screen and the history follows as `data`). `data`: raw bytes in
 * standard base64. `resize`: the terminal size changed (a paint follows). `seq` counts the events
 * of one `gen` from 0. `error` and `closed` end the stream.
 */
export type PaneWatchVtEvent =
  | { vt: "reset"; gen: number; seq: number; cols: number; rows: number }
  | { vt: "data"; gen: number; seq: number; data: string }
  | { vt: "resize"; gen: number; seq: number; cols: number; rows: number }
  | { error: string; message?: string }
  | { closed: true };

/** `ports.list` params. With `pane_id`, the ports of that pane's processes come first and carry its id. */
export type PortsListParams = { pane_id?: string };
/** One TCP port that a process of the host user listens on, on loopback or on all addresses. */
export type PortInfo = {
  port: number;
  /** The listen address: `127.0.0.1`, `::1`, `0.0.0.0` or `::`. */
  addr: string;
  pid?: number;
  /** The process name, for example `node`. */
  process?: string;
  /** A short program name, for example `vite`. */
  cmd?: string;
  /** Set when the process descends from the shell of the asked pane. */
  pane_id?: string;
};
/** `ports.list` result. The pairing port of herdlingd is never in it. */
export type PortsList = { ports: PortInfo[] };

/** `preview.open` params: a port that `ports.list` shows. */
export type PreviewOpenParams = { port: number };
/**
 * `preview.open` result. The grant lets the proxy channel (`herdlingd proxy <port> <grant>`) connect
 * to the port on loopback. It expires 30 minutes after the last proxy connection (`expires_at`, Unix seconds).
 */
export type PreviewOpen = { grant: string; port: number; expires_at: number };
/** `preview.close` params and result. `closed` is false when the grant was not live. */
export type PreviewCloseParams = { grant: string };
export type PreviewClose = { closed: boolean };

/** The platform of a mirror device. */
export type DevicePlatform = "ios" | "android";
/** `simulator`: an iOS simulator. `emulator`: an Android emulator. `device`: a real Android device (not offered). */
export type DeviceKind = "simulator" | "emulator" | "device";
/** One item of `devices.list`: a booted iOS simulator or an Android device of the computer. */
export type MirrorDevice = {
  /** `ios:<udid>` or `android:<serial>`. */
  id: string;
  platform: DevicePlatform;
  kind: DeviceKind;
  name: string;
  /** For example `iOS 26.5` or `Android 15`. */
  os?: string;
  /** The simulator type (`iPhone-17`) or the AVD name. */
  model?: string;
  /** True when the mirror can try video; else it uses screenshots. */
  video: boolean;
  /** True when the mirror can send taps, text and keys. */
  input: boolean;
  /** True when this rpc process runs a mirror of the device. */
  mirroring?: boolean;
};
/** `devices.list` result. `tools` says which programs herdlingd found; `scrcpy` is the pinned scrcpy server version. */
export type DevicesList = {
  devices: MirrorDevice[];
  /** `sim_video` (herdlingd 0.2.1): the `sim-video` tool of idb 1.7.8 and later, for the iOS video. */
  tools: { xcrun: boolean; idb: boolean; idb_companion?: boolean; sim_video?: boolean; adb: boolean };
  scrcpy?: string;
};
/** `mirror.start` params. `allow_device` is needed for a real device; `max_size` (320–4096) caps the Android video edge. */
export type MirrorStartParams = { device: string; allow_device?: boolean; max_size?: number };
/**
 * `mirror.start` result. The mirror server listens on `127.0.0.1:<port>`; the page is at `path`
 * (`/m/<token>/`). `grant` is a preview grant for the port, as from `preview.open`.
 */
export type MirrorStart = {
  device: string;
  platform: DevicePlatform;
  name: string;
  port: number;
  path: string;
  grant: string;
  expires_at: number;
  source: "video" | "screenshots";
  input: boolean;
};
/** `mirror.stop` params and result. `stopped` is false when no mirror of the device ran. */
export type MirrorStopParams = { device: string };
export type MirrorStop = { stopped: boolean };

/**
 * `shell.watch` params. herdlingd sends one push when the command in the shell pane finishes
 * (the foreground goes from another process back to the shell). With `device_id`, only that
 * device gets the push. A new watch of the same pane replaces the old one.
 */
export type ShellWatchParams = { pane_id: string; device_id?: string };
/** One watch. `busy` is true when herdlingd saw the command run. `since` and `expires_at` are Unix seconds (24 h apart). */
export type ShellWatch = { pane_id: string; since: number; expires_at: number; busy: boolean };
/** `shell.unwatch` params and result. `removed` is false when the pane had no watch. */
export type ShellUnwatchParams = { pane_id: string };
export type ShellUnwatch = { removed: boolean };
/** `shell.watches` result: the live watches of the computer. */
export type ShellWatches = { watches: ShellWatch[] };

/**
 * One group of Herdr 2 (herdr-core) terminals in `groups.list`: a Herdr app space or a fallback
 * group. `workspace_id` is the id of the group in the snapshot (`hc:space:<id>` or `hc:g:<key>`).
 * `space_id` is set for a space. `terminals` counts every terminal, `agents` only the agents.
 */
export type CoreGroup = {
  workspace_id: string;
  label: string;
  source: GroupSource;
  space_id?: string;
  terminals: number;
  agents: number;
  agent_status: AgentStatus;
};
/** `groups.list` result. The host must reach a Herdr 2 core, else the error is `unsupported`. */
export type GroupsList = { groups: CoreGroup[] };

/**
 * `pane.move` params: a Herdr 2 terminal that is in no Herdr app space, and exactly one target.
 * `workspace_id` is a space (`hc:space:<id>`) or a label group (`hc:g:<key>`); `new_space: true`
 * makes a new space; `group` sets the `herdling.group` label (an empty string removes it).
 */
export type PaneMoveParams = { pane_id: string } & ({ workspace_id: string } | { new_space: true } | { group: string });
/** `pane.move` result: where the terminal shows now. The ids are null when the snapshot does not hold it. */
export type PaneMove = { pane_id: string; workspace_id: string | null; tab_id: string | null };

/**
 * `agent.mark_seen` params: the user saw turn `turn` of the Herdr 2 agent `pane_id`. herdlingd
 * keeps it in the `herdling.seen` label of the terminal. The label only grows, and never passes
 * the current turn of the terminal.
 */
export type AgentMarkSeenParams = { pane_id: string; turn: number };
/** `agent.mark_seen` result: the turn that the label holds now (0 when it has none). */
export type AgentMarkSeen = { pane_id: string; seen_turn: number };

/**
 * `session.start` params: starts an agent on the Herdr 2 core. `cwd` is an absolute path, `kind`
 * an agent kind with a known program. `workspace_id`: a space (`hc:space:<id>`) or a group
 * (`hc:g:<key>`); missing makes a new space. `args` are agent arguments (for example a resume).
 */
export type SessionStartParams = { cwd: string; kind: string; workspace_id?: string; prompt?: string; args?: string[] };
/** `session.start` result. `prompt_error` says why the first prompt did not go in; the agent runs. */
export type SessionStart = { pane_id: string; workspace_id: string; tab_id: string; prompt_error?: string | null };

/** Where a suggested computer comes from: the herdr-core machine list, `~/.ssh/config`, or Tailscale. */
export type SuggestionSource = "core" | "ssh_config" | "tailscale";
/**
 * One computer in `machines.suggest`: a name, an address the phone can try, and the user and the
 * port when the source has them. `online` is set when the source knows it. Never keys or other
 * SSH config values.
 */
export type MachineSuggestion = {
  name: string;
  address: string;
  user?: string;
  port?: number;
  sources: SuggestionSource[];
  online?: boolean;
};
/** `machines.suggest` result. Read only; a source that fails gives no entries. */
export type MachinesSuggest = { suggestions: MachineSuggestion[] };
