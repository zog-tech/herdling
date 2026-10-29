# Zogssh Phase 1 (Core Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the iPhone (simulator first), connect over SSH to a herdr host, see all agents, read a Claude Code session as a message thread, send a text prompt, and start a new session.

**Architecture:** A Rust binary `zogsshd rpc` runs per SSH exec channel and speaks NDJSON JSON-RPC on stdio; it talks to the herdr socket and parses Claude logs. The Expo app holds one SSH connection per host through a local Swift Expo module (Citadel) and drives the RPC from TypeScript.

**Tech Stack:** Rust (tokio, serde, serde_json, anyhow, thiserror), Expo SDK latest + Expo Router + TypeScript + Zustand + Jest, Swift + Citadel (SwiftNIO SSH), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-10-29-zogssh-design.md`

## Global Constraints

- pnpm for JS (pnpm workspace at repo root: `app`, `protocol`). cargo for Rust (`companion/`).
- Binary name `zogsshd`; app name "Zogssh"; URL scheme `zogssh`; bundle id `com.zogtech.zogssh`.
- herdr socket: `$HERDR_SOCKET` if set, else `~/.config/herdr/herdr.sock`. Newline-delimited JSON, `{"id","method","params"}` → `{"id","result"}` or `{"id","error"}`. Protocol 22.
- RPC wire: one JSON object per line. Request `{"id":number,"method":string,"params":object}`; response `{"id","result"}` or `{"id","error":{"code":string,"message":string}}`; notification `{"method":"event","params":{"stream":string,"data":any}}`.
- Tool result text capped at 4096 bytes, `truncated: true` when cut.
- Visual tokens from the spec "Visual design" section; semantic tokens only, no raw hex in components. Lucide icons; no emoji as icons. Touch targets ≥ 44 pt. Status shown with color + icon + label.
- No personal names, LAN IPs or home paths in committed code, tests or fixtures. Use `/home/sam/proj` style paths in fixtures.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **herdr not running or restarted** → `hello` returns `herdr_ok:false`; `herdr.call` returns error code `herdr_unavailable`, not a crash; a subscribe stream ends with an `event` `{stream, data:{closed:true}}` so the app can resubscribe. (Task 2, Task 3 tests.)
2. **Huge session logs (50 MB+)** → `thread.get` reads from the end of the file, never loads the whole file. (Task 4 test with a generated large file, asserts bounded read.)
3. **Partial line at the end of a growing log** → `thread.follow` only emits complete lines; the partial tail is held until the newline arrives. (Task 5 test.)
4. **Pane with no Claude session** (shell, other agent kind, Claude not yet started) → `thread.resolve` returns `{kind:"none"|"<agent>", session:null}` and the app shows the terminal-text fallback (`agent.read`), not an error. (Task 5, Task 10.)
5. **Host offline / SSH drops** (laptop asleep, train tunnel) → host shows "offline" with last-seen time; reconnect backoff 1,2,4,…,30 s and immediately on app foreground; pending requests reject with `disconnected`. (Task 7 tests.)

---

## Phase 1 tasks

### Task 1: Repo scaffold and shared protocol types

**Files:**
- Create: `package.json` (private, workspaces via `pnpm-workspace.yaml`), `pnpm-workspace.yaml`
- Create: `protocol/package.json` (`@zogssh/protocol`), `protocol/src/index.ts`
- Create: `companion/Cargo.toml`, `companion/src/main.rs` (stub)

**Interfaces — Produces** (`protocol/src/index.ts`):
```ts
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type RpcRequest = { id: number; method: string; params?: unknown };
export type RpcError = { code: string; message: string };
export type RpcResponse = { id: number; result?: unknown; error?: RpcError };
export type RpcEvent = { method: "event"; params: { stream: string; data: unknown } };
export type Hello = { host: string; os: "macos" | "linux"; zogsshd: string; herdr_ok: boolean; herdr_version?: string; herdr_protocol?: number };
export type ThreadItem = /* exactly as in the spec "Normalized thread item" */;
export type ThreadPage = { items: ThreadItem[]; cursor: number | null; end: number }; // cursor = byte offset for older page (null at file start); end = file size at read time, used as thread.follow `from`
export type ThreadRef = { kind: string; session: string | null; log_path: string | null; cwd: string | null };
export type RecentSession = { session: string; first_prompt: string; last_activity: number; cwd: string };
```
Rust mirrors these with serde (`companion/src/types.rs`, `#[serde(tag="kind", rename_all="snake_case")]` for `ThreadItem`).

- [ ] **Step 1:** Create workspace files; `pnpm install`; `cd protocol && pnpm tsc --noEmit` passes.
- [ ] **Step 2:** `cargo new --bin companion` equivalent with deps tokio (full), serde, serde_json, anyhow, thiserror, dirs; `cargo build` passes.
- [ ] **Step 3:** Commit `chore: scaffold workspace, protocol types and companion crate`.

### Task 2: Companion RPC loop, `hello`, herdr passthrough

**Files:**
- Create: `companion/src/rpc.rs` (line loop, dispatch), `companion/src/herdr.rs` (socket client), `companion/src/types.rs`
- Modify: `companion/src/main.rs` (subcommand `rpc`)
- Test: `companion/tests/rpc_basic.rs`, helper `companion/tests/support/fake_herdr.rs` (UnixListener that answers scripted methods)

**Interfaces — Produces:**
- `herdr::Client::connect(path: &Path) -> Result<Client>`; `Client::call(&mut self, method: &str, params: Value) -> Result<Value, HerdrError>`; `HerdrError::{Unavailable, Remote{code,message}}`.
- `rpc::run<R: AsyncBufRead, W: AsyncWrite>(input: R, output: W, ctx: Ctx) -> Result<()>` where `Ctx { herdr_socket: PathBuf, home: PathBuf }`. Requests are handled concurrently (spawned tasks); writes go through one mpsc writer task.
- Methods: `hello`, `herdr.call {method, params}`. Unknown method → error code `unknown_method`. Bad JSON line → error with `id: null`, code `bad_request`, loop continues.

- [ ] **Step 1: Tests** (run `rpc::run` on in-memory duplex pipes with a fake herdr socket in a tempdir):
  - `hello_reports_herdr_ok` — fake answers `server.status`-style ping (use `session.snapshot`) → `result.herdr_ok == true`, `result.zogsshd == env!("CARGO_PKG_VERSION")`.
  - `hello_without_herdr` — no socket → `herdr_ok == false`.
  - `herdr_call_passthrough` — `herdr.call {method:"agent.list"}` → result equals fake's `result` object.
  - `herdr_call_unavailable` — no socket → `error.code == "herdr_unavailable"`.
  - `bad_json_line_does_not_kill_loop` — send `not json\n` then `hello` → second still answered.
- [ ] **Step 2:** `cargo test` → fails (missing modules).
- [ ] **Step 3:** Implement. Get `herdr_version`/`herdr_protocol` by running `herdr status` is NOT allowed (slow); take them from the snapshot response if present, else omit.
- [ ] **Step 4:** `cargo test` → all pass. Manual: `printf '{"id":1,"method":"hello"}\n' | cargo run -q -- rpc` on this Mac prints `herdr_ok:true`.
- [ ] **Step 5:** Commit `feat(companion): rpc loop with hello and herdr passthrough`.

### Task 3: `herdr.subscribe` and `rpc.cancel`

**Files:** Modify `companion/src/rpc.rs`, `companion/src/herdr.rs`. Test: `companion/tests/rpc_subscribe.rs`.

**Interfaces — Produces:**
- `herdr.subscribe {events?: string[]}` → result `{stream: "herdr:<n>"}`, then notifications `{"method":"event","params":{"stream":"herdr:<n>","data":<herdr event>}}`. Opens its own herdr connection with `events.subscribe` (copy the herdr schema's params; check `herdr api schema --json`).
- When the herdr connection closes: final event `data: {"closed": true}`.
- `rpc.cancel {stream}` stops a stream (used by Task 5 follow too). Generic: `Ctx` holds `streams: HashMap<String, AbortHandle>`.

- [ ] **Step 1: Tests:** `subscribe_forwards_events` (fake emits two events → two notifications with the same stream id, in order); `subscribe_reports_close` (fake drops connection → `closed:true`); `cancel_stops_stream` (after cancel, fake event not forwarded).
- [ ] **Step 2:** Run → fail. **Step 3:** Implement. **Step 4:** Run → pass. Manual check against real herdr: subscribe, then `herdr workspace create` in another terminal shows an event.
- [ ] **Step 5:** Commit `feat(companion): herdr event subscription streams`.

### Task 4: Claude log parser → `ThreadItem`s, paged from the end

**Files:**
- Create: `companion/src/claude/mod.rs`, `companion/src/claude/parse.rs`, `companion/src/tail.rs`
- Test: `companion/tests/claude_parse.rs`, fixtures `companion/tests/fixtures/claude_basic.jsonl`, `claude_subagent.jsonl` (hand-written, anonymized, shaped like real Claude Code 2.1.x lines — look at a real file under `~/.claude/projects` for shape, never copy content)

**Interfaces — Produces:**
- `claude::parse_line(line: &str) -> Vec<ThreadItem>` — one JSONL line can yield several items (one per content block). Mapping: user string content or `text` block → `user`; user `tool_result` block → attaches to the `tool` item with the same `tool_use_id` (done in `assemble`); assistant `text` → `assistant`; `thinking` → `thinking` with `text: None` when empty; `tool_use` named `Task`/`Agent` → `subagent` (description from input), other `tool_use` → `tool` with `input_summary` (Bash: `command`; Read/Edit/Write: `file_path`; Grep/Glob: `pattern`; else first string field, max 80 chars); `type:"system"` and compaction summaries → `system`. Skip `api-request-blob`, `file-history-snapshot`, `summary` lines that are not compaction, and `isMeta: true` user lines.
- `claude::assemble(items: Vec<ThreadItem>, results: HashMap<String, ToolResult>) -> Vec<ThreadItem>` — merges tool results into tool items.
- `tail::read_lines_before(path: &Path, before: Option<u64>, max_items: usize) -> io::Result<(Vec<String>, Option<u64>)>` — reads backwards in 64 KiB blocks from `before` (default EOF); returns complete lines in file order and the byte offset of the first returned line (None if at 0).
- `thread.get {log_path, before?, limit=60}` → `ThreadPage`.

- [ ] **Step 1: Tests:** `parses_user_and_assistant_text`; `empty_thinking_is_redacted_marker` (`text == None`); `tool_use_gets_result_attached` (ok + text); `tool_result_truncated_at_4096` (`truncated == true`, `text.len() <= 4096`); `task_tool_becomes_subagent`; `skips_blob_and_meta_lines`; `paging_returns_cursor_and_older_page` (limit 2 → cursor Some; second call with cursor returns earlier items, no overlap); `large_file_reads_bounded` (generate 60 MB file in tempdir; wrap reader to count bytes read; assert < 2 MB for limit 60).
- [ ] **Step 2:** Run → fail. **Step 3:** Implement. **Step 4:** Run → pass. Manual: `thread.get` on a real local log prints sane items.
- [ ] **Step 5:** Commit `feat(companion): claude log parser and paged thread.get`.

### Task 5: `thread.resolve`, `thread.follow`, `thread.subagent`, `sessions.recent`, `fs.dirs`

**Files:** Create `companion/src/claude/resolve.rs`, `companion/src/claude/follow.rs`, `companion/src/fsdirs.rs`. Test: `companion/tests/claude_resolve.rs`, `companion/tests/claude_follow.rs`.

**Interfaces — Produces:**
- `claude::project_dir(home: &Path, cwd: &str) -> PathBuf` = `home/.claude/projects/<cwd with every char not [A-Za-z0-9] replaced by '-'>` (verify against real dirs on this Mac, e.g. `/home/sam/dev/apps/zogssh` → `-home-sam-dev-apps-zogssh`).
- `thread.resolve {pane_id}` → `ThreadRef`. Steps: herdr `agent.get` (kind, cwd) → if kind != `claude` return `{kind, session:null,…}`; herdr `pane.process_info` → candidate PIDs (pane PID and descendants; check the schema for field names) → first existing `~/.claude/sessions/<pid>.json` → `sessionId` → `log_path = project_dir(cwd)/<sessionId>.jsonl`. Fallback when no PID file: newest `.jsonl` in `project_dir(cwd)` modified within the last 10 min, else `session:null`.
- `thread.follow {log_path, from}` (`from` = byte offset, usually EOF from the last `thread.get`) → `{stream:"thread:<n>"}`; notifications carry `{items: ThreadItem[], offset: number}`. Poll file size every 500 ms (no inotify dependency); emit only complete lines; tool results arriving later emit an updated `tool` item with the same `id` (app replaces by id).
- `thread.subagent {log_path, agent_id, before?, limit}` → `ThreadPage` from `<log_path without .jsonl>/subagents/agent-<agent_id>.jsonl`.
- `sessions.recent {cwd, limit=20}` → `RecentSession[]` sorted by mtime desc; `first_prompt` = first non-meta user text, 120 chars.
- `fs.dirs {path?}` → `{path, dirs: string[], recent_cwds: string[]}`; `recent_cwds` = the `cwd` field of the newest line of the newest session file in each `~/.claude/projects` dir (dir-name decoding is lossy, so do not decode), newest first, cap 30.

- [ ] **Step 1: Tests:** `project_dir_encoding`; `resolve_via_pid_file` (fake herdr + temp home with `sessions/<pid>.json`); `resolve_non_claude_agent`; `resolve_fallback_newest_recent_file`; `follow_emits_only_complete_lines` (append `{"type":"user"…` without newline → nothing; append rest + `\n` → one item); `follow_updates_tool_with_result`; `recent_sessions_sorted_with_first_prompt`.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; manual `thread.resolve` on a real pane on this Mac returns this session's log path.
- [ ] **Step 5:** Commit `feat(companion): resolve pane to claude session, follow, recent sessions`.

### Task 6: Expo app scaffold, theme tokens, RPC client

**Files:**
- Create: `app/` via `pnpm create expo-app app --template default` then trim; `app/app.json` (name Zogssh, scheme `zogssh`, bundle id, `userInterfaceStyle: automatic`)
- Create: `app/src/theme/tokens.ts`, `app/src/theme/fonts.ts` (JetBrains Mono via `expo-font`)
- Create: `app/src/rpc/RpcClient.ts`, `app/src/rpc/transport.ts`
- Test: `app/src/rpc/RpcClient.test.ts` (jest-expo)

**Interfaces — Produces:**
```ts
// transport.ts
export interface LineTransport { send(line: string): void; onLine(cb: (line: string) => void): () => void; onClose(cb: (reason: string) => void): () => void; close(): void }
// RpcClient.ts
export class RpcClient {
  constructor(t: LineTransport, opts?: { timeoutMs?: number /* default 15000 */ });
  call<T>(method: string, params?: object): Promise<T>;           // rejects RpcError-shaped Error with .code
  stream<T>(method: string, params: object, onData: (d: T) => void): Promise<() => void>; // returns unsubscribe (sends rpc.cancel)
  closed: boolean;
}
// tokens.ts: colors {bg, card, muted, border, text, textMuted, accent, danger, status:{working,blocked,idle,done,unknown}}, space (4..48), radius, type sizes; exactly the spec's hex values.
```
- [ ] **Step 1: Tests** with a fake transport: `call_resolves_matching_id`; `call_rejects_error_with_code`; `call_times_out` (fake timers, code `timeout`); `stream_routes_events_by_stream_id`; `close_rejects_pending_with_disconnected`; `unsubscribe_sends_rpc_cancel`.
- [ ] **Step 2:** `pnpm --filter app test` → fail. **Step 3:** implement. **Step 4:** pass; `pnpm --filter app tsc --noEmit` passes.
- [ ] **Step 5:** Commit `feat(app): expo scaffold, theme tokens and rpc client`.

### Task 7: Native `ssh` module (Swift / Citadel) and connection manager

**Files:**
- Create: `app/modules/ssh/` via `npx create-expo-module@latest --local ssh`; `app/modules/ssh/ios/SshModule.swift`, `app/modules/ssh/ios/Keys.swift`, podspec dependency on Citadel (SPM via podspec is not supported → vendor via `spm_dependency` in the podspec if the installed Expo/CocoaPods supports it; otherwise add Citadel through an Expo config plugin that adds the Swift package to the Xcode project. Decide by trying the podspec route first.)
- Create: `app/modules/ssh/index.ts` (typed JS API)
- Create: `app/src/hosts/connection.ts` (per-host connection + reconnect), `app/src/hosts/store.ts` (Zustand, persisted with `expo-secure-store` for host list)
- Test: `app/src/hosts/connection.test.ts` (mock the native module)

**Interfaces — Produces:**
```ts
// modules/ssh/index.ts
export function ensureKey(): Promise<{ publicKey: string }>;            // ed25519, OpenSSH format "ssh-ed25519 AAAA… zogssh"
export function connect(hostId: string, o: { host: string; port: number; user: string; fingerprint?: string }): Promise<{ fingerprint: string }>; // rejects code "host_key_mismatch"
export function openExec(hostId: string, command: string): Promise<string /* channelId */>;
export function write(channelId: string, data: string): Promise<void>;
export function closeChannel(channelId: string): Promise<void>;
export function disconnect(hostId: string): Promise<void>;
// events: "onData" {channelId, data}, "onChannelClose" {channelId, reason}, "onDisconnect" {hostId, reason}
// connection.ts
export type HostConn = { status: "offline" | "connecting" | "online"; lastSeen?: number; rpc?: RpcClient; hello?: Hello; error?: string };
export function useHostConn(hostId: string): HostConn;
export function startConnections(): void;   // connects all saved hosts, reconnect backoff 1,2,4,8,16,30 s; reconnect now on AppState "active"
// store.ts
export type Host = { id: string; name: string; address: string; port: number; user: string; fingerprint?: string; command: string /* default "zogsshd rpc" */ };
```
A `LineTransport` adapter splits `onData` chunks into lines (buffer partial lines; UTF-8 safe — native side emits strings decoded from complete UTF-8 sequences).

- [ ] **Step 1: Tests (JS):** `line_adapter_buffers_partial_lines`; `reconnect_backoff_sequence` (fake timers, mock connect rejects → delays 1,2,4,8,16,30,30 s); `foreground_triggers_immediate_reconnect`; `first_connect_pins_fingerprint`; `mismatch_marks_error_and_stops_retrying`.
- [ ] **Step 2:** fail. **Step 3:** implement JS + Swift. Swift: Citadel `SSHClient.connect` with ed25519 private key auth (`Curve25519.Signing.PrivateKey` stored in Keychain as raw representation, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`); host key validator computes SHA256 fingerprint and compares; exec channel with streaming stdin/stdout (Citadel `withExec`/`executeCommandStream` with inbound writer).
- [ ] **Step 4:** JS tests pass. `cd app && npx expo run:ios` builds. Manual on simulator: add host = this Mac (`localhost`, port 22, current user; Remote Login must be on), paste the shown public key into `~/.ssh/authorized_keys` (unrestricted for now, command `<abs path to target/debug/zogsshd> rpc`), app shows `hello` result.
- [ ] **Step 5:** Commit `feat(app): native ssh module and host connection manager`.

### Task 8: Hosts: add-host screen and settings list

**Files:** Create `app/app/(tabs)/settings.tsx`, `app/app/hosts/add.tsx`, `app/src/ui/` primitives (`Screen`, `Card`, `Row`, `Button`, `StatusBadge`, `Text`). Test: `app/src/ui/StatusBadge.test.tsx`.

**Interfaces — Produces:** `StatusBadge({ status: AgentStatus | "offline" })` renders icon + label + color (labels: Working, Needs you, Idle, Done, Unknown, Offline). Add-host form: name, address, port (22), user, command (`zogsshd rpc`); shows the phone public key with Copy button and the exact `authorized_keys` line `restrict,command="zogsshd rpc" <pubkey>`; "Test connection" calls `hello`.

- [ ] **Step 1:** Test `status_badge_has_label_for_each_status` (accessibility label + text, not color only). **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; simulator: add host, test connection shows host name and herdr ok.
- [ ] **Step 5:** Commit `feat(app): add-host flow and settings`.

### Task 9: Overview screen

**Files:** Create `app/app/(tabs)/index.tsx`, `app/src/herdr/snapshot.ts` (types + reducer), `app/src/herdr/useHostSnapshot.ts`. Test: `app/src/herdr/snapshot.test.ts`.

**Interfaces — Produces:**
- `type Snapshot` mirrors herdr `session.snapshot` (`agents`, `workspaces`, `tabs`, `panes`; check real output of `herdr api snapshot`).
- `applyEvent(s: Snapshot, e: HerdrEvent): Snapshot` handles `pane.agent_status_changed`, `pane.agent_detected`, `pane.closed`, `workspace.created|renamed|closed`, `tab.created|closed`; unknown events → refetch flag.
- `useHostSnapshot(hostId)` → `{snapshot, loading, error}`: initial `herdr.call session.snapshot`, then `herdr.subscribe`; on `closed` resubscribe + refetch.
- `needsYou(hosts): {hostId, agent}[]` — `blocked` first, then `idle|done` agents whose `state_change_seq` is newer than the app's last-seen seq for that pane (persist last-seen per pane when the session screen opens).
- Screen: "Needs you" list; host cards (name, status, workspaces → agents with `StatusBadge` and `terminal_title_stripped`); "+" floating button → `/new`.

- [ ] **Step 1: Tests:** `status_change_updates_agent`; `pane_closed_removes_agent`; `needs_you_orders_blocked_first`; `needs_you_hides_seen`. **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; simulator shows real agents from this Mac.
- [ ] **Step 5:** Commit `feat(app): overview with live agent status`.

### Task 10: Session screen — thread + prompt

**Files:** Create `app/app/session/[hostId]/[paneId].tsx`, `app/src/thread/useThread.ts`, `app/src/thread/items/{UserBubble,AssistantMessage,ToolCard,SubagentCard,ThinkingRow,SystemRow}.tsx`, `app/src/thread/merge.ts`. Test: `app/src/thread/merge.test.ts`.

**Interfaces — Produces:**
- `mergeItems(existing: ThreadItem[], incoming: ThreadItem[]): ThreadItem[]` — replace by `id`, append new, keep order.
- `useThread(hostId, paneId)` → `{ref, items, loadOlder(), loadingOlder, follow status}`: `thread.resolve` → `thread.get` → `thread.follow` from the returned EOF offset (`from` = `ThreadPage.end`).
- When `ref.session == null`: show terminal text fallback via `herdr.call agent.read {target: paneId, source:"recent", lines: 200, format:"text"}` refreshed every 2 s, monospace.
- Composer: multiline `TextInput` + send button; send = `herdr.call agent.prompt {target: paneId, text}`; on `agent_blocked` error show "Agent is waiting for a choice — open the terminal" (permission buttons are Phase 4). Inverted list, memoized rows, markdown renderer with JetBrains Mono code blocks. Tool cards collapsed to one line, expand on tap. Subagent cards show description + status (opening the subagent thread is Phase 4).
- Header: title, host, `StatusBadge`; Thread/Terminal segmented control (Terminal = same `agent.read` text view for now).

- [ ] **Step 1: Tests:** `merge_replaces_by_id`; `merge_appends_new_in_order`. **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; simulator: open this Mac's Claude session, thread renders; send "say hi" to an idle test agent → reply appears live.
- [ ] **Step 5:** Commit `feat(app): session thread with live follow and prompt`.

### Task 11: New session sheet

**Files:** Create `app/app/new.tsx` (modal), `app/src/herdr/startSession.ts`. Test: `app/src/herdr/startSession.test.ts` (mock rpc).

**Interfaces — Produces:** `startSession(rpc: RpcClient, o: {cwd: string; kind: string; prompt?: string; workspaceId?: string}): Promise<{paneId: string}>` — if no `workspaceId`: `workspace.create {cwd}` (check schema param names) → use its first pane; else `tab.create {workspace_id, cwd}`; then `agent.start {name: basename(cwd), kind, pane}`; then if prompt `agent.prompt {target: paneId, text: prompt}`. Sheet steps: host (online hosts only) → folder (`fs.dirs` recent cwds + browse) → kind (list from herdr `agent.start` kinds, default `claude`) → prompt → Start → navigate to the session.

- [ ] **Step 1: Tests:** `creates_workspace_then_starts_agent_then_prompts` (call order + params); `uses_existing_workspace_with_tab_create`; `skips_prompt_when_empty`. **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; simulator: start a Claude session in a temp folder with prompt "say hi" → lands in its thread, reply arrives.
- [ ] **Step 5:** Commit `feat(app): new session flow`.

### Task 12: Phase 1 end-to-end check on two hosts

- [ ] Build `zogsshd` for Linux on the dev server (`cargo build --release` there, from a git clone in a temp dir) and install to `~/.local/bin/zogsshd`; add the phone key line to `authorized_keys` there.
- [ ] Simulator: both hosts online, overview lists agents from both; open a session on each; send a prompt on each; kill herdr server on one host → host shows herdr unavailable, then recovers after restart; turn off network → hosts offline, back on → reconnect within 30 s.
- [ ] Write `docs/phase1-verification.md` with what passed and what did not. Commit.

---

## Phase 2: Pairing, push, install (task group)

- **T13 `zogsshd serve` skeleton + config** (`~/.config/zogsshd/config.toml`: devices [{id, name, expo_token, prefs}], anthropic_key?). Tests on config load/save.
- **T14 Event watcher → push**: herdr subscribe, transitions working→idle/done ⇒ "finished", →blocked ⇒ "needs you", 5 s debounce per pane, Expo push POST with `{to, title, body, data:{hostId, paneId}, sound:"default"}`. Tests with fake herdr + mock HTTP server.
- **T15 Pairing**: `zogsshd pair` opens 5-min window (writes a code file read by `serve`), prints code + QR (`qrcode` crate, terminal render); `serve` HTTP `POST /pair` on 7790; appends restricted authorized_keys line (absolute path to binary); `pair.revoke` rpc. Tests: wrong code rejected; expired window rejected; duplicate key not appended twice; revoke removes only that line.
- **T16 Bonjour** advert `_zogssh._tcp` (mdns-sd) with TXT fields; app discovery via a Bonjour Expo module (`react-native-zeroconf` or small Swift `NWBrowser` added to the `ssh` module). Requires `NSLocalNetworkUsageDescription` + `NSBonjourServices`.
- **T17 `zogsshd install`**: launchd plist / systemd user unit, `loginctl enable-linger` hint.
- **T18 App**: discovery list + pair screen (code entry, QR scan via `expo-camera`), push registration (`expo-notifications`, `push.register` on each connect), notification tap → deep link to session.

## Phase 3: Voice (task group)

- **T19 Hold-to-talk** component: press-and-hold mic, slide-away cancel, haptics, live partial text; ASR via a Swift module on `SpeechAnalyzer` (iOS 26) with `SFSpeechRecognizer` on-device fallback. Release ⇒ `agent.prompt`.
- **T20 TTS**: per-session switch + Settings default; full mode markdown→speech text (`speechText(markdown)` pure function with tests: code blocks → "code block", tables → "a table", links → link text); `AVSpeechSynthesizer` via `expo-speech`; trigger on working→idle/done for the open session.
- **T21 Summary mode**: Apple Foundation Models via Swift module when available; fallback `summary.make` rpc (Haiku, `claude-haiku-5-5`) in companion; fallback full.

## Phase 4: Extras (task group)

- **T22 Terminal view**: ANSI render of `agent.read --format ansi`, key row (Esc, Tab, Ctrl-C, arrows, Enter) via `pane.send_keys`, text via `pane.send_text`; refresh on `pane.updated`.
- **T23 Permission buttons**: parse Claude's numbered choices from the visible screen when blocked; buttons send the digit + Enter. Tests on screen fixtures.
- **T24 Restart / Resume / Rename / Close** menu; resume list from `sessions.recent`, runs `claude --resume <id>` via `agent.start` args.
- **T25 Subagent thread** screen (`thread.subagent`).
- **T26 `stats.get`** (Linux `/proc/stat` delta + `/proc/meminfo`; macOS `host_statistics64` + `sysctl hw.memsize`) and host card bars; **`usage.get`** (Codex + Claude) and Usage tab.
- **T27 Automations** tab wrapping `herdr-automate` (`not_installed` when missing).
- **T28 Swipe between agents** in a workspace; polish pass with the ui-ux-pro-max pre-delivery checklist.
