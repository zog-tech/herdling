# Changelog

All notable changes to Herdling are in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The app version is in `app/app.json`. The `herdlingd` version is in `companion/Cargo.toml`.

## [herdlingd 0.1.0] - 2026-10-31

The first public release of `herdlingd`, the companion that runs on your computer.

- Serves the Herdling app over SSH with a restricted key per phone, and talks to herdr.
- Chat view for Claude Code, Codex, Pi and OpenCode sessions, with command lists for each agent.
- Push notifications when an agent finishes or needs you, and quiet while you use the computer.
- Install and pair from the phone, and update from the phone with one tap (`herdlingd update`).
- Builds for macOS (Apple silicon, Intel) and Linux (x86_64, arm64).

## [Unreleased]

Herdling is in early development. The app is in beta on TestFlight, and the App Store and
Google Play releases are coming soon. The list below follows the history of the repository,
from the first commit to today. It describes app 1.0.0 and `herdlingd` 0.1.0.

### Added

- **New session, redesigned.** Choose the agent first, in one row of chips (Claude Code, Codex,
  Pi, OpenCode, omp, Gemini CLI and more). The app remembers the last agent for each computer.
  Type a path with live folder suggestions (`~` is home, a button completes the name), or browse
  with breadcrumbs, Up and Home buttons and pull to refresh. Recent folders are one row of chips,
  and "Recent sessions" resumes an earlier session of the chosen agent with one tap. The first
  prompt, dictation and the start button ("Start Claude Code here") stay at the bottom.
  herdlingd 0.1.1 adds `agents.installed` (agents that are not installed show dimmed with "Not
  installed"), and `fs.dirs` gets `hidden` ("Show hidden"), `recent` and `git_dirs` (a git folder
  icon). With herdlingd 0.1.0 the screen works without these parts.
- **Start at boot.** herdlingd reports when it starts (`hello.boot`: at boot, or after a login;
  `boot.check`). The host screen and Settings show "Starts after you log in on this computer" with
  a step-by-step guide: automatic login on a Mac (and why FileVault blocks it), lingering on
  Linux. On a Mac, "Open this setting on my Mac" opens the System Settings page on the Mac
  screen (`mac.open_settings`, three allow-listed pages only). Needs herdlingd 0.1.1.
- **Turn on SSH guide.** When the phone cannot reach port 22, password setup and manual add offer
  a step-by-step guide for Remote Login on a Mac and the SSH server on Linux, with
  "Done, check again".
- **Install herdr from the phone.** When herdr is missing, password setup offers "Install herdr and
  herdlingd". It runs the official herdr installer with the new `--with-herdr` option of
  `install.sh`. The installer never installs herdr without this option.
- **herdr is not running.** The host screen, Settings and the board say so, with how to start herdr.
- **Message menu in the thread.** Hold a prompt, a reply, a tool card or a note to get Copy,
  Select text, Share, Read aloud and Quote in reply. Copy gives plain text; "Copy as Markdown"
  gives the source of a reply. Hold a code block to copy only that code.
- **Chat view for omp and Gemini CLI.** herdlingd reads omp (oh-my-pi) sessions, which use the Pi
  format with some additions, and Gemini CLI sessions (`~/.gemini/tmp/<project>/chats/`, JSON lines
  with patches, and older single-object files). Both get the chat view, live follow, board
  previews and "Resume older session" (`--resume`). `hello.thread_kinds` now lists `omp` and
  `gemini`. Needs the new herdlingd.
- **Search in the session.** A magnifier next to Thread and Terminal opens a search bar. In the
  thread it finds the loaded messages, tool output included, marks them with a bar at the left,
  shows the match in an excerpt and jumps between matches. "Search older messages" loads older
  pages up to 2,000 messages. In the terminal it marks the matches in the text and jumps to them.
  App only: it works with every herdlingd.
- **Attach any file.** The "+" menu of the composer has "Files" next to "Photos": text, code, logs,
  PDF, JSON, CSV, zip and other files, up to 6 attachments per prompt. The agent gets the saved
  path in the prompt, as for photos. herdlingd takes files up to 25 MiB (was 10 MiB) and keeps the
  7-day cleanup. `expo-document-picker` is a new native module: binaries without it hide "Files".
- **New session in a git worktree.** When the folder is in a git repo, New session offers "In a
  new git worktree" with a branch name (default `herdling/<random>`). herdlingd makes the branch
  and the folder `.worktrees/<branch>` in the repo (`git.worktree_add`), and the agent starts there
  in a new workspace. Needs the new herdlingd.
- **Changes and diffs.** The session menu has "Changes": the branch, the changed files with their
  status and line counts, and a diff view for each file (line colors, hunk headers, sideways
  scroll, large diffs in pages). New read-only methods `git.status` and `git.diff`. Needs the new
  herdlingd. The demo host shows changes for its projects.
- **Install and update herdlingd from the phone.** "Set up with password" installs herdlingd when it
  is missing ("Install and pair"), with the installer `https://herdling.zog-tech.com/install.sh`.
  The app shows "Update available" and updates herdlingd with one tap (`update.check`,
  `update.apply`). On the computer: `herdlingd update` and `herdlingd version`. A release workflow
  builds herdlingd for macOS (arm64, x86_64) and Linux (static musl, arm64, x86_64) on a
  `herdlingd-v*` tag.

- **Foundation.** A pnpm workspace with the Expo app, the shared protocol types and the Rust
  companion `herdlingd`. The app talks to `herdlingd rpc` over SSH with newline-delimited JSON.
  `herdlingd` passes calls to the herdr socket and streams herdr events.
- **Chat view.** `herdlingd` reads the Claude Code session logs and pages them into a thread:
  prompts, formatted replies, tool calls, thinking, subagents and permission requests. The app
  follows the thread live and sends prompts.
- **More agents.** An agent-neutral transcript layer with adapters for Codex, Pi and OpenCode.
  Session resume and command lists for each agent (`/` commands, `$` skills for Codex, prompts
  and skills from the agent folders for Pi and OpenCode).
- **Board.** Every agent of every computer on one screen, grouped by status, with a "Needs you"
  group first, a peek sheet with the last reply, live elapsed times and herdr names.
- **Sessions.** Start an agent in any folder, restart, resume, rename and close a session.
  Rename tabs and workspaces. Swipe between the agents of a workspace.
- **Terminal.** An ANSI terminal view with a key row and width modes (fit, wrap, scroll).
- **Computers.** Add a computer by hand, find computers on the local network (Bonjour), pair
  with a one-time code or a QR code, or set up once with the SSH password (`herdlingd enroll`).
  The app pins the host key. Each phone gets its own restricted key that can only run
  `herdlingd rpc`.
- **herdlingd service.** `herdlingd install` sets up a launchd agent on macOS or a systemd user
  service on Linux. `herdlingd serve` watches herdr, advertises itself and opens the pairing window.
- **Push notifications.** A push through Expo when an agent finishes or waits for you, with
  per-kind settings and deep links into the session. No pushes while the user is active in herdr.
- **Voice.** Record or dictate prompts, with on-device recognition, an on-device Parakeet model
  on iOS, or the computer's own `stt_command`. Read replies out loud in full or as a summary,
  with the phone voices or the computer's `tts_command` and `summary_command`.
- **Composer.** Attach photos, paste images, a `+` menu and a command picker.
- **Meters.** CPU and memory of each computer, and the plan usage of Claude and Codex.
- **Automations.** A tab that lists the automations of `herdr-automate` and approves them.
- **Design.** The "Night Watch" design system: a dark palette with one gold accent, Dynamic Type
  roles, motion tokens, haptics, Liquid Glass on iOS 26, flat rows and grouped Settings.
- **Android.** Native modules for SSH (sshj) and voice, and Android paths for sheets, prompts,
  headers, tab icons and keyboard insets.
- **Demo mode.** A demo host with made-up agents (`herdling://demo`).
- **Compatibility.** `hello` lists the methods of the computer, so a new app works with an older
  `herdlingd` and shows an update hint. The rules are in `docs/protocol.md`.
- **Releases.** EAS build profiles, over-the-air updates with `expo-updates` and TestFlight builds.
- **Store and website.** App Store and Google Play listing text, the privacy policy and the
  support page.

### Changed

- The product name changed from the working name to Herdling. The companion is now `herdlingd`.
- The app no longer asks for permissions it does not use (Face ID, storage, biometrics, overlay, boot).
