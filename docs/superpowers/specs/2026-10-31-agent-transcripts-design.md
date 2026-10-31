# Agent transcripts: chat view for Codex, Pi and OpenCode

Date: 2026-10-31. Status: implemented.

## Goal

The chat view (thread, live follow, read-aloud, previews, recent folders, resume) works only for
Claude Code. Give the same view to Codex, Pi and OpenCode. The app keeps the terminal fallback
for all other agents.

## Shape

A new companion module `transcript` is the agent-neutral layer. It does these jobs:

- `resolve(pane)`: ask herdr for the agent kind and cwd, then find the session of that pane.
- `thread_get(log_path, before, limit)`: read one page of `ThreadItem`s, newest last.
- `Follower`: give new items and changed items (a tool call that got its result).
- `recent_sessions(kind, cwd)` and `recent_cwds()`: lists for the resume screen and folder picker.

The module routes by the agent kind (resolve, recent sessions) and by the form of `log_path`
(page, follow). The app treats `log_path`, `cursor`, `end` and `offset` as opaque values, so the
protocol does not change shape:

| Agent | `log_path` | Cursor and offset |
|---|---|---|
| Claude | `~/.claude/projects/<dir>/<id>.jsonl` | byte offset |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl` | byte offset |
| Pi | `~/.pi/agent/sessions/--<cwd>--/<ts>_<id>.jsonl` | byte offset |
| OpenCode | `opencode-db:<db path>#<session id>` | `session_message.seq` |

The Claude code stays in `claude/` with no change in behavior. `transcript` calls it.

## Find the session of a pane

Claude keeps its PID files. For the other agents the companion finds the agent process in the
pane (foreground processes and descendants of the shell, matched by name) and reads its start
time. The session is the newest one for the pane cwd that has activity after that start time.
When the process start is not known, only a session with activity in the last 10 minutes counts.
OpenCode also has `time_viewed`, which the TUI sets; the newest of `time_updated` and
`time_viewed` wins.

## Adapters

**Codex** (rollout JSONL). The cwd comes from the `session_meta` line. User prompts come from
`event_msg/user_message` (older versions) and `event_msg/item_completed` with a `UserMessage`
item (newer versions). The `response_item` user messages are not used: they also hold injected
context (AGENTS.md, environment). Assistant text, reasoning summaries, tool calls
(`function_call`, `custom_tool_call`, `web_search_call`) and their outputs come from
`response_item` lines. Compaction, interrupt and rollback events become system rows.

**Pi** (session JSONL tree). Entries have `id` and `parentId`. The thread shows the current
branch: the chain from the last entry back to the root. A page read scans the ids of the file
once. When the follower sees an entry whose parent is not the last entry, the user moved in the
tree; the follow stream ends with `branch_changed` and the app loads the thread again.
Hidden `custom_message` entries (`display: false`) and state entries are not shown.

**OpenCode 2** (SQLite, `~/.local/share/opencode/opencode.db`, WAL). Version 2 writes
`session_v2` and `session_message`; the older `session`, `message` and `part` tables are not
read. The connection is read-only with a busy timeout. A row can change after it is written (a
streamed reply, a tool that completes), so the follower polls for rows past the last `seq` or
with a newer `time_updated`, and sends changed items again with the same id.

## Resume

`sessions.recent` takes an optional `kind` (default `claude`). The app gets the resume command
per agent: Claude `--resume <id>`, Codex `resume <id>`, Pi `--session <id>`, OpenCode
`--session <id>`. `hello` sends `thread_kinds`, the kinds with chat support. The app shows
"Resume older session" only for a kind in that list (Claude when the host does not send it).

## Not in scope

- Slash commands stay Claude-only.
- Subagent cards stay Claude-only. Codex and OpenCode have child sessions, but they show as
  ordinary tool rows.
- Muse: no adapter. Public sources say Muse Code keeps sessions under
  `~/.local/share/muse/sessions/`, grouped by date, but no source documents the file format. An
  adapter would be a guess.

## Known limits

- Pi: after a move in the tree, the app merges the new page into the loaded items, so rows of the
  old branch can stay until the thread screen opens again.
- Codex encrypts most reasoning. Only reasoning with a summary shows as a thinking row.
- OpenCode v2.0.28 live writes are not verified on a device: the schema and the rows come from
  sessions in the v2 tables of this host, which version 1.18 wrote.
