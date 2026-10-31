# Phase 1 verification

Date: 2026-10-29. Branch `phase-1`. Tester: the maintainer's agent session.

## Setup

- App: iOS Simulator (iPhone, iOS 26.5), dev build of Herdling.
- Host "Mac host": the development Mac, herdr 0.9.5, companion built from the repo (debug build), reached over the loopback address with a `from=` restriction.
- Host "Linux dev server": Ubuntu server on the LAN, herdr 0.9.0, companion built there with `cargo build --release` from `git archive HEAD companion`, installed in `~/.local/bin`.
- Authorization on the Linux server: one `restrict,command="<abs path>/herdlingd rpc"` line appended to `authorized_keys`. No `from=` restriction, because the simulator connects from a LAN address.
- Both servers run live Claude agents. Test sends went only to temporary workspaces in `/tmp`. Both temporary workspaces were closed afterwards.

## Passed

| Check | Result |
| --- | --- |
| Add the Linux host in the app (Test connection, Save) | Connected, OS and herdr version shown, host key shown and pinned. |
| Both hosts online in Overview | Both show Online. |
| Agents from both hosts listed with the right status | Idle and Working agents match `herdr agent list` on each host. |
| Open an existing session read-only on the Mac host | Thread renders (Markdown, RTL text, system notes). |
| Open an existing session read-only on the Linux server | Thread renders after the fix below. |
| Send a prompt on the Mac host (new temporary session in `/tmp`) | Prompt and reply appear in the thread. Status goes to Done. |
| New session flow on the Linux host (folder browse to `/tmp`, claude, first prompt) | Session created. Reply appears in the thread. |
| Background the app for 75 s | The `herdlingd rpc` process on the Linux server exited (`pgrep` empty). The Mac process also exited. |
| Bring the app back | Both hosts reconnected. The Linux process was back within 5 s. Overview showed both Online. |
| Existing agents untouched | No prompt went to an existing agent. `authorized_keys` differs from its backup by the one added line. The temporary build directory was removed. |

## Found and fixed

- **Thread did not render on herdr 0.9.0.** The Linux session showed "No conversation log for this agent" with the terminal text instead. Cause: herdr 0.9.0 closes the socket after one reply, and `thread.resolve` made two calls on one connection, so the process lookup failed and the session was not found. herdr 0.9.5 keeps the connection open, which hid the bug on the Mac. Fix: commit `8e64384` opens a fresh connection per call. Regression test: `resolve_works_when_herdr_closes_each_connection_after_one_reply` (red before the fix, green after).

## Observed behavior to know

- A new Claude session in a folder that Claude has not trusted stops at the "trust this folder" prompt. The app handled it well: status "Needs you", the terminal text shown, and "Prompt not sent: agent is blocked" with the prompt kept in the composer. The test answered the prompt on the server with herdr, then resent from the app. Answering the prompt from the phone is Phase 4 (permission buttons, key row).
- Backgrounding the app for more than 60 s ends the companion process. This is by design. The app reconnects on return.

## Not tested as a live run

- **herdr unavailable and recovery.** Not run live, because stopping herdr on the server would end live agents. Covered by companion tests: `herdr_call_unavailable` and `herdr_call_times_out_when_herdr_never_replies` in `rpc_basic.rs`, and `subscribe_unavailable_returns_error` in `rpc_subscribe.rs`. The app side of the "herdr unavailable" display is not covered by a live test.
- **Network off, then on.** Not run, because the Mac is both the simulator host and the SSH peer. The 75 s background test exercised the same close and reconnect path from the app side. A real Wi-Fi or cellular drop on a phone was not tested.

## Not tested

- A real iPhone (device keychain key, device performance, haptics).
- The software keyboard in the composer and the new-session sheet (the simulator used hardware keyboard input).
- Access from outside the home network (WireGuard or another tunnel).
- More than two hosts, and hosts with other herdr versions.
- Non-Claude agents (codex, pi, and others): only Claude agents were used.
- The Terminal tab, subagent threads, and sessions with very long logs.
