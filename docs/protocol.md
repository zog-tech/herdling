# herdlingd protocol

The app talks to `herdlingd` on each host. This page lists the rules for both sides.

## Transport

- The app opens an SSH connection with the restricted SSH key.
- The key runs `herdlingd rpc`. The command reads and writes one JSON object per line.
- A line ends with `\n`. A JSON object never contains a raw newline.
- A request line is at most 34 MiB. A longer line gets a `bad_request` error. (Before `stt.make`, the limit was 16 MiB.)
- A second channel type carries the browser preview: one exec channel per TCP connection, with
  the command `herdlingd proxy <port> <grant>`. It carries raw bytes, not JSON lines. See
  "Browser preview" below.

## Messages

- Request: `{"id": 1, "method": "name", "params": {}}`. `params` is optional.
- Response: `{"id": 1, "result": {}}` or `{"id": 1, "error": {"code": "...", "message": "..."}}`.
- Event: `{"method": "event", "params": {"stream": "...", "data": {}}}`. A streaming method sends events until the app sends `rpc.cancel`.
- The `id` is a number chosen by the app. The response carries the same `id`.
- A line that is not valid JSON gets an error with `id` null.

## Error codes in use

`bad_request`, `unknown_method`, `not_found`, `not_installed`, `io_error`, `internal`, `timeout`, `herdr_unavailable`, `upstream_error`, `command_failed`, `no_command`, `bad_output`, `automate_failed`, `too_large`, `update_unavailable`, `bad_signature`, `unsupported_target`, `checksum_mismatch`, `downgrade`, `update_in_progress`, `busy`, `managed_install`, `not_a_repo`, `already_exists`,
`unsupported_platform`, `stale`, `port_not_listening`, `grant_invalid`, `unsupported`, `download_failed`, `install_failed`,
`core_not_running`, `core_install_failed`, `bad_pin`, `install_timeout`, `dropped`.

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
- Optional `cols` and `rows` (both, or none): the phone grid. On a Herdr 2 pane, herdlingd then
  attaches as a driver, so the program lays out its output at that size. The terminal on the
  computer has this size too while the stream lives (the core has one size per terminal). The
  reply has `drive: true`. The values are clamped to 20–500 columns and 5–200 rows. herdr 1 panes
  and herdlingd before this change ignore them and give no `drive`.

### Raw terminal stream: `format: "vt"`

Since herdlingd 0.2.0 (`hello.watch_formats` lists `vt`). The app draws the pane in its own
terminal emulator (xterm.js). An older herdlingd refuses the format with `bad_request`, so the app
checks `hello.watch_formats` first.

```json
{"id": 8, "method": "pane.watch", "params": {"pane_id": "t1", "lines": 1000, "format": "vt", "interval_ms": 50}}
→ {"id": 8, "result": {"stream": "pane:3", "format": "vt"}}
→ {"method": "event", "params": {"stream": "pane:3", "data": {"vt": "reset", "gen": 1, "seq": 0, "cols": 150, "rows": 46}}}
→ {"method": "event", "params": {"stream": "pane:3", "data": {"vt": "data", "gen": 1, "seq": 1, "data": "GBtbIXAbW0gbWzJK..."}}}
```

- herdlingd forwards the bytes of `terminal.attach` with no emulator of its own. The core's first
  paint (CAN, a soft reset, `lines` history lines pushed into the scrollback, the screen, the modes,
  the cursor and the title) recreates the terminal in a fresh emulator of `cols` × `rows`.
- `reset`: a new attach (the first one, or a reattach after the core connection closed). The app
  makes a fresh emulator of that size. `data`: raw bytes in standard base64, at most 48 KiB of
  bytes per event. `resize`: the terminal size changed; a paint with no history follows.
- `seq` counts the events of one `gen` from 0. The app drops events of an older `gen`, and starts
  the watch again when it finds a gap.
- Bytes are sent at once after a quiet time, else at most once per `interval_ms`; 256 KiB of
  waiting bytes go at once.
- `cols` and `rows` drive the pane as for the other formats (the reply also has `drive: true`).
  Without them the attach is passive (`observe: true`).
- The stream is read only: herdlingd sends only CREDIT and CLOSE frames on it. The app does not
  answer device queries or mouse reports from the bytes; typing goes through `pane.send_input`.
- A core with no `terminal.attach` gives the call error `unsupported`. `error` and `closed` events
  end the stream as for the other formats.
- `pane.get` has no `scroll` field from a `vt` watch: the app reads the alternate screen from its
  own emulator.

## herdr events: `herdr.subscribe` and `events_lost`

`herdr.subscribe` streams the herdr event lines (`{"event": "...", "data": {...}}`). When herdr
closes the subscription, the stream sends `{"closed": true}` and ends. The app then subscribes
again and reads `session.snapshot`.

- herdr 0.9.2 and later send an `events_lost` error and close a subscription whose reader fell
  behind. herdlingd does not forward that error line. It ends the stream with `{"closed": true}`,
  also when only a status connection of the stream lost events. So an app of any version reloads
  the snapshot and subscribes again.
- `herdlingd serve` subscribes again at once and reads a fresh `session.snapshot`. It compares the
  snapshot with the statuses it knew, so a status change in the lost events still gives its push.
  Pending pushes stay. An older herdr never sends `events_lost`, so nothing changes there.

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
{"id": 9, "method": "pane.answer", "params": {"pane_id": "w1:p2", "key": "1", "expect_label": "Yes", "expect_question": "3f9a0c4e1b2d7a65"}}
→ {"id": 9, "result": {"answered": true}}
→ {"id": 9, "error": {"code": "stale", "message": "the menu changed"}}
```

- herdlingd reads the visible screen (herdr `pane.read`, source `visible`) and finds the permission
  menu with the same rules as the app (`companion/src/choices.rs`, `app/src/thread/parseChoices.ts`).
- herdlingd sends the key (herdr `pane.send_keys [key]`) only when the agent still waits
  (`agent_status` `blocked`) and the option at `key` still has `expect_label`. A label cut for a
  push (60 characters, ends with "…") also matches. Otherwise the error is `stale` and no key is sent.
  A closed pane also gives `stale`.
- `expect_question` is optional: the `choice.question` of the push. When it is set, the question of
  the menu on the screen must also give the same digest, else the error is `stale` ("the question
  changed"). So a stale push cannot answer a later prompt that has the same labels. A value that is
  not a string gives `bad_request`. An app that sends no `expect_question` gets the label check only.
  An older herdlingd ignores the field.
- `key` must be one digit from 1 to 9, else `bad_request`. The answer is phone input, and it keeps
  the order of the other typing calls to the pane.
- `push.register` takes an optional `capabilities: string[]` (at most 16 strings of at most 64
  characters). The app sends `["choice_actions"]` only to a host whose `hello.methods` has
  `pane.answer`. herdlingd saves the list per device. A register without the field clears it.
- To a device with `choice_actions`, a "needs you" push gets `categoryId: "herdling_choice"` and
  `data.choice`, when the first option starts with the word "Yes" and the last with the word "No":

  ```json
  {"hostId": "h_1", "paneId": "w1:p2",
   "choice": {"yes": {"key": "1", "label": "Yes"}, "no": {"key": "3", "label": "No, and tell Claude what to do differently (esc)"},
              "revision": 0, "question": "3f9a0c4e1b2d7a65"}}
  ```

  Labels have at most 60 characters. The push has no question text: it passes Expo and Apple or Google.
  `question` (newer herdlingd) is 16 hex characters: the first 8 bytes of a SHA-256 of up to 8 non-empty
  lines above the menu and the menu lines, with box edges, the selection marker and extra white space
  removed (`menu_question` in `companion/src/choices.rs`). It is not the text. The app sends it back as
  `expect_question`. A screen change above the menu can give a false `stale`; that is safe.
  The push body adds a line with the two labels ("Yes · No, and tell Claude…"). Other devices get the push as before.
- The app registers the category `herdling_choice` with the actions `choice_yes` ("Yes") and
  `choice_no` ("No", destructive). Both open the app and need Face ID or the passcode on a locked
  phone. The app then connects, opens the session and calls `pane.answer`.

## How a push shows: `push.register` presentation prefs

`push.register` `prefs` has three optional flags for the look of a push. Each one is per device.

| Pref | Push field | On (the default) | Off |
|---|---|---|---|
| `replace` | `collapseId` and `tag` | A new push replaces the shown push of the same pane | Each event is a new notification |
| `group` | `threadId` | iOS groups the notifications of one computer | No `threadId` |
| `quiet_finished` | `interruptionLevel`, `sound` | A "finished" push is `passive` and has no `sound` | `sound: "default"`, no `interruptionLevel` |

- The id is `herdling:<host_id>:<pane_id>` for `collapseId` and `tag`, and `herdling:<host_id>` for
  `threadId`. `host_id` is the id that the app sent in `push.register`. An id longer than 64 bytes
  (the APNs limit) becomes `herdling:` and 32 hex digits of its SHA-256.
- `collapseId` replaces a shown notification on iOS. On Android it only joins pushes that wait for
  delivery, so herdlingd also sends `tag`, which replaces a shown notification on Android.
- A "needs you" push always has `interruptionLevel: "time-sensitive"` and `sound: "default"`. iOS
  uses `time-sensitive` only when the app has the Time Sensitive entitlement. Without it, iOS uses `active`.
- `threadId`, `interruptionLevel` and `sound` have an effect on iOS only.
- An app that does not send a flag keeps the saved value, else `true`. An older herdlingd ignores
  the flags and sends the push as before.
- The app removes the shown notifications of a pane when the user opens its session, and after an
  answer from the Yes and No buttons. It matches `data.hostId` and `data.paneId`.

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

From the herdlingd after 0.1.9, the result has an optional `core` part: the herdr 1 guard for a
release that needs Herdr 2 (herdr-core). Show `notice` before the update.

```json
{"core": {"requires_core": true, "installed": false, "herdr1": true, "install_first": true, "pinned": "0.1.20", "notice": "This herdlingd works only with Herdr 2 ..."}}
```

- `requires_core`: the release manifest says `requires_core: true`. Older manifests do not.
- `installed`: a `herdr-core` is on the computer. `herdr1`: a `herdr` is on the computer.
- `install_first`: `update.apply` installs herdr-core before it replaces herdlingd.
- `pinned`: the herdr-core version that the update installs (the `core` pin of the release, else
  the pin of the running herdlingd).

`update.apply` params: `{"version"?: "X.Y.Z", "allow_downgrade"?: false}`. Result:

```json
{"from": "0.1.0", "to": "0.2.0", "status": "updated", "service_restarted": true}
```

- `status` is `"updated"` or `"up_to_date"`. With `up_to_date` nothing changes.
- The method downloads `latest.json` and `latest.json.sig` of the release and checks the Ed25519
  signature of the release key over the exact bytes of `latest.json` (from herdlingd 0.1.7).
  Then it downloads the tarball for this computer, checks its SHA-256 against the release
  manifest, and replaces the running executable with one rename. Then it restarts the user
  service (launchd or systemd), if it is installed. `service_restarted` is false when there is no
  service or the restart failed.
- The rpc process keeps the old code until its channel closes. After the reply the app
  reconnects; the new channel runs the new binary, and `hello` shows the new version.
- The download can take some time. Use a long timeout (the app uses 3 minutes).
- When the manifest says `requires_core: true`, the method first runs `core.install` with the
  `core` pin of the manifest (see "Herdr 2 install"). The result then has `core` (a `CoreInstall`)
  and, for a computer with herdr 1 and no core, `notice`. When the core install fails, the method
  stops with `core_install_failed`, before it downloads herdlingd: the old herdlingd stays.

The release manifest (`latest.json`) can have two optional fields, from the herdlingd after 0.1.9:
`requires_core` (boolean) and `core` (the herdr-core pin: `version`, `required` and `sha256` by
target, a copy of `companion/core-pin.json`). The release key signs them with the rest of the file.
An older herdlingd ignores them.

Error codes:

| Code | Meaning |
|---|---|
| `update_unavailable` | The release or the manifest could not be read, a download URL is not a release URL of the project, or updates are off in this process |
| `bad_signature` | `latest.json.sig` is missing, or it is not a valid signature of a release key over `latest.json`. Nothing changed. `update.check` gives it too. From herdlingd 0.1.7 |
| `unsupported_target` | No release build for this OS and CPU |
| `checksum_mismatch` | The download does not match the SHA-256 of the release. Nothing changed |
| `downgrade` | The release is older than the running version and `allow_downgrade` is not true. An old release keeps its valid signature, so `allow_downgrade` is the choice of the user |
| `update_in_progress` | Another update runs now |
| `io_error` | The binary could not be unpacked or replaced (for example, the folder is not writable) |
| `bad_request` | `version` is not a version text |
| `core_install_failed` | The release needs herdr-core, and its install failed. The message has the reason. herdlingd did not change |

## Update herdr: `herdr.update`

From the next herdlingd release, the app can update herdr (herdr 1) on the computer. The app
checks `hello.methods` for `herdr.update` before it shows the action. `hello.herdr_version` is the
version of the running herdr server.

`herdr.update` has no params. The phone sends no command text. herdlingd runs exactly
`<herdr> update --handoff`, without a shell:

- herdlingd finds `herdr` in each `PATH` entry, then in `~/.local/bin`, `~/.cargo/bin`,
  `/opt/homebrew/bin` and `/usr/local/bin`. sshd gives a forced command a short `PATH`.
- `herdr update` refuses to run inside a herdr session. The child thus gets no `HERDR_*`
  variable, except the install settings `HERDR_HOME`, `HERDR_CONFIG_PATH`, `HERDR_INSTALL_DIR`
  and `HERDR_CHANNEL`. This removes `HERDR_ENV`, `HERDR_SESSION`, `HERDR_PANE_ID`,
  `HERDR_SOCKET_PATH` and the other session markers.
- `--handoff` makes herdr try a live handoff: the new server takes the panes and their processes
  keep running. If the handoff fails before its commit step, herdr keeps the old server.
- One update runs at a time (the lock file `herdr-update.lock` in the herdlingd config folder).
  The run stops after 180 seconds. The app waits 3 minutes.

Result:

```json
{"from": "0.9.5", "to": "0.9.6", "status": "updated", "handoff": "complete", "output": "..."}
```

- `from` and `to` come from `herdr --version` before and after the update. Each can be `null`.
- `status` is `"up_to_date"` when herdr says so or when `from` equals `to`. Otherwise `"updated"`.
- `handoff` is `"complete"` only when herdr prints "live handoff complete". It is `"failed"` when
  herdr prints that the handoff failed, and `"none"` when herdr prints no handoff line. Only
  `"complete"` tells that the sessions kept running.
- `output` is stdout and then stderr of `herdr update`, at most the last 16 KiB.
- After the update the app reconnects, so `hello.herdr_version` shows the running server.

Error codes:

| Code | Meaning |
|---|---|
| `not_installed` | No `herdr` binary in the searched folders |
| `busy` | Another herdr update runs now |
| `managed_install` | herdr says that Homebrew, mise or Nix owns the install. Update it with that tool |
| `command_failed` | `herdr update` did not start or exited with an error. The message has the end of its output |
| `timeout` | `herdr update` ran longer than 180 seconds and herdlingd stopped it |
| `update_unavailable` | herdr updates are off in this process |

**herdlingd 0.2.0:** the herdr 1 path above is gone. `herdr.update` always updates herdr-core
to the pin (never down), as `core.install` does. Without an install context the code is
`update_unavailable`. The text below tells the result.

On a computer with herdr-core and no herdr 1 (from the herdlingd after 0.1.9), `herdr.update`
updates herdr-core to the pin, as `core.install` does, and gives the result in the same shape:
`status` `"updated"` when the core was installed or updated, else `"up_to_date"`; `handoff`
`"complete"` after an update (the new core takes over the running terminals), else `"none"`;
`output` is one line about the core. The errors are the ones of `core.install`.

## Herdr 2 install: `core.status` and `core.install`

From the herdlingd after 0.1.9. Check `hello.methods` first. herdlingd installs herdr-core
(Herdr 2) itself, with the version and the SHA-256 that the herdlingd release pins
(`companion/core-pin.json`, signed with the binary). It does not run the upstream `install.sh`.

`core.status` has no params. It only reads: it runs `herdr-core --version` and asks the core socket.

```json
{"found": true, "installed": "0.1.19", "managed": false, "running": true, "running_version": "0.1.19",
 "pinned": "0.1.20", "newer_than_pin": false, "update_available": true, "required": false,
 "target": "macos-aarch64", "herdr1": true}
```

- `found` and `installed`: a `herdr-core` in `~/.local/bin`, else in the `PATH` and the usual
  folders. `installed` is null when it gives no version.
- `managed`: the core is not in `~/.local/bin` (Homebrew, Nix, conda). herdlingd never replaces it.
- `newer_than_pin`: the installed or the running core is newer than `pinned`. herdlingd keeps it
  and works with it (the Herdr app updates the core too).
- `update_available`: `core.install` would install or update the core.
- `required`: this herdlingd needs the core. The installer then installs the core and does not
  need herdr 1.
- `target`: the upstream build of this computer, null when there is none.

`core.install` has no params. Result:

```json
{"from": "0.1.19", "to": "0.1.20", "status": "updated", "started": false, "pinned": "0.1.20"}
```

The steps (a pure state machine in `companion/src/core_install/machine.rs`):

1. Find the core and its version. A core of a package manager, a core newer than the pin and a
   core with no version stay as they are (`kept_managed`, `kept_newer`, `kept_unknown`). The pin
   (`up_to_date`) stays too. herdlingd never downgrades.
2. Else download `https://releases.herdr.dev/core/<pin>/herdr-core-<target>.tar.gz` into
   `~/.cache/herdling/core.<pid>` and compare its SHA-256 with the pin. A difference stops with
   `checksum_mismatch`; nothing outside that folder changes.
3. Unpack it. The unpacked `herdr-core --version` must say the pinned version.
4. Put it in place as the upstream installer does. macOS: `Herdr Core.app` with
   `--hc-install-bundle` to `~/.local/bin/herdr-core`, then `server restart` on an update. Linux
   (and macOS with no app in the tarball): an update runs `herdr-core update --from <file>`
   (running terminals keep running); a first install copies the file. A `~/.local/bin/hc` link is
   added when no `hc` exists.
5. Make sure that the core runs: when no core answers on the socket, run `herdr-core server
   start` and wait up to 10 seconds. The core runs as its own service (a systemd user service on
   Linux, a launchd job on macOS). `started` is true when herdlingd started it.

`status` is `installed`, `updated`, `up_to_date`, `kept_newer`, `kept_unknown` or `kept_managed`.
One install runs at a time (`core-install.lock` in the herdlingd config folder). Use a long timeout
(3 minutes). Since 0.2.0 the whole install ends within 150 seconds (`install_timeout`), so the
answer always comes before that timeout. herdlingd starts the place step only with at least 60
seconds left, so a place is never cut off.

- A `~/.local/bin/herdr-core` that is a symlink counts as the core of herdlingd only when it
  points into `~/.local/share/herdr-core` (the upstream app bundle install). Any other link
  (Homebrew, Nix, a link of the user) is `managed`, also when its target is gone.

Error codes:

| Code | Meaning |
|---|---|
| `unsupported` | The core install is off in this process |
| `unsupported_target` | herdr-core has no build for this OS and CPU |
| `download_failed` | The download failed |
| `checksum_mismatch` | The download does not match the pinned SHA-256. Nothing was installed |
| `install_failed` | The tarball, the unpacked core or the install step failed |
| `core_not_running` | The core did not start, or it does not answer on its socket |
| `busy` | Another core install runs now |
| `bad_pin` | The pin is not valid |
| `install_timeout` | The install used its 150 seconds. The message says whether the core was put in place |

`herdlingd core status`, `herdlingd core install` and `herdlingd core required` do the same on the
computer. `core required` exits with 0 when this herdlingd needs the core (the installer reads it).

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

## File viewer: `files.get`

Since herdlingd 0.2.1. The app checks `hello.methods` first: a path in the thread is a link only
when the host lists `files.get`. The method only reads. Params:

```json
{"path": "src/content/", "cwd"?: "/home/sam/proj", "pane_id"?: "t3", "hidden"?: false, "offset"?: 0}
```

- `path` is absolute, `~` or `~/…` (from the home folder), or relative. A relative path starts at
  `cwd` (absolute, or `~/…`), else at the folder of `pane_id` (from the core). A relative path with
  neither gives `bad_request`. A `~name/…` path gives `bad_request`.
- herdlingd resolves symbolic links. `path` in the result is the canonical path. `name` is its
  last part.

The result has one of four kinds:

```json
{"path": "/home/sam/proj/docs", "name": "docs", "kind": "dir", "hidden": false, "truncated": false,
 "entries": [{"name": "screens", "kind": "dir"}, {"name": "home-dark.png", "kind": "image", "size": 48213},
             {"name": "README.md", "kind": "file", "size": 912}]}
{"path": "/home/sam/proj/a.png", "name": "a.png", "kind": "image", "size": 48213, "mime": "image/png",
 "offset": 0, "data_b64": "iVBORw0K...", "eof": true}
{"path": "/home/sam/proj/README.md", "name": "README.md", "kind": "text", "size": 912, "text": "# proj\n...", "truncated": false}
{"path": "/home/sam/proj/doc.pdf", "name": "doc.pdf", "kind": "other", "size": 80211, "mime": "application/pdf"}
```

- `dir`: folders first, then files, each sorted without case. Entry `kind` comes from the name
  (`dir`, `image` or `file`): herdlingd does not open the files. `size` is missing for a folder
  and for a broken link. Names that start with a dot show only with `hidden: true`. At most 1000
  entries; `truncated` is true when the folder has more. Names that are not UTF-8 are left out.
- `image`: a name that ends in `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.heic`, `.heif` or
  `.bmp`. herdlingd sends at most 384 KiB of bytes from `offset` (default 0) in standard base64.
  `eof` is true for the last part. The app asks again with the next `offset` until `eof`. The part
  size is a multiple of 3, so the base64 parts join as text. An image larger than 20 MiB has
  `"too_large": true` and no `data_b64`.
- `text`: the first 8 KiB have no NUL byte and are valid UTF-8. `text` holds at most the first
  256 KiB, cut on a character boundary. `truncated` is true when the file is longer.
- `other`: any other file, and a FIFO, a socket or a device (herdlingd never reads those). `mime`
  is set when herdlingd knows the type from the name.
- Errors: `not_found` (no such path), `io_error` (for example no permission), `bad_request`.
- An older herdlingd gives `unknown_method`. The app shows paths as plain code then.

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
{"path": "/home/sam/app/.worktrees/herdling-ab12cd", "branch": "herdling/ab12cd", "root": "/home/sam/app",
 "via": "herdr", "workspace_id": "w7", "tab_id": "w7:t1", "pane_id": "w7:p1"}
```

- herdlingd checks the name with `git check-ref-format refs/heads/<branch>`. The branch and the
  folder `<root>/.worktrees/<slug>` must not exist. The slug is the branch name with `/` as `-`
  and other unusual chars as `_`.
- When herdr has `worktree.create` (herdr 0.9 and later), herdlingd sends it only the checked
  values: `{"cwd": <root>, "branch", "path": <root>/.worktrees/<slug>, "base": "HEAD", "focus": false}`.
  herdr makes the worktree and opens it as a new workspace in the worktree group of the repo.
  The result then has `"via": "herdr"` and the ids of that workspace, its tab and its root pane.
- Otherwise herdlingd runs `git worktree add -b <branch> <root>/.worktrees/<slug> HEAD`, and the
  result has `"via": "git"` and no ids. This happens when herdr does not run, when herdr does not
  know `worktree.create` (`invalid_request` "unknown variant" or `unknown_method`), or when herdr
  refuses the folder as a source (`linked_worktree_source`, `not_git_worktree`: for example a
  folder in a linked worktree). herdlingd keeps the "unknown method" answer for the life of the
  `rpc` process. Other herdr errors come back as they are, and herdlingd does not try git.
- An older herdlingd sends only `path`, `branch` and `root`.
- It adds `/.worktrees/` to `info/exclude` of the repo once, so the main work tree does not show the folder.
- The new branch starts at HEAD. Uncommitted changes stay in the main work tree.
- With `pane_id` in the result, the app starts the agent (or the shell) in that pane: no second
  workspace opens. Without it, the app starts the agent with the normal `agent.start` path, in a
  new workspace with `cwd` set to `path`. `agent.start` does not change.
- Errors: `bad_request` (not a valid branch name), `not_a_repo`, `already_exists` (the branch
  or the folder exists), `command_failed` (for example, a repo with no commits), `timeout` (60 s
  for git), `herdr_unavailable` (no herdr answer in 75 s), or a herdr error code.
- herdr lists the worktrees of a repo with its own `worktree.list`. The app can call it through
  `herdr.call`, so herdlingd has no separate method for it.

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

## Browser preview: `ports.list`, `preview.open`, `preview.close` and the proxy channel

The app opens a dev server of the computer (for example `localhost:5173`) in a web view. The
phone key line has `restrict` (older herdlingd versions wrote `no-port-forwarding`), so the app
does not use SSH port forwarding. The app
checks `hello.methods` for `preview.open` before it shows "Preview".

`ports.list` params: `{"pane_id"?: "w1:p2"}`. Result:

```json
{"ports": [{"port": 5173, "addr": "::1", "pid": 4411, "process": "node", "cmd": "vite", "pane_id": "w1:p2"},
           {"port": 3000, "addr": "127.0.0.1", "pid": 3900, "process": "node", "cmd": "next-server"}]}
```

- Only TCP listeners of the same user, on loopback (`127.0.0.0/8`, `::1`) or on all addresses
  (`0.0.0.0`, `::`). One item per port. The pairing port of `serve` is never in the list.
- macOS reads `lsof`. Linux reads `/proc/net/tcp`, `/proc/net/tcp6` and `/proc/<pid>/fd`. No root.
- With `pane_id`, herdlingd asks herdr for `pane.process_info` and marks the ports of the processes
  under the pane's shell. These ports come first, then the other ports by number.
- herdlingd keeps the listener list for 5 s, because `lsof` can be slow.

`preview.open` params: `{"port": 5173}`. Result: `{"grant": "<32 hex>", "port": 5173, "expires_at": 1767225600}`.

- herdlingd checks that a process of the same user listens on the port on loopback or on all
  addresses. If not, the error is `port_not_listening`. The pairing port gives `bad_request`.
- The grant goes to `~/.local/state/herdling/preview-grants.json` (folder 0700, file 0600, atomic
  rename). It expires 30 minutes after the last proxy connection. At most 16 grants are live.
- The grant also records the loopback address of the listener that herdlingd found (field `addr`
  in the grant file): the address itself, `127.0.0.1` for `0.0.0.0` or `::1` for `::`. When the
  user listens on both families, IPv4 comes first. A grant file of an older herdlingd has no
  `addr`; the first proxy connection picks the address from the listeners of the user and records it.

`preview.close` params: `{"grant": "<32 hex>"}`. Result: `{"closed": true}`, or `false` when the
grant was not live. A grant that is not 32 lowercase hex characters gives `grant_invalid`.

The proxy channel:

- For each TCP connection of the web view, the app opens a new exec channel on the open SSH
  connection. The command is the host command with the last word `rpc` replaced by
  `proxy <port> <grant>`, for example `herdlingd proxy 5173 <grant>`.
- With the phone key, sshd runs the forced command `herdlingd rpc` and puts the requested command
  in `SSH_ORIGINAL_COMMAND`. `herdlingd rpc` changes to the proxy mode only when that text is exactly
  `<path>herdlingd proxy <port> <grant>` (port 1–65535, grant 32 lowercase hex characters). Any
  other text starts the normal RPC loop. herdlingd never gives the text to a shell.
- A host without a forced command runs the same command in the user's shell: `herdlingd proxy`
  is also a subcommand. Both paths run the same code.
- The proxy checks the grant and the port. Then it reads the listeners of the same user again and
  checks that one of them is on the port and reaches the address of the grant. If not (the dev
  server stopped, or only another user listens there), it refuses and does not extend the grant.
  Then it connects only to the address of the grant, never to another address. Another user on the
  same computer can bind `127.0.0.1:<port>` while the dev server listens only on `[::1]:<port>`, so
  the proxy does not try the other family. Then it copies bytes both ways until one side closes.
  A refusal writes one line to stderr and ends the channel with exit code 2.
- Each accepted connection extends the grant by 30 minutes.
- An older herdlingd does not know the proxy request and starts the RPC loop. The app does not
  send it unless `hello.methods` has `preview.open`.

On the phone, the native ssh module listens on `127.0.0.1` only, while the preview screen is
open. It first tries the same port number as on the computer, so the page origin is the same as
at the desk. Each connection must send the cookie `herdling_preview=<random 128-bit value>`; the
app puts it in the web view cookie store with `SameSite=Strict` (newer native builds), so a
request that a remote page starts does not carry it. The in-app browser for remote pages does
not share the cookie: on iOS it uses a separate store that is not saved to disk, and on Android it
does not accept third-party cookies. A connection without the cookie gets `403`. At most 6 proxy
channels run at once per host; more connections wait. When a channel does not open on the
first SSH connection (for example sshd `MaxSessions`), the module opens a second SSH connection
for the preview.

## Device mirror: `devices.list`, `mirror.start` and `mirror.stop`

The app shows an iOS simulator or an Android emulator of the computer as video, and sends touches,
keys and text back. The page comes through the browser preview tunnel above. The design is in
`docs/superpowers/specs/2026-11-20-device-mirror-design.md`. The app checks `hello.methods` for
`devices.list` and `mirror.start`, and the build for the web view and the preview tunnel.

`devices.list` params: none. Result:

```json
{"devices": [
   {"id": "ios:269EBED9-ADE0-4AF4-9067-6B649B12BCCB", "platform": "ios", "kind": "simulator",
    "name": "iPhone 17", "os": "iOS 26.5", "model": "iPhone-17", "video": true, "input": true},
   {"id": "android:emulator-5554", "platform": "android", "kind": "emulator", "name": "Pixel 8",
    "os": "Android 15", "model": "Pixel_8", "video": true, "input": true, "mirroring": true},
   {"id": "android:192.0.2.10:5555", "platform": "android", "kind": "device", "name": "Fire TV",
    "model": "Fire TV", "video": true, "input": true}],
 "tools": {"xcrun": true, "idb": true, "idb_companion": true, "adb": true},
 "scrcpy": "5.0.1"}
```

- iOS: the booted simulators of `xcrun simctl list devices booted -j` (macOS only). `video` and
  `input` are true when `idb` is found.
- Android: the ready devices of `adb devices -l`. A serial `emulator-<port>` is an emulator; herdlingd
  asks it for its AVD name (`adb emu avd name`) and its Android version. Any other serial is a real
  device (`kind: "device"`): herdlingd sends it no command, and the app does not offer it.
- herdlingd looks for the tools in `PATH`, `$ANDROID_HOME/platform-tools`,
  `$ANDROID_SDK_ROOT/platform-tools`, `~/Library/Android/sdk/platform-tools`,
  `~/Android/Sdk/platform-tools`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` and `/usr/bin`.
- `mirroring` is true when this rpc process runs a mirror of the device.

`mirror.start` params: `{"device": "<id>", "allow_device"?: false, "max_size"?: 1280}`. Result:

```json
{"device": "android:emulator-5554", "platform": "android", "name": "Pixel 8", "port": 50271,
 "path": "/m/<32 hex>/", "grant": "<32 hex>", "expires_at": 1767225600,
 "source": "video", "input": true}
```

- herdlingd lists the devices again and refuses an id that is not there (`not_found`). A real
  device needs `allow_device: true` (`unsupported`). A missing `xcrun` or `adb` gives
  `not_installed`. `max_size` (320 to 4096) is the longest video edge of Android.
- One mirror per device in each rpc process. A second call for the same device returns the same
  `port` and `path` with a new grant.
- The mirror server listens on `127.0.0.1:<port>`. `grant` is a preview grant for that port, as
  from `preview.open`. The app starts the preview tunnel with it and loads
  `http://localhost:<local port><path>`.
- `source` is the first choice (`video`, or `screenshots` without idb). The page can still move to
  screenshots (below).

`mirror.stop` params: `{"device": "<id>"}`. Result: `{"stopped": true}`, or `false` when no mirror
of the device ran. The app also calls `preview.close` with the grant.

The mirror server:

- Only two paths answer: `GET /m/<token>/` (the player page) and `GET /m/<token>/ws` (the WebSocket).
  The token is 128 random bits; any other path gets `404`. The `Host` header must be `localhost`,
  `127.0.0.1` or `[::1]` (with a port), else `403`. The WebSocket upgrade must have
  `Origin: http://<Host>`, else `403`.
- The page is one HTML file in the herdlingd binary. It makes no request to another host. Its
  Content Security Policy allows inline code and connections to the page host only.
- `ws?video=1`: the page can decode H.264 with WebCodecs. `video=0` moves the mirror to screenshots.
- Server to page, binary: byte 0 is the kind (`1` H.264 access unit in Annex B, `2` JPEG, `3` PNG),
  byte 1 the flags (bit 0: key frame), then the payload. A key frame carries the SPS and PPS.
- Server to page, text: `{"type":"state","state":"waiting"|"starting"|"streaming"|"stopped","source":"video"|"screenshots","input":true,"platform":"ios","name":"..."}`
  and `{"type":"error","message":"..."}`.
- Page to server, text: `{"t":"touch","phase":"down"|"move"|"up"|"cancel","x":0.5,"y":0.25}`
  (fractions of the frame), `{"t":"key","key":"home"|"back"|"app_switch"|"power"|"volume_up"|"volume_down"|"lock"|"siri"}`,
  `{"t":"text","text":"..."}` (at most 1000 characters), `{"t":"rotate"}` (Android) and
  `{"t":"keyframe"}` (the decoder needs a key frame). Other messages are ignored.
- The app sends `key`, `text` and `rotate` to the page with `postMessage`, as the same JSON text.
  The page posts `{"type":"mirror","state":...,"source":...,"input":...,"platform":...,"error"?:...}`.

Sources:

- Android: the scrcpy server, version and SHA-256 in `companion/scrcpy-pin.json`, from the official
  GitHub release into `~/.local/share/herdling/scrcpy-server-v<version>` (checked before each use).
  herdlingd pushes it to `/data/local/tmp/herdling-scrcpy.jar`, adds `adb forward tcp:0
  localabstract:scrcpy_<scid>`, and runs `app_process` with `tunnel_forward=true audio=false
  control=true video_codec=h264 send_device_meta=false clipboard_autosync=false cleanup=true`.
  Input goes over the scrcpy control socket. When scrcpy does not start, screenshots
  (`adb exec-out screencap -p`) and `adb shell input` take over.
- iOS: `idb video-stream --format h264` and `idb ui tap|swipe|text|button`. idb takes points: the
  scale comes from `idb describe --json`. When the video does not start, screenshots
  (`xcrun simctl io <udid> screenshot`) take over, with idb input. An idb error "Failed to connect
  to companion" gets one `idb disconnect <udid>` and one retry. Without idb, screenshots and view only.
- The source starts when the first viewer connects and stops 10 s after the last viewer leaves.
  The server closes after 5 minutes with no viewer, on `mirror.stop`, and when the rpc process ends.
- `ports.list` leaves out the listeners of `herdlingd` itself, so a mirror server does not show as a
  dev server.

## Command finished: `shell.watch`, `shell.unwatch` and `shell.watches`

Since the herdlingd that lists `shell.watch`. The user asks for one push when the command in a
shell pane finishes ("Notify me when it finishes" in the session menu of a terminal and in the
Run sheet). The app shows the option only when `hello.methods` has `shell.watch`.

```json
{"id": 1, "method": "shell.watch", "params": {"pane_id": "w1:p2", "device_id": "d_1"}}
→ {"id": 1, "result": {"pane_id": "w1:p2", "since": 1767225600, "expires_at": 1767312000, "busy": false}}
{"id": 2, "method": "shell.unwatch", "params": {"pane_id": "w1:p2"}}
→ {"id": 2, "result": {"removed": true}}
{"id": 3, "method": "shell.watches"}
→ {"id": 3, "result": {"watches": [{"pane_id": "w1:p2", "since": 1767225600, "expires_at": 1767312000, "busy": true}]}}
```

- `pane_id` is 1 to 256 bytes, else `bad_request`. `device_id` is optional: with it, only that
  device gets the push. Without it, every device with a push token gets it.
- A new `shell.watch` of the same pane replaces the old watch. At most 32 watches are live; a new
  watch drops the oldest. A watch expires 24 hours after `since`.
- The watches go to `~/.local/state/herdling/shell-watches.json` (folder 0700, file 0600, a lock
  file and an atomic rename), because each SSH channel runs its own `rpc` process.
- `serve` asks herdr for `pane.process_info` of each watched pane every 3 seconds. The pane is busy
  when `foreground_process_group_id` is not `shell_pid`, and idle when it is the same.
  `busy: true` means that `serve` saw the pane busy.
- herdr has no event for a foreground process change. Many shells set the terminal title when a
  command starts and ends, and herdr then sends `pane.updated`. For a watched pane, `serve` also
  checks 150 ms after that event (at most one check in 500 ms). The push then comes at once,
  not up to 3 seconds later. A shell that does not set the title gets the 3-second checks only.
- When a pane goes from busy to idle, `serve` removes the watch and sends one push. A pane that is
  idle and was never seen busy keeps its watch. A command that ends before the first check that
  sees it busy sends no push. With the 3-second checks only, this can occur for a command
  shorter than 3 seconds. A new watch is known to the early check only after the next 3-second
  check.
- herdr `pane_not_found` removes the watch with no push. Other herdr errors keep the watch.
- The push title is `<folder tail>: command finished` (the pane's `cwd` in the snapshot, else the
  folder of the process, else `Terminal`). The body is the command line of the foreground
  process at the last busy check, on one line, at most 80 characters.
- The push has `sound: "default"` and `data: {"hostId", "paneId", "kind": "shell"}`. The device
  prefs `finished` and `needs_you` do not apply, because the user asked for this push.
  `quiet_at_desk`, `replace` and `group` apply as for an agent push.
- A tap on the push opens the terminal of the pane (`kind: "shell"` adds `shell=1` to the route).
- An older app ignores `kind` and opens the session of the pane as before.

## Background work: `agents.preview` `background`

An `agents.preview` item has the optional field `background` (since this version, Claude Code
panes only). It lists the background work that still runs after the agent's turn ended:

```json
{"pane_id": "p1", "source": "log", "status_since": 1767225600,
 "background": {"count": 2, "commands": ["npm run dev", "sleep 30"], "agents": 1}}
```

- `count`: the running background shells. `commands`: their commands, newest first, one line each,
  at most 3 of 40 chars. `agents`: the running background subagents (missing means 0).
- The field is missing when nothing runs. An older herdlingd never sends it, and an older app
  ignores it.
- The app shows an agent that would be in "Idle" as "Background" while the field is present.
  "Needs you", "Ready" and "Working" come first. No push goes out when background work starts or ends.

herdlingd reads the Claude log (the last 8 MiB on the first read, then only new lines):

- A shell starts when a `Bash` result has `toolUseResult.backgroundTaskId` ("Command running in
  background with ID: <id>", or a command moved to the background). A subagent starts when an
  `Agent` result has `toolUseResult.status` `async_launched` and an `agentId`.
- A task ends with a `<task-notification>` that names its `<task-id>` (in a `queue-operation` line,
  a `queued_command` attachment or a user line), or with a successful `TaskStop` (older: `KillShell`).
- A task ends when it is older than 12 hours, or when it started before the Claude process of the
  pane (the agent started again). A new log (for example after `/clear`) starts with no tasks.

## Suggested computers: `machines.suggest`

Params: none. Result: `{suggestions: [{name, address, user?, port?, sources, online?}]}`. Read
only. The app shows the list in Add computer, so the user can add more computers after the first.
herdlingd reads three sources; a source that is missing or fails gives no entries:

- `core`: the herdr-core `machine.list`. The `target` `[user@]host[:port]` gives the address,
  user and port. A `via` target is a command, so only the machine's host name is used.
  `online` is true when the machine is `connected`.
- `ssh_config`: the `Host` entries of `~/.ssh/config` (at most 256 KiB). Patterns (`*`, `?`,
  `!`), `Match` blocks and `Include` are skipped. Entries with `ProxyJump` or `ProxyCommand` are
  skipped: the phone cannot use them. Only `HostName`, `User` and `Port` are read.
- `tailscale`: the peers of `tailscale status --json` (3 seconds at most). The address is the
  MagicDNS name, else the first IPv4 address. `online` is the peer's state.

The same address (any case) is one entry with joined `sources`. The computer itself is left out.
The result never holds keys, key paths or other values of the SSH config.

## Pairing: `POST /pair` and pairing v2

`herdlingd serve` has a small HTTP endpoint on the pairing port (default 7790) for the first
contact. It works only while `herdlingd pair` has a pairing window open (5 minutes, one 6-digit
code, at most 5 tries). All bodies are JSON. An error is `{"error": "<code>"}` with the codes
`bad_request` (400), `bad_code` (403), `no_window` (410), `no_session` (410),
`too_many_attempts` (429) and `internal` (500).

### Pairing v2 (CPace)

Pairing v2 uses the code as the password of a PAKE, so the code never goes over the network.
A device that sees or relays the traffic cannot test codes offline. It can only guess online,
and each guess uses one of the 5 tries. The phone proves the code over its public key, so a relay
cannot enroll its own key. The host proves the code over the host fields, so a fake host fails.

The PAKE is CPace with ristretto255 and SHA-512 (CPACE-RISTR255-SHA512) in the
initiator-responder setting, as in draft-irtf-cfrg-cpace-21. The phone is party A, the host is
party B. Code: `companion/src/cpace.rs`, `companion/src/pair_v2.rs`, `app/src/pairing/cpace.ts`
and `app/src/pairing/pairV2.ts`. Both sides check the vectors in
`protocol/fixtures/cpace-ristretto255.json`: the draft vectors and one full Herdling exchange.

CPace inputs:

| Input | Value |
|---|---|
| PRS | The 6 ASCII digits of the code |
| CI | `herdling-pair-v2` |
| sid | `sid`: 16 random bytes from the phone |
| ADa | The UTF-8 `device_id` |
| ADb | `session`: 16 random bytes from the host |

The phone sends Ya before it knows any host value, so the host's random value cannot go into
`sid`. It goes into ADb and so into the key (ISK). Scalars are 32 random bytes with the bits above
bit 252 cleared (draft section 8.3). Each side aborts when the other message does not decode or
gives the identity element.

Keys and tags (`lv_cat` is the length-value encoding of the draft, HMAC is HMAC-SHA-512):

```
ISK     = SHA-512(lv_cat("CPaceRistretto255_ISK", sid, K) || lv_cat(Ya, ADa) || lv_cat(Yb, ADb))
mac_key = SHA-512("CPaceMac" || sid || ISK)
tag_a   = HMAC(mac_key, lv_cat("herdling-pair-v2/a", Ya, ADa, device_name, host_id, public_key))
tag_b   = HMAC(mac_key, lv_cat("herdling-pair-v2/b", Yb, ADb, tag_a, host_name, user,
                               decimal ssh_port, host_key_fingerprint or ""))
```

Text values are UTF-8, exactly as they are in the JSON. Binary values on the wire are lower-case hex.

1. `POST /pair/v2/start` `{"device_id", "sid": <16 bytes>, "ya": <32 bytes>}`
   → `{"session": <16 bytes>, "yb": <32 bytes>}`.
   The host checks the fields first: a bad request uses no try. Then it takes one try of the
   window and keeps the exchange in memory for 60 seconds (at most 16 exchanges).
2. `POST /pair/v2/finish`
   `{"session", "device_name", "host_id", "public_key", "tag_a": <64 bytes>}`
   → `{"host_name", "user", "ssh_port", "host_key_fingerprint", "tag_b": <64 bytes>}`.
   A session works once; an unknown, used or expired session gives `no_session`. A malformed
   field gives `bad_request` and keeps the session. A wrong `tag_a` gives `bad_code` (or
   `too_many_attempts`) and counts as a wrong code. A right `tag_a` saves the key line and
   closes the window. A new `herdlingd pair` (a new code) ends the old exchanges with `no_window`.
3. The phone checks `tag_b` before it saves the host. A wrong `tag_b` stops the pairing.
   With a right `tag_b` the host key fingerprint is proved, so the phone does not ask the user to
   compare it. A QR code fingerprint must still match.

Each started exchange holds one try until it ends. A right finish closes the window. An exchange
that never finishes keeps its try. `POST /pair` shares the same budget. The tags are compared in
constant time. herdlingd never logs the code, the scalars or the keys.

After a v2 pairing, `herdlingd pair` prints `Paired <name>  key <fp> (checked with the code)` and
does not ask "Keep this phone?".

### Pairing v1: `POST /pair`

For older apps. The body is
`{"code", "device_id", "device_name", "host_id", "public_key", "expo_token"}` and the answer is
`{"host_name", "user", "ssh_port", "host_key_fingerprint"}`. The code goes in clear text, so a
device on the LAN that reads it can pair its own key. After a v1 pairing, `herdlingd pair` shows
the phone key fingerprint and asks "Keep this phone?".

### How the app picks the version

- The QR code and the deep link have `v=2` (`herdling://pair?h=…&p=…&c=…&f=…&v=2`). The Bonjour
  advert has the TXT record `pv=2`. An older app ignores both.
- With `v=2` or `pv=2`, the app uses only pairing v2. It never falls back to v1.
- Else the app tries v2 first. When the host answers 404 (an older herdlingd), the app tells the
  user that pairing is less safe and asks to continue. Only a "Continue" pairs with v1, and the
  user then compares the keys. Any other error stops the pairing; it never falls back.

## Herdr 2 (herdr-core)

Since the herdlingd after 0.1.7. herdlingd joins a running herdr-core (`hc`; checked against
herdr-core 0.1.19, protocol generation 1). It starts a core only in `core.install`, in
`update.apply` for a release that needs the core, and in the installer. Old apps see the core entries
because they come in the herdr 1 shapes.

**herdlingd 0.2.0 talks only to Herdr 2.** The herdr 1 client is gone: every `herdr.call`, every
event stream and every push comes from the core. The entries have plain ids and no `backend`
field, so the app builds 1.0.0 and 1.0.1 allow every action on them. Each herdr 1 method that
those builds send gets its Herdr 2 meaning (see "Calls on a core id"). A computer with only
herdr 1 must stay on herdlingd 0.1.x, or install Herdr 2 (`core.install`).

### The core socket

herdlingd finds the socket with the rules of `hc`: `HC_SOCKET`; else `socket` in
`$XDG_CONFIG_HOME/herdr-core/config.toml`; else `<session>.sock` in
`$XDG_RUNTIME_DIR/herdr-core/`, in `/run/user/<uid>/herdr-core/` (when that folder exists) or in
`$XDG_STATE_HOME/herdr-core/<session>/`. The session is `HC_SESSION`, else `default`. The forced
SSH command and launchd often have no `XDG_RUNTIME_DIR`, so herdlingd takes the first of these
folders that has the socket. On macOS the core has no runtime folder: its socket is in
`~/.local/state/herdr-core/default/`.

### Snapshot entries

`herdr.call {method: "session.snapshot"}` gives the live terminals of this computer in the
herdr 1 lists `workspaces`, `tabs`, `panes` and `agents`. Terminals of other machines (`box/t7`)
are left out.

| Entry | Id (0.2.0) | Id (0.1.x) | From |
|---|---|---|---|
| Workspace | `space:<id>` | `hc:space:<id>` | a space of the herdr-app document (`doc.get {name: "herdr-app"}`, read only) |
| Workspace | `g:<key>` | `hc:g:<key>` | a fallback group (see "Placement") |
| Tab | `tab:<id>` | `hc:tab:<id>` | a tab of a space, or the one tab of a fallback group |
| Tab | `task:<address>` | `hc:task:<address>` | the task tab of a terminal that has no document tab |
| Pane | `<address>` (`t7`) | `hc:<address>` | every live terminal |
| Agent | `<address>` | `hc:<address>` | a terminal whose program reports an OSC 7501 status |

- A pane id has no `:` and no `/`. Every other id has a kind word and a `:`, so the kinds never
  collide. herdr 1 ids (`w1:p1`) name nothing.
- herdlingd 0.1.x merged the core entries with the herdr 1 entries: each core entry had the
  `hc:` prefix and `backend: "core"`. herdlingd 0.2.0 has neither.
- herdlingd 0.2.0 removes a `hc:` prefix from each input id once (`pane_id`, `target`, `tab_id`,
  `workspace_id`, also in the params of `herdr.call`). Saved app state of 0.1.x names the same
  entries.
- The id `hc:loose` of the first 0.1.x versions becomes `loose`. It names no pane
  (`pane_not_found`), no tab (`tab_not_found`) and no workspace (`workspace_not_found`).
- A space id or a tab id with a `:` or a `/` names nothing.

### Placement

herdlingd puts each terminal in the first place that fits:

1. The space and tab of the herdr-app layout document that hold the terminal.
   A Herdr app space with no name takes the `where` name of its first terminal, else the folder
   name of that terminal, else the folder name of the space.
2. The terminal labels `herdr.space` and `herdr.tab`. This also names a document space that no
   document tab holds yet, for example right after the phone starts an agent. The name of the
   space is the part of the `where` label before the last ` / `. When another workspace already
   holds the tab id (a stale label), the terminal gets its own task tab `task:<address>`.
3. A helper (a subagent terminal) goes to the task tab of its parent. When the parent is gone,
   finished or on another computer, the helper becomes its own task in its own group.
4. A fallback group. The group name is the first that exists: the `herdling.group` label, the git
   repo name, the folder name, or `Terminals` (a terminal with no folder).

### Group and task fields

Core agent and pane entries have these optional fields. An old app ignores them.

| Field | Meaning |
|---|---|
| `group` | The name of the group of the terminal |
| `group_source` | Where the name comes from: `space`, `label`, `repo` or `folder` |
| `repo` | The name of the git repo, when the folder is in one |
| `repo_root` | The root folder of the repo |
| `branch` | The branch of the repo, when it has one |
| `parent_id` | The pane id of the parent terminal (`<address>`), for a helper that a terminal on this computer started. The app shows the helper under its task when the parent is a live agent |

The task name of a terminal is its `herdling.name` label (a rename from the phone), else its
name, else its 7501 title, else its terminal title. A title
that only repeats the reported app or the agent kind (for example "Claude Code") is not a task
name. The agent `name` and the pane `label` are the task name. When there is none, they are the
first that exists of: the name of the Herdr app tab that holds the terminal, the terminal name,
the 7501 title, the terminal title, the reported app, the agent kind and the address. They are
never empty, and they are never the name of the space. `display_agent` is null
for a known kind (`claude`, `codex`, ...), and it has the reported app only for an unknown kind.
herdlingd reads the repo with `git`, with a short time limit. When `git` is missing or slow, the
group falls back to the folder name.

- `agent_status`: 7501 `idle` → `idle`, `working` → `working`, `done` → `done`, `blocked` and
  `error` → `blocked`, other words → `unknown`.
- `agent` is the reported app as a Herdling kind (`claude`, `codex`, ...). `display_agent` is the
  reported app when the kind is unknown (null for a known kind), `name` the entry name (see
  above), `state_change_seq` the time of the last status change.
- With no core socket or no core answer, the call gives `herdr_unavailable` (old apps show
  "herdr is not running").

### Typing on Herdr 2

Since herdlingd 0.2.0. The app calls do not change (`pane.send_input`, `pane.send_text`,
`pane.send_keys`, `agent.prompt`, `pane.answer`).

- A line with Enter (`text` and `keys: ["enter"]`, or `pane.send_text` with a final newline) and
  `agent.prompt` go through `terminal.send`. The core pastes the text and presses Enter when
  nobody types at the computer.
- Text without Enter, and keys, go in at once. herdlingd opens a short `terminal.attach` stream
  (`observe: false`, `resumed: true`, at the size that the terminal has, so nothing resizes) and
  writes the bytes, then closes the stream. The text goes as it is, so every character works
  (punctuation, accents, emoji). Keys get the xterm bytes for the modes of the program (from the
  first paint, for example application cursor keys). When the core has `automatic_input`
  (`hello.features` and the attach reply), the bytes go as AUTOMATIC_INPUT frames: they do not
  count as a person at the computer. Else they go as DATA.
- A key with no xterm form (for example `shift+enter`) goes through `terminal.keys`.
- `pane.answer` types its digit in the same way.
- Every typing call answers within 10 seconds of its arrival, the wait behind earlier calls to
  the same pane included. The app gives a call 15 seconds. A `terminal.send` that still waits at
  the deadline (someone types at the computer) is cancelled: herdlingd closes its connection,
  and the core never types a send that it has not started. The error is `busy` with a text that
  asks the user to look at the terminal first. A send that went in just before the close (a new
  turn, or the agent works) counts as sent.
- When a typing call to a pane fails, the calls to that pane that arrived before the failure do
  not run. Their error is `dropped` (or `busy` when they ran out of time), and nothing was typed.
  A later Enter does not run a half-typed command.

### Calls on a core id

On herdlingd 0.2.0 every `herdr.call` goes to the core. The id is the first non-empty string of
`pane_id`, `target`, `tab_id` and `workspace_id`. On 0.1.x only a call with an `hc:` id went to
the core.

| herdr 1 method | On the core |
|---|---|
| `pane.read` | `terminal.read` (plain text; `source: "visible"` reads the screen only; `revision` is 0). With `format: "ansi"`: one passive `terminal.attach`, see "Terminal view" |
| `pane.send_input` text + `["enter"]`, `pane.send_text` with a final newline | `terminal.send` (`force: true`) |
| `pane.send_keys`, `pane.send_input` with keys, `pane.send_input` or `pane.send_text` without Enter | typed at once as raw bytes on a short `terminal.attach` stream (see "Typing on Herdr 2"). A core without `terminal.attach` gets `terminal.keys`, only when each character has a key |
| `agent.prompt` | `terminal.send`. A terminal with no 7501 status gives `agent_not_ready` ("not an active named agent yet"), so a prompt never goes into the shell before the agent runs |
| `pane.get`, `pane.process_info` | `terminal.get`, in the herdr 1 shapes. `pane.get` of a pane with a running `pane.watch` also has `scroll` |
| `pane.close` | `terminal.kill` |
| `tab.create` on `space:<id>` or `g:<key>` | `terminal.run` of a login shell in `cwd`, with labels (see "New terminals"). The answer has `workspace`, `tab` and `root_pane` |
| `workspace.create` | the same, in a new space. 0.1.x apps send `backend: "core"`; old apps send no `backend`. Both go to the core on 0.2.0 |
| `agent.start` on a pane | types the agent command (`<program> <args>`) with `terminal.send`. The program comes from the agent kind; an unknown kind gives `bad_request`. `name` is not used. Each argument is quoted for the shell in the pane (its foreground program, else the `SHELL` of herdlingd): POSIX quotes for sh, bash, zsh and the like, fish quotes for fish, double quotes for Nushell. Another shell takes only plain words. An argument with a control character, or one that the shell cannot take, gives `bad_request` and types nothing |
| `agent.rename` | `terminal.label` `herdling.name` (an empty or null name removes it) |
| `tab.rename` of `task:<address>` | the same for that terminal |
| `tab.rename` of `tab:<id>`, `workspace.rename` | `unsupported`: the Herdr app owns those names |
| `tab.close`, `workspace.close` | `terminal.kill` of each terminal of that tab or workspace. An unknown id gives `tab_not_found` or `workspace_not_found` and kills nothing. `close_group` is not used. Optional `pane_ids` (since 0.2.0): the panes that the app showed; only the panes in both close. Without `pane_ids`, a `workspace.close` of a repo or folder group (`g:<key>` whose terminals have no `herdling.group` label) gives `unsupported` and kills nothing: such a group follows the folder of each terminal, so an older app can have shown other terminals. A space, a tab and a label group close as a whole |
| `agent.explain` | `terminal.get` and `terminal.read`: the agent reports its status itself, so `screen_detection_skipped` is true, the one rule `osc-7501` matched, and its evidence is the end of the screen |
| `workspace.get` | the workspace entry of the snapshot, else `workspace_not_found` |

- `session.snapshot`, `workspace.list` and `workspace.create` name no entry. Any other method
  with no id gives `unsupported`.
- `workspace.list` gives the core workspaces, as `session.snapshot` does.
- Restart and resume of the app use these calls: `pane.close`, `workspace.get`, `tab.create`,
  then `agent.start` with the resume arguments. The new agent is a new tab of the same space.
- A pane method on an id that is no terminal address gives `pane_not_found`. Every other method
  gives the error code `unsupported` (for example `pane.split`, `workspace.focus`, `tab.focus`).
  A herdlingd 0.2.0 that does not reach a core gives `herdr_unavailable`.
- Before a call that changes the core (`terminal.run`, `terminal.label`, `terminal.kill` of a tab
  or workspace, `terminal.send` of `agent.start` and `agent.prompt`), herdlingd reads the core
  `hello.methods`. A core that lacks the method gives `unsupported`, and nothing changes.
- The core error kinds `not_found` and `finished` become `pane_not_found`. Other kinds are the code.
- Typing calls answer within 10 seconds of their arrival. See "Typing on Herdr 2".
- `pane.watch`, `pane.answer`, `agents.preview`, `git.status`, `git.diff`, `commands.list`,
  `ports.list` and `shell.watch` accept a core `pane_id`.
- `thread.resolve` finds the session of a core agent from the processes of the terminal, as for
  herdr 1, and gives its transcript (`log_path`). `agents.preview` of a core pane reads the
  transcript of the agent and sets `source: "log"`. When no transcript exists, `thread.resolve`
  gives `session: null`, and only `agents.preview` falls back to the screen.

### New terminals

herdlingd starts a terminal as the Herdr app does: the login shell of the user (`$SHELL -l`, else
the core's own shell) with `keep: true` and no parent. Then it types the agent command. It sets
only these labels:

| Place | Labels |
|---|---|
| a space `space:<id>` | `herdr.space=<id>`, `herdr.tab=<new tab id>` |
| a new space | `herdr.space=<new space id>`, `herdr.tab=<new tab id>` |
| a label group `g:<key>` | `herdling.group=<group name>` |
| a repo or folder group | none: the folder places the terminal |

New ids look like the Herdr app ids: `sp` or `tb` and 32 hex digits. Each new agent gets a new tab
id, so it is its own tab at the desk. herdlingd never writes the herdr-app layout document.

### `groups.list`

Params: none. Result: `{groups: [{workspace_id, label, source, space_id?, terminals, agents,
agent_status}]}`, one per workspace of the core part of the snapshot. `source` is `space`,
`label`, `repo` or `folder`. `space_id` is set for a space. Without a core: `unsupported`.

### `pane.move`

Params: `pane_id` (a core pane) and exactly one of `workspace_id` (a space `space:<id>` or a
label group `g:<key>`), `new_space: true`, or `group` (a name of at most 64 characters; an
empty name removes the label). Result: `{pane_id, workspace_id, tab_id}`, where the terminal
shows now.

- A space target sets `herdr.space` and a new `herdr.tab`. The Herdr app then shows the terminal
  in that space. A group target sets `herdling.group`. No other label changes.
- Only a terminal in no Herdr app space moves. A terminal in a space gives `unsupported`: it is
  not known if the Herdr app moves a terminal that it holds when its labels change.
- A repo or folder group gives `unsupported`: the folder places those terminals.
- An unknown pane gives `pane_not_found`; a bad target gives `bad_request`.

### `session.start`

Params: `cwd` (an absolute path), `kind` (an agent kind with a known program), optional
`workspace_id` (`space:<id>` or `g:<key>`; missing makes a new space), `prompt` and `args`.
Result: `{pane_id, workspace_id, tab_id, prompt_error}`.

herdlingd starts a shell (see "New terminals"), types the agent command, waits up to 60 seconds
for the agent to report a 7501 status, then sends the prompt. When the command cannot be typed,
herdlingd kills the new shell and gives `start_failed`. When the prompt does not go in, the agent
still runs and `prompt_error` says why.

### Worktrees on the core

`git.worktree_add` makes the worktree with git, then starts a shell in a new space in the
worktree folder. On 0.1.x this needed `backend: "core"`; on 0.2.0 it is the default, and the
param is still accepted. The result has `via: "herdr"` and the core `workspace_id`,
`tab_id` and `pane_id`, so the app starts the agent in that pane. herdlingd checks the core
methods before git runs.

### `herdlingd group`

`herdlingd group <name>` sets the `herdling.group` label of the terminal that runs it, and
`herdlingd group --clear` removes it. The core sets `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET` in
each terminal; outside a core terminal the command fails. A terminal in no Herdr app space then
shows in that group.

### Terminal view

`pane.watch` on a core pane uses `terminal.attach` on a framed core connection, when `hello.methods`
of the core has it. Else herdlingd reads `terminal.read` as before (plain text).

- herdlingd attaches as a watcher (`observe: true`, `resize_notifications: true`, `history` =
  `lines`). The core never takes its size, keys or focus. With `cols` and `rows` it attaches as a
  driver at that size. In both modes herdlingd sends only CREDIT and CLOSE frames on the stream:
  typing has its own short streams (see "Typing on Herdr 2").
- A terminal emulator in herdlingd reads the stream. Each event has the history lines and the
  screen rows with SGR colors (`format: "ansi"`), as herdr 1 gives them. Trailing blank rows are cut
  on the main screen; on the alternate screen (a full-screen app) every row stays. `revision` is 0.
- The first attach runs before the reply: a missing terminal gives `pane_not_found`. A terminal
  that ends gives `{"error": "pane_not_found"}`. When the core connection closes, herdlingd attaches
  again (250 ms, then doubled up to 4 s). After 5 failures in a row it sends `{"closed": true}`.
- `pane.get` of a watched pane has `scroll`: `max_offset_from_bottom` is 0 on the alternate screen,
  else the number of history lines; `viewport_rows` is the rows. The app uses it to find a
  full-screen app and show the page keys.
- `pane.read` with `format: "ansi"` takes the first paint of one passive attach (it waits until no
  frame came for 40 ms, at most 1 s), then detaches.
- `pane.watch` with `format: "vt"` sends the attach bytes as they are (see "Raw terminal stream").

### Events

`herdr.subscribe` reads the core events. It sends them as herdr 1 lines with plain ids: a status change as `pane.agent_status_changed`, a cleared status as
`pane.agent_detected` with `released: true`, `created` as `pane.created`, `finished` and
`removed` as `pane.closed`. `missed`, `lost` and a change of the herdr-app document give
`layout.updated`, so the app reads the snapshot again.

- An `events` list keeps only the lines with those event names.
- When the core stream ends, the app gets `{"closed": true}` and subscribes again.

### Pushes

`herdlingd serve` also checks the `shell.watch` watches of core panes with `terminal.get`: every
3 seconds, and early after a core `foreground` or `title` event of a watched pane. The push rules
are the herdr 1 rules.

`herdlingd serve` also subscribes to the core events, after `hello` shows generation 1. It sends
"finished" (working → idle or done) and "needs you" (blocked or error) pushes for core agents,
with the same debounce and prefs. The title is the terminal name, else the 7501 title, else the
app. After `missed`, serve compares the snapshot with the known statuses. After a reconnect, the
snapshot is a new baseline. The core does not report desk activity, so "quiet at the computer"
does not hold back a core push. On 0.2.0 `quiet_at_desk` has no effect (the field stays, so old
apps can send it).

### `hello.backends`

```json
{"backends": {"herdr": {"version": "0.9.5", "protocol": 22}, "core": {"version": "0.1.19", "generation": 1}}}
```

A backend that does not answer is missing. On 0.1.x `herdr_ok` tells about herdr 1 only.

On 0.2.0 `backends` has only `core`. `herdr_ok` is true when the core answers, `herdr_version` is
the core version and `herdr_protocol` is missing, so old apps show the runtime as running. The
app knows a Herdr 2 only host by `herdlingd` 0.2.0 or later, and then treats every entry as a
Herdr 2 entry (task rename only, phone width, no herdr 1 key fallback).

### `hello.core_setup` and the core self-heal

Since 0.2.0. A herdlingd 0.1.9 that updates to 0.2.0 does not read `requires_core`, so no core
is installed. 0.2.0 then installs the pinned core itself: when `serve` starts, and when `hello`
finds that no core answers and none is installed. It is the path of `core.install` (the pinned
SHA-256, the same lock). It runs only when no `herdr-core` is found, so it never downgrades and
never touches a core of a package manager. After a failure, `hello` tries again after 10
minutes; `serve` tries at each start.

When no core answers, `hello` has `core_setup`:

```json
{"herdr_ok": false, "core_setup": {"state": "installing", "message": "Installing Herdr 2 (herdr-core 0.1.20) on this computer. This takes a minute. Then Herdling shows its terminals."}}
```

`state` is `installing`, `failed` (the message has the error) or `missing`. The field is missing
when all is well. A `herdr_unavailable` error gets the same message, because old apps show that
text. The state is in `core-heal.json` next to `core-install.lock`.

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
