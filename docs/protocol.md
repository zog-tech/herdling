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

`bad_request`, `unknown_method`, `not_found`, `not_installed`, `io_error`, `internal`, `timeout`, `herdr_unavailable`, `upstream_error`, `command_failed`, `no_command`, `bad_output`, `automate_failed`, `too_large`, `update_unavailable`, `unsupported_target`, `checksum_mismatch`, `downgrade`, `update_in_progress`,
`unsupported_platform`.

A `herdr.call` error can also carry a code from herdr itself.

## Method list

`hello` returns `methods`: every method name the host accepts. An older `herdlingd` does not send `methods`. In that case the app tries the call and falls back on `unknown_method`.

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
