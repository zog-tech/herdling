# herdlingd protocol

The app talks to `herdlingd` on each host. This page lists the rules for both sides.

## Transport

- The app opens an SSH connection with the restricted SSH key.
- The key runs `herdlingd rpc`. The command reads and writes one JSON object per line.
- A line ends with `\n`. A JSON object never contains a raw newline.
- A request line is at most 34 MiB. A longer line gets a `bad_request` error. (Before `stt.make`, the limit was 16 MiB.)

## Messages

- Request: `{"id": 1, "method": "name", "params": {}}`. `params` is optional.
- Response: `{"id": 1, "result": {}}` or `{"id": 1, "error": {"code": "...", "message": "..."}}`.
- Event: `{"method": "event", "params": {"stream": "...", "data": {}}}`. A streaming method sends events until the app sends `rpc.cancel`.
- The `id` is a number chosen by the app. The response carries the same `id`.
- A line that is not valid JSON gets an error with `id` null.

## Error codes in use

`bad_request`, `unknown_method`, `not_found`, `not_installed`, `io_error`, `internal`, `timeout`, `herdr_unavailable`, `upstream_error`, `command_failed`, `no_command`, `bad_output`, `automate_failed`, `too_large`, `update_unavailable`, `unsupported_target`, `checksum_mismatch`, `downgrade`, `update_in_progress`, `not_a_repo`, `already_exists`,
`unsupported_platform`, `stale`.

A `herdr.call` error can also carry a code from herdr itself.

## Method list

`hello` returns `methods`: every method name the host accepts. An older `herdlingd` does not send `methods`. In that case the app tries the call and falls back on `unknown_method`.

## Terminal screen: `pane.watch`

Since herdlingd 0.1.1. A streamed screen of one pane. It replaces `pane.read` polling.

```json
{"id": 7, "method": "pane.watch", "params": {"pane_id": "w1:p2", "lines": 200, "format": "ansi", "interval_ms": 80}}
→ {"id": 7, "result": {"stream": "pane:9"}}
→ {"method": "event", "params": {"stream": "pane:9", "data": {"revision": 0, "text": "...", "truncated": false}}}
```

- herdlingd reads the pane (herdr `pane.read`, source `recent`) every `interval_ms` on one kept herdr
  connection. `interval_ms` is clamped to 50–1000 (default 80). `lines` is clamped to 1–1000 (default 200).
  `format` is `text` (default, ANSI removed) or `ansi`.
- The first screen is sent at once. After that, a screen is sent only when its `revision` or its
  `text` differs from the last screen sent. herdr 0.9.5 returns `revision: 0` on every read, so the
  text is the real check. An idle screen sends nothing.
- Rate cap: at most 20 events per second per stream. A burst sends the latest screen, not every screen.
- The first read happens before the reply. A herdr error (for example `pane_not_found`) is the call error.
- Later, a herdr error sends `{"error": "<code>", "message": "..."}` and ends the stream. A stopped
  herdr sends `{"closed": true}` and ends the stream.
- The app stops the stream with `rpc.cancel` when the terminal is not on screen. The stream also
  stops when the channel closes.
- An app that finds no `pane.watch` in `hello.methods` polls `pane.read` as before.

## Typing into a pane: `pane.send_input` and the order of calls

The app types through `herdr.call`. One line costs one call:

```json
{"id": 8, "method": "herdr.call", "params": {"method": "pane.send_input", "params": {"pane_id": "w1:p2", "text": "ls -la", "keys": ["enter"]}}}
```

- Checked against herdr 0.9.5 (protocol 22): herdr types `text` first, then presses `keys`, in one
  call. herdr checks every key before it types anything: an unknown key (`invalid_key`) types nothing.
- herdr without `pane.send_input` answers `invalid_request` ("unknown variant"). The app then uses
  `pane.send_text` and `pane.send_keys ["enter"]`, and remembers this for the connection.
- herdlingd marks `pane.send_text`, `pane.send_keys` and `pane.send_input` as phone input.
- Since herdlingd 0.1.1 (the version that lists `pane.watch`), herdlingd runs the typing calls to one
  pane in the order they arrive. The app can send the next key before the reply to the last one.
  With an older herdlingd, the app waits for each reply before the next typing call to the pane.

## Answer from the notification: `pane.answer` and choice pushes

Since the herdlingd that lists `pane.answer`. A "needs you" push can have Yes and No buttons.

```json
{"id": 9, "method": "pane.answer", "params": {"pane_id": "w1:p2", "key": "1", "expect_label": "Yes"}}
→ {"id": 9, "result": {"answered": true}}
→ {"id": 9, "error": {"code": "stale", "message": "the menu changed"}}
```

- herdlingd reads the visible screen (herdr `pane.read`, source `visible`) and finds the permission
  menu with the same rules as the app (`companion/src/choices.rs`, `app/src/thread/parseChoices.ts`).
- herdlingd sends the key (herdr `pane.send_keys [key]`) only when the agent still waits
  (`agent_status` `blocked`) and the option at `key` still has `expect_label`. A label cut for a
  push (60 characters, ends with "…") also matches. Otherwise the error is `stale` and no key is sent.
  A closed pane also gives `stale`.
- `key` must be one digit from 1 to 9, else `bad_request`. The answer is phone input, and it keeps
  the order of the other typing calls to the pane.
- `push.register` takes an optional `capabilities: string[]` (at most 16 strings of at most 64
  characters). The app sends `["choice_actions"]` only to a host whose `hello.methods` has
  `pane.answer`. herdlingd saves the list per device. A register without the field clears it.
- To a device with `choice_actions`, a "needs you" push gets `categoryId: "herdling_choice"` and
  `data.choice`, when the first option starts with the word "Yes" and the last with the word "No":

  ```json
  {"hostId": "h_1", "paneId": "w1:p2",
   "choice": {"yes": {"key": "1", "label": "Yes"}, "no": {"key": "3", "label": "No, and tell Claude what to do differently (esc)"}, "revision": 0}}
  ```

  Labels have at most 60 characters. The push has no question text: it passes Expo and Apple or Google.
  The push body adds a line with the two labels ("Yes · No, and tell Claude…"). Other devices get the push as before.
- The app registers the category `herdling_choice` with the actions `choice_yes` ("Yes") and
  `choice_no` ("No", destructive). Both open the app and need Face ID or the passcode on a locked
  phone. The app then connects, opens the session and calls `pane.answer`.

## Updates: `update.check` and `update.apply`

`herdlingd` updates itself from the GitHub releases of the project. The design and the trust
model are in `docs/superpowers/specs/2026-10-31-herdlingd-install-update-design.md`.
The app checks `hello.methods` before it calls these methods. `hello.herdlingd` is the running version.

`update.check` params: `{"version"?: "X.Y.Z"}`. Without `version` it reads the latest release.
Result:

```json
{"current": "0.1.0", "latest": "0.2.0", "update_available": true, "notes": "...", "date": "2026-11-02", "target": "aarch64-apple-darwin"}
```

`date` is optional. `update_available` is true only when `latest` is newer than `current`.

`update.apply` params: `{"version"?: "X.Y.Z", "allow_downgrade"?: false}`. Result:

```json
{"from": "0.1.0", "to": "0.2.0", "status": "updated", "service_restarted": true}
```

- `status` is `"updated"` or `"up_to_date"`. With `up_to_date` nothing changes.
- The method downloads the tarball for this computer, checks its SHA-256 against the release
  manifest, and replaces the running executable with one rename. Then it restarts the user
  service (launchd or systemd), if it is installed. `service_restarted` is false when there is no
  service or the restart failed.
- The rpc process keeps the old code until its channel closes. After the reply the app
  reconnects; the new channel runs the new binary, and `hello` shows the new version.
- The download can take some time. Use a long timeout (the app uses 3 minutes).

Error codes:

| Code | Meaning |
|---|---|
| `update_unavailable` | The release or the manifest could not be read, a download URL is not a release URL of the project, or updates are off in this process |
| `unsupported_target` | No release build for this OS and CPU |
| `checksum_mismatch` | The download does not match the SHA-256 of the release. Nothing changed |
| `downgrade` | The release is older than the running version and `allow_downgrade` is not true |
| `update_in_progress` | Another update runs now |
| `io_error` | The binary could not be unpacked or replaced (for example, the folder is not writable) |
| `bad_request` | `version` is not a version text |

## Start at boot: `hello.boot`, `boot.check` and `mac.open_settings`

herdlingd runs as a user service: a LaunchAgent on macOS, a systemd user unit on Linux. It starts
when the user logs in. It starts at boot only with automatic login (macOS) or lingering (Linux).
Since herdlingd 0.1.1, `hello` has an optional `boot` field:

```json
{"starts_at": "login", "how": "Run this once on the computer: sudo loginctl enable-linger sam", "reason": "linger_off", "user": "sam"}
```

- `starts_at` is `"boot"`, `"login"` or `"unknown"`. `how` is a short text for the user.
- `reason` (optional) is one of `linger_on`, `linger_off`, `no_loginctl`, `auto_login_on`,
  `auto_login_off`, `auto_login_other_user`, `filevault_on`, `no_defaults`. New values can come.
- `user` (optional) is the user name that herdlingd runs as.
- Linux: `loginctl show-user <user> -p Linger` (`Linger=yes` is boot), else the file
  `/var/lib/systemd/linger/<user>`.
- macOS: `fdesetup status` (FileVault on means automatic login is not possible, so `login`), then
  `defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser` compared with the user.
- The rpc process keeps the result for 5 minutes. An older herdlingd does not send `boot`.

`boot.check` (no params) reads the state again, with no cache, and returns the same object.

`mac.open_settings` params: `{"pane": "users_groups" | "sharing" | "filevault"}`. It runs
`open "x-apple.systempreferences:<id>"` on the Mac, so System Settings shows that page on the
Mac screen. Only these three ids are accepted: there is no way to open any other URL.
Result: `{"opened": "users_groups"}`.

| Pane | URL |
|---|---|
| `users_groups` | `x-apple.systempreferences:com.apple.Users-Groups-Settings.extension` |
| `sharing` | `x-apple.systempreferences:com.apple.Sharing-Settings.extension` |
| `filevault` | `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?FileVault` |

Errors: `bad_request` (a missing or other pane), `unsupported_platform` (not macOS),
`command_failed` (`open` failed, for example when no user is logged in on the Mac screen).

## Chat view: `thread_kinds`

`hello.thread_kinds` lists the herdr agent kinds with a transcript adapter: `claude`, `codex`,
`pi`, `opencode`, `omp` and `gemini` (the last two since this version). `thread.resolve`,
`thread.get`, `thread.follow` and `sessions.recent` work for each listed kind.

- `omp` (oh-my-pi) writes the Pi format in `~/.omp/agent/sessions/`. Its resume flag is `--resume <session id>`.
- `gemini` (Gemini CLI) writes `~/.gemini/tmp/<project>/chats/session-*.jsonl`. Its messages change
  in place, so `cursor` and `before` are item indexes, not byte offsets. `end` is still the file
  size, and `thread.follow` sends a changed item again with the same `id`. Its resume flag is
  `--resume <session UUID>`.

## Attachments: `files.put`

Params: `{"name": "crash.log", "data_b64": "..."}`. Result: `{"path": "/home/sam/.cache/herdling/uploads/<unix-ms>-crash.log"}`.
The app puts each path on its own line at the end of the prompt, and the agent reads the file there.

- Any file type: photos, text, code, logs, PDF, JSON, CSV, zip. The file is only data. It is saved
  with mode 0600 in a 0700 folder, never with the execute bit.
- The name keeps `[A-Za-z0-9._-]` of its last path part. Other chars become `_`.
- At most 25 MiB decoded (10 MiB before documents were accepted). A larger file gives `too_large`.
- herdlingd deletes uploads older than 7 days on the next call.
- The document picker (`expo-document-picker`) is a native module. The app loads it only when the
  binary has it, so an older binary that gets new JavaScript hides "Files" in the "+" menu.

## Git views: `git.status` and `git.diff`

The app checks `hello.methods` before it calls these methods. Both take `{"cwd": "/abs/path"}` or
`{"pane_id": "..."}` (herdlingd asks herdr for the folder of the pane). herdlingd runs only read-only
git commands, with a timeout of 10 s each, with optional locks off and with no external diff,
text conversion or fsmonitor program.

`git.status` result:

```json
{"is_repo": true, "root": "/home/sam/app", "branch": "main", "head": "3f9c2ab", "upstream": "origin/main",
 "ahead": 2, "behind": 0, "truncated": false,
 "files": [{"path": "src/a.ts", "status": "M", "staged": false, "unstaged": true, "added": 4, "deleted": 1, "binary": false}]}
```

- A folder that is not in a git work tree gives `is_repo: false` and empty fields. It is not an error.
- `status` is one letter: `M` changed, `A` added, `D` deleted, `R` renamed, `C` copied, `U` conflict, `?` untracked.
- `added` and `deleted` count the staged and the unstaged lines together. They are null for a
  binary file or a large untracked file. `orig_path` is set for a renamed or copied file.
- At most 1000 files. `truncated` is true when there are more.

`git.diff` params: the folder, and `"path"?: "src/a.ts"` (relative to the repo root),
`"staged"?: true | false`. Without `staged` the diff shows the staged and the unstaged changes
together (against HEAD). An untracked `path` shows as a new file. Result:

```json
{"diff": "diff --git a/src/a.ts b/src/a.ts\n...", "truncated": false, "root": "/home/sam/app"}
```

- The diff text is at most 512 KiB, cut at a line end. `truncated` is true when it was cut.
- A binary file shows as one `Binary files a/x and b/x differ` line.
- A `path` that is absolute, has `..`, or goes out of the repo through a symbolic link gives `bad_request`.
- A folder that is not in a repo gives `not_a_repo`. No `git` program gives `not_installed`.

## New session in a worktree: `git.worktree_add`

The app checks `hello.methods` before it calls this method. It is the only git method that writes.
Params: the folder (`cwd` or `pane_id`, as above) and `"branch": "herdling/ab12cd"`. Result:

```json
{"path": "/home/sam/app/.worktrees/herdling-ab12cd", "branch": "herdling/ab12cd", "root": "/home/sam/app"}
```

- herdlingd checks the name with `git check-ref-format refs/heads/<branch>`, then runs
  `git worktree add -b <branch> <root>/.worktrees/<slug> HEAD`. The slug is the branch name with
  `/` as `-` and other unusual chars as `_`.
- It adds `/.worktrees/` to `info/exclude` of the repo once, so the main work tree does not show the folder.
- The new branch starts at HEAD. Uncommitted changes stay in the main work tree.
- Then the app starts the agent with the normal `agent.start` path, in a new workspace with
  `cwd` set to `path`. `agent.start` does not change.
- Errors: `bad_request` (not a valid branch name), `not_a_repo`, `already_exists` (the branch
  or the folder exists), `command_failed` (for example, a repo with no commits), `timeout` (60 s).

## New session: `fs.dirs` and `agents.installed`

`fs.dirs` params: `{"path"?: "~/apps", "hidden"?: false, "recent"?: true}`. `path` defaults to
home, and a leading `~` means home. Result:

```json
{"path": "/home/sam/apps", "dirs": ["api", "herdling"], "git_dirs": ["herdling"], "hidden": false,
 "recent_cwds": ["/home/sam/apps/herdling"]}
```

- `path` is the canonical folder (symbolic links resolved). `dirs` holds only folders, sorted
  without case. A missing folder gives `not_found`; a folder that cannot be read gives `io_error`.
- Since herdlingd 0.1.1: `hidden: true` also lists folders whose name starts with a dot.
  `recent: false` skips the scan of agent logs and sends an empty `recent_cwds`. The app turns
  it off while it browses and autocompletes. `git_dirs` (optional) names the entries that have
  a `.git` folder or file. `hidden` (optional) echoes the param. The app shows "Show hidden"
  only when the result has `hidden`. herdlingd 0.1.0 ignores both params.

`agents.installed` (since herdlingd 0.1.1, no params). The app checks `hello.methods` first.
Result:

```json
{"installed": ["claude", "codex"], "missing": ["gemini", "cursor"]}
```

- herdlingd looks for the program of each known agent kind (for example `cursor` is
  `cursor-agent`) in its PATH, `~/.local/bin`, `~/.cargo/bin` and the usual install folders:
  Homebrew, `/usr/local/bin`, npm, bun, pnpm, Volta, Deno, mise, asdf, and the node versions of
  nvm and fnm. herdr starts agents in the login shell, which can have a longer PATH, so the
  check can miss a program.
- A kind in neither list has no known program name. The app shows it normally.
- The app dims a missing agent and marks it "Not installed", but the user can still choose it.

## Compatibility rules

An app and a host can run different versions. Follow these rules so they do not break each other.

- Add methods and fields only.
- Never rename or remove a method or a field.
- Never change the type or the meaning of a field.
- Make every new field optional on both sides.
- Ignore unknown params and unknown fields.
- Check `hello.methods` before you use a method added after this rule. Treat a missing `methods` as "unknown": try the call and fall back.
- When you add a method, add its name to `METHODS` in `companion/src/rpc.rs` and to `APP_METHODS` in `app/src/hosts/methods.ts`.
- Also answer the new method in the demo host (`app/src/demo/DemoTransport.ts`). The demo advertises `APP_METHODS`, and its test fails when a method has no answer.

## Before an OTA update

An over-the-air update ships JavaScript only. It cannot ship native code.

1. Compare the native dependencies in `app/package.json` and the plugins in `app/app.json` with the oldest build still in use.
2. If a native module is new, ship a new build first.
3. Then send the OTA update.
