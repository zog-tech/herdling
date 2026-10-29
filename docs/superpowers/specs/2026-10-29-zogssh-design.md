# Zogssh — design

Working name: **Zogssh**. The iPhone app is "Zogssh". The host companion is `zogsshd`.

## Intent

The maintainer runs coding agents in [herdr](https://herdr.dev) on three machines: a MacBook (laptop), a Mac Mini (macOS, always on) and a dev server (Ubuntu, always on). Away from the laptop, for example on a train, they want to start a new idea or continue an existing session from the phone, in seconds, "like pulling out the laptop without having it".

Zogssh is a phone app that the maintainer owns. It is a UI layer on top of herdr, in the spirit of [herdr-gpui](https://github.com/penso/herdr-gpui), optimized for the phone. Prior art: Moshi (getmoshi.app), a paid iOS app for agents over SSH.

The phone reaches the home network over **WireGuard**. On the train, LAN addresses work as at home.

## Goals

1. See every herdr machine, its workspaces and agents, and agent status (working, blocked, idle, done), on one screen.
2. Start a new agent session, restart a session, resume an old session, on any machine.
3. Read a session as a clean **message thread**: prompts, formatted replies, tool calls, subagents, thinking. One tap switches to the **terminal** view.
4. Talk to agents by voice (**hold to talk**) and optionally hear replies (**TTS**, full or summary). A walkie-talkie between the maintainer and the agents.
5. Get a **push notification** when an agent finishes or waits for permission. A tap opens that session.
6. **Pair** the phone with each machine. **Discover** herdr machines on the LAN.
7. herdr-gpui extras: overview ("needs you"), CPU and memory per host, plan usage, automations.
8. Work with every agent kind that herdr supports. Claude Code gets the full thread view first.

## Non-goals (version 1)

- Android. iPhone only. (Expo keeps Android possible later.)
- Approve/Deny from the lock screen. The push opens the app; the maintainer answers there. Planned for later.
- Thread readers for agents other than Claude Code. They use the terminal view until each one gets a reader.
- Teleport, fan-out, browser tabs, code editor, review-changes diff view from herdr-gpui.
- App Store release. TestFlight / internal distribution only.
- Any cloud relay for session traffic. All session traffic goes phone → SSH → host.

## Architecture

```
iPhone app (Expo, TypeScript)
   │  native module "ssh" (Swift, Citadel / SwiftNIO SSH)
   │  one SSH connection per host, exec channel: `zogsshd rpc`
   ▼  NDJSON JSON-RPC over the channel's stdin/stdout
zogsshd (Rust, one binary per host)
   ├─ rpc mode:   short-lived per SSH channel; talks to the herdr socket, reads agent logs, host stats, usage
   └─ serve mode: long-lived user service; herdr event subscriber → Expo push; Bonjour advert; pairing endpoint
   ▼
herdr server (unchanged)  ~/.config/herdr/herdr.sock  (newline-delimited JSON socket API, protocol 22)
```

Why this shape: the phone stays thin. All host knowledge (herdr API, log parsing, `/proc` vs `vm_stat`, usage tokens) lives in one Rust binary on the host. Traffic is plain SSH, as the maintainer asked. iOS kills sockets in the background, so pushes must come from the host (`serve` mode).

### Repo layout (pnpm workspace + cargo)

```
app/                 Expo app (Expo Router, TypeScript)
app/modules/ssh/     local Expo native module (Swift) — SSH client
companion/           Rust crate, binary `zogsshd`
protocol/            JSON schema / TS types for the RPC, shared by app and companion (TS types generated or hand-kept in sync)
docs/
design-system/zogssh/MASTER.md
```

## Companion: `zogsshd`

Single static-ish Rust binary for `aarch64-apple-darwin` and `x86_64-unknown-linux-gnu`. Install: `zogsshd install` copies itself to `~/.local/bin`, writes a launchd agent (macOS) or systemd user unit (Linux) for `serve`, and prints next steps.

### `zogsshd rpc` (stdio)

NDJSON request/response plus server-pushed notifications, JSON-RPC 2.0 shaped:
`{"id":1,"method":"...","params":{}}` → `{"id":1,"result":...}` / `{"id":1,"error":{"code","message"}}`; notifications `{"method":"event","params":{...}}`.

Methods (version 1):

| Method | Does |
|---|---|
| `hello` | Returns host name, OS, zogsshd version, herdr version and protocol, herdr reachable yes/no. |
| `herdr.call {method, params}` | Passthrough to any herdr socket method (snapshot, workspace.create, agent.start, agent.prompt, pane.send_keys, pane.read, tab.create, worktree.*). |
| `herdr.subscribe {events}` | Opens `events.subscribe` on the herdr socket; streams events as notifications. |
| `thread.resolve {pane_id}` | Pane → agent kind + session ID + log path. Claude: `pane.process_info` PIDs → `~/.claude/sessions/<pid>.json` → `sessionId`, `cwd` → `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. |
| `thread.get {session, before?, limit}` | Parsed, normalized thread items, paged from the end. |
| `thread.follow {session}` | Tails the log; streams new items as notifications. |
| `thread.subagent {session, agent_id}` | Same as `thread.get` for `<session>/subagents/agent-<id>.jsonl`. |
| `sessions.recent {cwd, agent}` | Recent sessions for a folder (Claude: files in the project dir, with first prompt + last activity) for **resume**. |
| `fs.dirs {path}` | List folders, plus herdr worktrees and recent cwds, for the "new session" picker. |
| `stats.get` | CPU %, memory used/total, load, uptime. Linux `/proc`, macOS `host_statistics`/`sysctl` (or `vm_stat`). |
| `usage.get` | Plan usage per provider. Codex: OAuth token from `~/.codex/auth.json` as herdr-gpui does. Claude: from Claude Code's OAuth credentials on the host (macOS Keychain `Claude Code-credentials`, Linux `~/.claude/.credentials.json`) and the usage endpoint Claude Code's `/usage` uses. Builder verifies the endpoint; if not reachable, shows "unavailable". |
| `automations.list` / `automations.runs` / `automations.approve` | Wraps `herdr-automate` if installed on the host; otherwise returns `not_installed`. |
| `summary.make {text}` | Haiku summary for TTS fallback; needs `ANTHROPIC_API_KEY` in the companion config; else error `no_key`. |
| `push.register {device_id, expo_token, prefs}` | Stores/updates the phone's push token in the companion config. |

### Normalized thread item (shared type)

```ts
type ThreadItem =
  | { kind: "user"; id; ts; text; images?: number }
  | { kind: "assistant"; id; ts; markdown }
  | { kind: "thinking"; id; ts; text: string | null }      // null = redacted; show "Thought" marker
  | { kind: "tool"; id; ts; name; input_summary; input; result?: { ok: boolean; text; truncated } }
  | { kind: "subagent"; id; ts; agent_id; description; status; result_summary? }
  | { kind: "system"; id; ts; text };                       // compaction, errors, interrupts
```

Claude JSONL notes (verified on the maintainer's machine, Claude Code 2.1.x): entries have `type` user/assistant and `message.content[]` with `text`, `thinking` (`thinking` text is usually empty, only `signature`), `tool_use`, `tool_result`. Subagent transcripts live in `<project>/<sessionId>/subagents/agent-<id>.jsonl`. Skip entry types that are not conversation (for example `api-request-blob`). Tool results can be large: cap at 4 KB per item, `truncated: true`, full text on demand later.

### `zogsshd serve` (user service)

- **Event watcher:** keeps a herdr `events.subscribe`; on `pane.agent_status_changed` to `blocked` → push "<agent title> needs you"; to `idle`/`done` from `working` → push "<agent title> finished". Debounce 5 s per pane; skip if status flips back within the window. Payload: host id, pane id, workspace name, agent title, status. No code or log content.
- **Push:** HTTPS POST to Expo push API (`https://exp.host/--/api/v2/push/send`) for each registered token. (Maintainer's call accepted: Expo push service; direct APNs later.)
- **Bonjour:** advertise `_zogssh._tcp` on the pairing port with TXT `host`, `user`, `ssh_port`, `ver`, `fp` (SSH host key SHA256 fingerprint).
- **Pairing endpoint:** HTTP on a fixed port (default 7790), LAN/WireGuard only, accepts requests only while a pairing window is open.
- Reconnects to herdr with backoff when the herdr server restarts.

### Pairing

1. The app lists hosts found by Bonjour (`_zogssh._tcp`), plus "Add by address".
2. On the host: `zogsshd pair` opens a 5-minute window and prints a 6-digit code (and a QR with the code + host + port).
3. In the app: tap the host, type the code (or scan the QR). The app POSTs `{code, device_name, ssh_public_key, expo_token}`.
4. The host appends the key to `~/.ssh/authorized_keys` as `restrict,command="<abs path>/zogsshd rpc" ssh-ed25519 … zogssh:<device>`, saves the push token, and returns `{host_name, user, ssh_port, host_key_fingerprint}`.
5. The app saves the host (address, user, port, pinned host key) and connects. Every later connection verifies the pinned host key.

The phone key is ed25519, generated on first launch, stored in the iOS Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). The restricted key can only run `zogsshd rpc`; it cannot open a shell. The terminal view works through herdr (`pane.read`, `pane.send_text`, `pane.send_keys`), not a raw shell.

Unpair: Settings → host → Remove: the app calls `pair.revoke` (an rpc method) that removes its line from `authorized_keys` and its push token, then deletes local data.

## App

Expo SDK (latest), Expo Router, TypeScript, dev build (not Expo Go). State: Zustand. Lists: FlashList (or FlatList with memoized rows). Markdown: `react-native-markdown-display` or similar with code highlighting. Icons: Lucide (`lucide-react-native`). No emoji as icons.

### Native module `ssh` (Swift)

Wraps Citadel (SwiftNIO SSH). API to JS:
- `generateKey()` / `publicKey()` — ed25519 in Keychain.
- `connect(hostId, {host, port, user, pinnedFingerprint})` → connection; rejects on fingerprint mismatch.
- `openRpc(hostId)` → exec channel `zogsshd rpc`; JS writes lines, receives lines as events (`onLine`, `onClose`).
- Auto-reconnect is in JS (backoff to 30 s, reconnect on app foreground, ping every 15 s while foreground).

### Screens

**Overview (home tab)**
- "Needs you": every agent across all hosts with status `blocked` (first) or newly `idle`/`done` (not yet seen), newest first. Tap → session.
- Host cards: name, online/offline (offline is normal for the laptop, not an error), CPU and memory bars. Under each host: workspaces → agents, each with a status dot **plus** an icon/label (not color only).
- Big "+" button: New session.

**New session sheet:** host → folder (recent cwds, herdr workspaces, worktrees, browse) → agent kind (default `claude`; all herdr kinds) → first prompt (type or hold to talk). Creates a workspace/tab in herdr as needed, `agent.start`, then `agent.prompt`, then opens the session.

**Session screen**
- Header: agent title, host, status. Segmented toggle **Thread | Terminal**.
- Thread: user bubbles; assistant markdown; tool cards collapsed to one line (`Bash · git status`, `Edit · app/foo.ts`) and expandable; subagent cards (description + status) open the subagent thread; thinking as a collapsed "Thought" row (text when present). Auto-scroll at the bottom only.
- Terminal: `pane.read` with ANSI (`--format ansi`) rendered in a monospace view, refreshed on `pane.updated` events or a 1 s poll while visible. A key row: Esc, Tab, Ctrl-C, arrows, Enter, plus the text box sends via `pane.send_text`.
- Bottom: text box + large mic button (hold to talk). When blocked, show the permission choices parsed from the terminal screen as buttons (Claude: numbered options), which send the matching key.
- Long press / "…" menu: Restart (stop the agent, `agent.start` with the same kind and cwd), Resume older session (list from `sessions.recent`, starts `claude --resume <id>` in a new pane), Rename, Close.
- Swipe left/right: next/previous agent in the same workspace.

**Usage tab:** per host, plan usage bars per provider (Claude, Codex) with reset times; CPU/memory per host.

**Automations tab:** per host, automation scripts, last runs, approve pending ones (shows plan, caps, content hash before approval). Shows "not installed" if the host has no `herdr-automate`.

**Settings:** hosts (pair, remove, rename, address), voice (speech engine, TTS on/off default, Full / Summary, voice, rate), notifications (finished on/off, needs-you on/off).

### Voice

- **ASR:** hold the mic button to record; release to send; slide away to cancel. On-device Apple speech (iOS 26 `SpeechAnalyzer`/`SpeechTranscriber`, fallback `SFSpeechRecognizer` on-device). Show live partial text while holding. Haptic on start, send and cancel. Fallback engine later: the maintainer's `transcribe-service`.
- **TTS:** per-session "speak replies" switch, global default in Settings. When the open session's agent goes from working to idle/done, speak the latest assistant reply:
  - Full: strip markdown; replace code blocks with "code block"; tables with "a table"; read the rest.
  - Summary: 2–3 sentences on what the agent did and what it needs. Apple Foundation Models on device when available; else `summary.make` on the host (Haiku); else Full.
  - Apple `AVSpeechSynthesizer`, premium/enhanced voice if installed. Audio session ducks other audio; plays through AirPods.
- iOS cannot speak from the background without the user; with the app in the background the push arrives, and a tap opens the session and speaks the reply.

### Notifications

`expo-notifications`; register the token at pairing and on every launch (`push.register`). Tap → deep link `zogssh://session/<hostId>/<paneId>`.

## Visual design

Source: `design-system/zogssh/MASTER.md` (ui-ux-pro-max), with these adjustments:
- Dark first (follow the system; dark is the designed default). Slate surfaces: background `#0F172A`, card `#1B2336`, muted `#272F42`, border `#475569`, text `#F8FAFC`, muted text `#94A3B8`. Accent / action green `#22C55E`. Destructive `#EF4444`. A light theme with the same tokens is a later item.
- Status tokens: working = blue `#60A5FA` + spinner icon; blocked = amber `#F59E0B` + hand icon; idle/done = green `#22C55E` + check icon; offline/unknown = gray + slash icon.
- Type: SF Pro (system) for UI and prose, so threads stay readable; **JetBrains Mono** for code blocks, tool cards, terminal and IDs. Body 16, line height 1.5; support Dynamic Type.
- Density: compact rows (44 pt minimum touch targets), 4/8 pt spacing rhythm.
- Motion: subtle, 150–250 ms, respect Reduce Motion. Haptics on send, mic start/stop, status change in the open session.
- Semantic tokens only; no raw hex in components.

## Constraints

- pnpm for JS. Expo dev builds via EAS (or local `expo run:ios`). Most later changes ship OTA; the native `ssh` module and voice permissions need a build.
- No session data leaves the maintainer's machines except the push payload (agent title + status) through Expo/APNs.
- Privacy: no personal names, LAN IPs or home paths in committed code or docs meant to become public. The repo is private for now.

## Build order (phases)

1. **Core loop:** companion `rpc` (hello, herdr passthrough + subscribe, thread resolve/get/follow for Claude) ; app with manual host add (key generated, pubkey shown to copy into authorized_keys), SSH module, overview from snapshot, session thread, text prompt, start new session.
2. **Pairing + push:** `serve`, Bonjour, pairing window, push on finished/blocked, deep links, install command.
3. **Voice:** hold to talk, TTS full and summary.
4. **Extras:** terminal view + key row, permission buttons, resume/restart, stats, usage, automations, subagent threads.

## Left to the builder

- Exact crate choices (tokio, serde_json, `mdns-sd`, `axum`/`tiny_http`, `reqwest` with rustls).
- Markdown and ANSI rendering libraries.
- Exact Claude usage endpoint; whether `herdr-automate` exists on the hosts (if not, the tab shows "not installed").
- Folder encoding for `~/.claude/projects` (replace `/` and `.` with `-`; verify against real dirs).
