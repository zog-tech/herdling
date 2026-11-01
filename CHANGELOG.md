# Changelog

All notable changes to Herdling are in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The app version is in `app/app.json`. The `herdlingd` version is in `companion/Cargo.toml`.

## [herdlingd Unreleased]

- Tidy notifications: one notification per agent (`collapseId`, `tag`), grouped by computer
  (`threadId`), "needs you" as time-sensitive and "finished" as passive with no sound. Three new
  `push.register` prefs turn each part off: `replace`, `group` and `quiet_finished`. A device
  without them gets them on.
- Background work: `agents.preview` items of Claude Code panes have the optional field
  `background` with the running background shells (count and commands) and background subagents.

## [herdlingd 0.1.2] - 2026-10-31

- Answer from the notification: `pane.answer` checks the menu again and sends the key, or gives
  the error `stale`. Needs-you pushes for a Yes / No menu carry the two labels for the app buttons.
  `push.register` takes `capabilities`.
- Browser preview: `ports.list`, `preview.open` and `preview.close`, and a proxy mode that connects
  only to loopback ports with a grant. The phone key keeps `no-port-forwarding`.

## [herdlingd 0.1.1] - 2026-10-31

- Faster terminal: `pane.watch` streams only changed screens, and `pane.send_input` sends a line
  in one call. Typing calls to one pane stay in order.
- Chat view for omp and Gemini CLI sessions.
- Git views: `git.status`, `git.diff`, and `git.worktree_add` to start a session in a new worktree.
- New session: `agents.installed`, and `fs.dirs` with hidden folders, git folders and a faster
  listing without recents.
- Start at boot: `hello.boot` and `boot.check` say whether herdlingd starts at boot or after a
  login. On a Mac, `mac.open_settings` opens one of three allow-listed System Settings pages.
- Attachments of any file type, up to 25 MiB.

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

- **Theme and accent.** Settings, Appearance, Theme: three dark themes (Night Watch, the default;
  Midnight, true black for OLED; Graphite, cool greys) and five accents (Lantern gold, the default;
  Ember, Sea glass, Iris, Ivory). The working lantern follows the accent. With Ember, "needs you"
  turns rose. A change applies at once and the app stays on the same screen. No light theme yet.
- **Dashboard top on the Board.** The Board opens with the Herdling name and a computers button
  (one circle per computer with an online dot), then a row of large agent tiles: "Highlights"
  (needs you, working, unread) or "Recent" (recent idle agents), each with the last lines of its
  screen. A last tile starts a new session. Under the tiles: one summary line and "All agents"
  with Group (Status, Computer, Workspace, None) and Sort (Status, Recent activity, Name, Running
  longest) menus. Computer and workspace groups collapse with a tap on the header. The group, the
  sort and the collapsed groups are saved. Settings, "Overview top", has "Summary" for the large
  number of before.
- **Links in the thread.** URLs with a scheme (`http`, `https`, `mailto`) are links in replies,
  in your messages and in tool output, also inside inline code. `foo.com` and file names stay
  text. A tap on a web link opens the in-app browser (Close, Back, Forward, Reload, Copy link,
  "Open in Safari"). A tap on a `localhost`, `127.0.0.1`, `0.0.0.0` or `[::1]` link opens the
  browser preview of that port and path on the session's computer. A long press opens a link
  menu: Open, Open in Safari (not for local links), Copy link and Share. Builds without the web
  view open web links in the system browser and show a notice for local links.
- **Agent list style.** Settings, Appearance: the Board shows each agent as a card (the default),
  as a row with an arrow, or as a plain row. A card has a footer with the time and a gold "Open".
  An idle agent with no reply shows "Waiting for your next prompt". A one-time hint above the
  first agent says "Tap an agent to see its chat and talk to it." It goes away when you open a
  session from the Board or close it.
- **Tidy notifications.** Each agent has one notification: a new event replaces the old one.
  Notifications of one computer stay in one group on iOS. "Finished" arrives quietly, with no sound
  and no banner. "Needs you" asks to be time-sensitive; this starts to work in a build with the
  Time Sensitive entitlement. The notifications of an agent go away when you open its session or
  answer from the buttons. Settings has three new switches: "One notification per agent", "Group
  by computer" and "Deliver 'finished' quietly". Needs the new herdlingd; an older herdlingd sends
  the pushes as before. Over-the-air update, no new build.
- **Background state on the Board.** An idle Claude Code agent with a background shell or
  subagent that still runs shows as "Background" (gold dot, no glow), after "Working" and before
  "Idle". The row says "1 shell running: npm run dev", and the session screen says
  "Idle · 1 shell running". Needs a herdlingd with the `background` preview field.
- **Answer from the notification.** A "needs you" push for a Yes / No permission menu has Yes and
  No buttons. The body shows the two full labels ("Yes · No, and tell Claude…"). A button needs
  Face ID or the passcode on a locked phone, opens the app, opens the session and sends the
  answer. The app shows "Answered Yes", or "The question changed" when the menu is not the same.
  herdlingd checks the menu on the computer again before it sends the key (new `pane.answer`,
  error `stale`). The push has the two labels only, no question text. `push.register` takes
  `capabilities`, so only an app with the buttons gets them. The demo host shows the buttons too.
  Needs the new herdlingd; with an older herdlingd the push has no buttons, as before.
- **iPad layout.** On a window that is 700 pt wide or more (iPad, Android tablets, foldables),
  Overview shows two columns: the board on the left and the selected session on the right. The
  board stays while you move from agent to agent. When the window becomes narrow (Split View, Stage
  Manager), the app changes to the phone layout and the session stays open as its own screen.
  Pushes and links open the session in the right column. On iPad the tab bar can turn into a
  sidebar, and the app turns to all four orientations. iPhone keeps the portrait phone layout.
- **Keyboard shortcuts.** With a hardware keyboard: ⌘1 to ⌘4 change tabs, ⌘[ and ⌘] go to the
  previous or next agent, ⌘↩ sends the prompt, ⌘. sends Ctrl-C, ⌘T changes between Thread and
  Terminal, ⌘N starts a new session, ⌘R reconnects offline hosts, and Esc goes to the pane in
  Terminal mode. Hold ⌘ on iPad to see the list. Needs the new native build (the `keys` module);
  older builds ignore the shortcuts.
- **Pointer hover.** Board rows, filter chips and outline buttons show a light layer under an iPad
  trackpad or a mouse.
- **Browser preview.** Open a dev server of the computer (for example `localhost:5173`) in the app,
  with hot reload. "Preview" in the session menu lists the ports that the user's processes listen
  on, with the ports of the session's pane first. The phone key keeps `no-port-forwarding`: each
  connection goes over its own exec channel (`herdlingd proxy <port> <grant>`) to `127.0.0.1` or
  `::1` on the computer only, with a grant from `preview.open`. herdlingd adds `ports.list`,
  `preview.open` and `preview.close`. Needs a new app build (`react-native-webview`) and a new
  herdlingd; without them the app does not show "Preview". The demo host shows a static page.
- **Faster typing over cellular.** The terminal follows the screen with `pane.watch`: herdlingd
  reads the pane every 80 ms on the computer and sends only changed screens, in place of a 1 s poll.
  A sent line is one call (`pane.send_input`) and shows at once, dimmed, until the computer echoes
  it. Keys go through an ordered queue without a wait for each reply. A badge shows the latency.
  "Type directly" sends each key at once, with mosh-style prediction on slow links. Needs
  herdlingd 0.1.1; with an older herdlingd the app polls as before.
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

### Fixed

- The installer unpacks herdlingd in `~/.cache/herdling`, not in `/tmp`. On systems that mount
  `/tmp` with `noexec` (for example TrueNAS), the install failed with "Permission denied".

### Changed

- A long press on a message in the thread dims it. It no longer makes the message smaller.
- The product name changed from the working name to Herdling. The companion is now `herdlingd`.
- The app no longer asks for permissions it does not use (Face ID, storage, biometrics, overlay, boot).
- **Clearer agent questions.** The menu above the composer shows the question from the screen
  ("Claude asks …"). Each option shows a short title and a muted detail of 2 lines; a chevron
  shows the full detail. A "Recommended" option gets a gold chip and a gold edge. "Type something."
  and "Chat about this" are small buttons under the list. A long menu scrolls and takes at most
  about half of the screen, so the thread stays visible. Yes / No permission menus keep compact rows.
  After "Type an answer", the next send goes into the agent's text field as one line plus Enter.
