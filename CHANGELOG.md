# Changelog

All notable changes to Herdling are in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

The app version is in `app/app.json`. The `herdlingd` version is in `companion/Cargo.toml`.

## [herdlingd unreleased]

- New method `herdr.update`: updates herdr (herdr 1) on this computer from the phone. herdlingd
  runs exactly `herdr update --handoff`, without a shell. The phone sends no command text.
  - herdlingd finds `herdr` in `PATH`, `~/.local/bin`, `~/.cargo/bin`, `/opt/homebrew/bin` and
    `/usr/local/bin`. The child gets no herdr session variables (`HERDR_ENV`, `HERDR_SESSION`,
    `HERDR_PANE_ID` and the others), because `herdr update` refuses to run inside a session.
  - One update runs at a time (`busy`). The run stops after 180 seconds. A Homebrew, mise or Nix
    install gives `managed_install`.
  - The result has the versions before and after, the handoff outcome and the end of the output.

## [herdlingd 0.1.8] - 2026-11-09

- Herdr 2 (herdr-core) support, first part. `herdlingd` finds the core socket with the rules of
  `hc` (`HC_SOCKET`, the `socket` setting, the runtime folder, then the state folder) and joins a
  running core. It never starts one.
  - `session.snapshot` (through `herdr.call`) adds the live core terminals of this computer, placed
    by the herdr-app layout. Their ids start with `hc:` and each entry has `backend: "core"`.
    When herdr 1 is down and the core is up, the answer has the core part. With no core, the
    answer is the same as before.
  - `herdr.call` on an `hc:` id goes to the core: `pane.read`, `pane.send_input`,
    `pane.send_text`, `pane.send_keys`, `agent.prompt`, `pane.get`, `pane.process_info` and
    `pane.close`. Other methods give the new error code `unsupported`.
  - `herdr.subscribe` also carries core status and lifecycle changes in the herdr 1 event shapes.
    When one backend stops and the other runs, the stream stays open and sends `layout.updated`.
  - `pane.watch`, `pane.answer`, `agents.preview`, `thread.resolve` (no session) and the repo,
    commands and ports methods accept a core `pane_id`. `shell.watch` gives `unsupported`.
  - `hello` has the new optional field `backends`.
  - `serve` watches the core events and sends "finished" and "needs you" pushes for core agents.
    The "quiet at the computer" rule does not hold back core pushes: the core does not report
    desk activity.
- "Notify me when it finishes" (`shell.watch`) is faster. When herdr sends `pane.updated` for a
  watched pane (for example, the shell sets the terminal title at the start or end of a command),
  `serve` checks the pane 150 ms later. The push no longer waits up to 3 seconds for the next
  check. The 3-second check stays for shells that do not set the title and for older herdr.
- The agent pushes do not change. They already come from herdr events
  (`pane.agent_status_changed`); the 5-second wait before a push stays.

## [herdlingd 0.1.7] - 2026-11-09

- 0.1.5 and 0.1.6 did not publish: no macOS build runner was free. This release has all their
  changes.
- Signed updates: the release workflow signs `latest.json` and `SHA256SUMS` with an Ed25519
  release key (new assets `latest.json.sig` and `SHA256SUMS.sig`). `update.check`,
  `update.apply` and `herdlingd update` check the signature of `latest.json` before they read it.
  A missing or bad signature stops the update with the new error `bad_signature`. Releases before
  this version have no signature, so this version cannot install them.
- The installer script checks `SHA256SUMS.sig` when `openssl` can check Ed25519 signatures.
- Release builds: the `cross` images are pinned by digest (`companion/Cross.toml`). The Intel
  macOS build runs on an Intel runner (`macos-15-intel`), and its smoke test runs natively.
- `git.worktree_add` uses herdr `worktree.create` when herdr has it. The new worktree joins the
  worktree group of its repo in the herdr sidebar. The branch and folder checks stay the same.
  The result adds `via` (`"herdr"` or `"git"`) and, from herdr, `workspace_id`, `tab_id` and
  `pane_id`. An older herdr, or a folder in a linked worktree, uses `git worktree add` as before.
- Pairing v2: `POST /pair/v2/start` and `POST /pair/v2/finish` pair with CPace (ristretto255,
  SHA-512). The code never goes over the network, so a device that sees or relays the traffic
  cannot learn it or enroll its own key. Each started exchange uses one of the 5 tries. See
  `docs/protocol.md`, "Pairing".
- After a v2 pairing, `herdlingd pair` prints "Paired <name> key <fp> (checked with the code)" and
  does not ask "Keep this phone?". A v1 pairing (an older app) still asks.
- The QR code has `v=2` and the Bonjour advert has `pv=2`. Older apps ignore them. `POST /pair`
  stays for older apps.
- Pairing: after a phone pairs, `herdlingd pair` shows the key fingerprint of the phone. On a
  terminal it asks "Keep this phone?". No, no answer in 2 minutes or the end of input removes the
  phone again. Compare the fingerprint with the key that the phone shows.
- New commands: `herdlingd devices` lists the paired phones with their key fingerprints, and
  `herdlingd unpair <device_id>` removes a phone, for example a lost phone.
- The key line of a new phone uses `restrict,command="<exe> rpc"`. Key lines of older versions
  stay valid.
- Browser preview: a grant records the address of the dev server listener. Each proxy connection
  checks again that a listener of the same user is there, and connects only to that address. A
  grant with no listener is refused and not renewed.
- `pane.answer` takes an optional `expect_question`. A choice push has `choice.question`, a digest
  of the question. When the question changed, the answer is `stale`, also when the labels are the
  same.
- herdr `events_lost` (herdr 0.9.2 and later): the `herdr.subscribe` stream ends with
  `{"closed": true}`, and `serve` subscribes again and reconciles with a fresh snapshot.
- Self-update: the download URL check parses the URL and refuses encoded dot segments. A version
  pre-release allows only `[0-9A-Za-z.-]`. `~/.config/herdling` gets mode 0700.
- Pairing: `herdlingd pair` and `serve` lock `pair.json` for each change. A wrong code can no
  longer open a closed window again or bring back the old code. When the computer cannot save the
  phone, the pairing window stays open and the same code works again.
- Pushes: when herdr closes the status stream of a pane, `serve` subscribes it again. Before, that
  pane sent no more pushes. A failed snapshot after a reconnect no longer loses the first push of
  each agent. A closed pane no longer stays the focused pane.
- "Notify me when it finishes": a new watch of the same pane in the same second is no longer
  removed by the result of the old watch.

## [Unreleased app]

- The host screen has a herdr card with the herdr version and **Update herdr**, when the
  computer runs a herdlingd with `herdr.update`. The confirmation tells that herdr tries to keep
  the sessions running, and that running commands and agents stop if it cannot. The result says
  "Sessions kept running" only when herdr reports a complete live handoff. Otherwise it shows the
  herdr output. A Homebrew, mise or Nix install gets a message to update herdr there.
- Herdr 2 (herdr-core) agents and terminals show on the board. In the workspace grouping, a Herdr 2
  workspace has its own section with a "Herdr 2" label; other groupings add "Herdr 2" to the row.
  A Herdr 2 agent opens in the terminal view. The app hides the actions that need herdr 1 for
  these entries: rename, restart, resume, "Why this status?", the close of a whole tab or
  workspace, and "Notify me when it finishes". New session offers only herdr 1 workspaces. The
  demo has two Herdr 2 agents.
- Saved prompts: while the prompt box is empty and has the focus, chips show your quick replies
  ("Continue", "Yes, go ahead", "Run the tests", "Explain the change", "Commit and push"). A tap
  puts the text in the box; it does not send. A long press offers "Send now". Settings, "Saved
  prompts" adds, edits, deletes and moves them. The list stays on the phone.
- Board filter: the magnifier in the Board header (or ⌘F on a hardware keyboard) shows a filter
  field. It keeps the agents whose name, agent kind, terminal title, computer or folder contain
  every word. The status groups stay. When nothing matches, the Board says so and offers Clear.
- Session search: ⌘F on a hardware keyboard opens the search of the thread or the terminal.
- Agent integrations (herdr 0.9 and later): the host screen has the row "Agent integrations". It
  lists the herdr integrations of the computer (`integration.list`) as installed, old version, not
  installed or agent not found. Install and Update ask first and say what changes on the computer,
  then run `integration.install`.
- "Why this status?" (herdr 0.9 and later): the session menu and the peek sheet open herdr's
  explanation of the agent status (`agent.explain`): the rule that matched, its screen text, a
  fallback or a kept status. When herdr is not sure and the agent has no current integration, the
  sheet links to the integrations screen.
- Worktree groups (herdr 0.9.0 and later): herdr does not close the last pane of a workspace that
  has open worktree workspaces. Close now asks "Close the workspace and its N worktrees" and then
  sends `workspace.close` with `close_group`. A restart that keeps the conversation never closes a
  group; it says to restart with a new conversation.
- Each of these features hides itself on an older herdr that does not know the method.
- Demo: the demo host has the integrations, "Why this status?" and a worktree group ("docs-site").
- New session in a git worktree: when herdr made the worktree workspace, the agent or the shell
  starts in its first pane. No second workspace opens. An older `herdlingd` works as before.
- Parakeet on iOS (next native build): a new model download uses a fixed Hugging Face commit, not
  the `main` branch. A model that is already on the phone stays as it is.
- Thread: an image in an agent reply no longer loads by itself. It shows as a link with its alt
  text or its URL. A tap opens it like any other link.
- Pairing: the pair screen and the host screen show this phone's key fingerprint
  (`SHA256:...`). After pairing, check that `herdlingd pair` on the computer shows the same key.
- Pairing v2 (JavaScript only, ships over the air): the app pairs with CPace, so the code never
  goes over the network, and it checks that the host knows the code before it saves the host.
  With a v2 host the key compare is not needed. When the QR code or the Bonjour advert says v2,
  the app never uses the older pairing. With an older herdlingd, the app asks first: "This
  computer runs an older herdlingd. Pairing is less safe."
- Remove a host: when the host is offline, the dialog gives the command `herdlingd unpair <device id>`
  that removes this phone's key and push token on the computer.
- In-app browser: on iOS it uses its own cookie store that is not saved to disk. On Android it
  does not accept third-party cookies. Remote pages no longer share the browser preview cookie.
  Pages in the in-app browser do not keep logins between visits on iOS.
- Browser preview (next native build): the preview cookie is `SameSite=Strict`.
- "Install and pair": curl downloads the installer over HTTPS only, also after a redirect.

## [herdlingd 0.1.4] - 2026-11-03

- Command finished: `shell.watch`, `shell.unwatch` and `shell.watches`. herdlingd sends one push
  when a watched shell command finishes. A tap opens the terminal.
- The thread finds the Claude Code log after `/restart` from a folder reached through a symlink.
  The resolver looks for the log in every Claude project folder and takes the newest match.
- The thread follows a Claude Code conversation that continues in a new session id
  (a `continued-in` record at the end of the old log).
- herdlingd reads very large session logs in bounded chunks. A very long line (for example a
  base64 image) is clipped and no longer loads in full.
- An image placeholder between two words keeps a space ("Fix it Okay", not "Fix itOkay").

## [herdlingd 0.1.3] - 2026-11-01

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

- **Start options in New session.** Small pills in the start bar, above the Start button, set the
  permission mode (for example Plan, or Skip permissions for Claude Code) and the thinking level of
  Pi with one tap. The model pill and the "more" pill open the start options sheet: the model, extra
  flags, a preview of the command line and "Reset to default". The restart screen has the same
  pills. A mode with no approval shows a warning in red above the Start button. The app remembers the options
  per agent. They apply to a new agent only, not to a resume or a shell. Over-the-air update.
- **Restart and keep the conversation.** Restart asks how: keep the conversation (the agent
  resumes the same session), a new conversation, or "Restart with options…" to change the mode or
  the model first. A restart uses the start options of the agent. To keep the conversation, the old
  agent closes first, so that two agents do not write the same session log. When the new agent
  does not start, "Try again" starts it again. Over-the-air update.
- **Android push setup and notification icon.** The Android build reads `google-services.json`
  from the EAS file variable `GOOGLE_SERVICES_JSON` (not in git). Android notifications show the
  sheep icon in gold, not a white circle. Native build.
- **Notify me when a command finishes.** A terminal's menu and the Run sheet have "Notify me when
  it finishes". The computer sends one push when the command finishes. Needs `herdlingd` 0.1.4.
- **Recent commands in a shell.** A shell shows chips with your last 20 commands on that computer.
  A tap puts a command in the box. A long press runs or removes it.
- **Terminal status.** The board's Terminals list and the shell session header show if a terminal
  is idle or runs a command, for example "Running: pnpm dev".
- **Page Up and Page Down.** A full-screen app with no scrollback (Claude Code in fullscreen mode,
  `less`, `vim`) gets Page Up and Page Down buttons in the terminal. Over-the-air update.
- **Paste chips in New Session.** A long paste in the first prompt becomes a "Pasted text" chip.
  On Start, the text uploads as a `.txt` file, and the agent gets its path with the first prompt.
- **Copy on every code block.** Every code block in a reply has a Copy button. The Run button on
  shell code blocks also works in the peek sheet and in subagent threads.
- **Native crashes in the crash log.** The crash log also shows native crashes (an uncaught
  exception on iOS or Android). Needs a new native build. Older builds do nothing.
- **Run a command from a reply.** A shell code block in a reply (`bash`, `sh`, `zsh`, `shell`,
  `console`, `terminal`, `fish`, `shellsession`) has a Run button, and its long-press menu has
  "Run in shell…". The run sheet shows the command for an edit. It runs the command in a new shell
  in the agent's folder or in an existing terminal on the same host, then opens that terminal.
  A busy terminal shows the name of its process. Over-the-air update, no new build and no new
  `herdlingd`.
- **Shell sessions.** New session has a "Shell" choice before the agents. It opens a plain terminal
  in the folder, with no agent. A command in the "Command (optional)" box runs when the shell is
  ready. The session screen shows a pane with no agent in Terminal mode only, with Changes,
  Preview and Close in its menu. The board lists these panes under "Terminals", after the agents.
  The demo has one shell. Shell is not remembered as the agent of the host. Over-the-air update,
  no new build and no new `herdlingd`.
- **Error screens and a crash log.** A render error on a screen now shows "Something went wrong"
  with the message, Retry and Back, and the app stays open. Overview, the session, the peek sheet,
  the subagent thread, New session and the root layout each have this screen. A fatal JavaScript
  error writes its message, stack, route and update id to the keychain before the app closes.
  Settings, "Crash log" shows the last 5 errors, with Copy and Clear. Nothing goes to a server.
  Over-the-air update, no new build.
- Long pastes in the thread composer: a paste of more than 10 lines or 800 characters becomes a
  "Pasted text #1" chip. Tap it to view the text or put it back in the prompt. On send, the
  text goes to the agent as a `.txt` file, like an attached file.
- **One status pill for the agent and its subagents.** While subagents run, the "Working" pill adds
  the count ("Working · 2 subagents") and shows a chevron. When the agent is idle and subagents run in
  the background, the pill shows "2 subagents running". A tap opens a sheet with the running
  subagents, then the subagents that finished in the current turn: type and model, time and the
  latest step. A pick opens the subagent thread. When nothing runs, the pill is gone; the finished
  subagents stay as cards in the thread.
- A running subagent card shows the same animated working indicator as the "Working" pill. A
  stopped subagent keeps a static icon.
- **Folder group and shared workspaces.** The Board Group menu has "Folder": agents with the same
  folder form one section across all computers, titled by the last part of the path (more parts
  when two folders share a name; the home folder shows as `~`), and agents with no folder go in
  "No folder". "Workspace" now merges workspaces with the same name on different computers into
  one section, with the computer names under the title. Saved collapsed workspace sections open
  once after this update.
- **Agent logos.** The agent mark shows the brand logo of the tool (Claude, Codex, Gemini, Copilot,
  Cursor, OpenCode, Pi, Kimi, Qwen, Cline) in a single tint. Other agents keep the letter badge. The
  mark now also shows before the title of an agent row on the Board and in the session header.
- **Theme and accent.** Settings, Appearance, Theme: three dark themes (Night Watch, the default;
  Midnight, true black for OLED; Graphite, cool greys) and five accents (Lantern gold, the default;
  Ember, Sea glass, Iris, Ivory). The working lantern follows the accent. With Ember, "needs you"
  turns rose. A change applies at once and the app stays on the same screen. No light theme yet.
- **Dashboard top on the Board.** The Board opens with the Herdling name and a computers button
  (one circle per computer with an online dot), then a row of large agent tiles: "Highlights"
  (needs you, working, unread) or "Recent" (recent idle agents), each with the status, the folder and the
  latest question, activity or reply. A last tile starts a new session. Under the tiles: one summary line and "All agents"
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

- A prompt sent while the agent works no longer stays "Queued" after Claude Code joins it with
  another prompt.
- The thread stopped after `/restart` from a symlinked folder, or after Claude Code continued the
  conversation in a new session. Needs `herdlingd` 0.1.4.
- The session screen no longer shows the terminal for a moment after New Session, restart or
  resume starts an agent. A new shell shows the terminal at once in the two-column layout.
- A status that the app does not know (from a newer herdr) shows as "Unknown" and no longer stops
  the app. An emoji host name shows a whole emoji on the computers button.
- The app closed when the user started a new session. herdr sends `agent: null` until it detects
  the new agent, and the agent mark on Overview read letters from that null kind. The mark now
  shows an empty tile for an agent with no kind yet. The app types now allow null for the kind,
  the folder and the terminal title, as the herdr API schema says.
- The installer unpacks herdlingd in `~/.cache/herdling`, not in `/tmp`. On systems that mount
  `/tmp` with `noexec` (for example TrueNAS), the install failed with "Permission denied".
- Thread: the gap between the newest row and the "Working" pill is 12 pt, the same as the gap between
  two rows. It was 8 pt.
- New session: with the keyboard up, the start bar (first prompt, microphone and Start button)
  sits fully above the keyboard. In the modal sheet below the native header, the keyboard covered
  the bottom of the bar and the Start button. A long first prompt made the bar taller and the cut larger.

### Changed

- **Voice input records with the phone's microphone.** A car or Bluetooth headset no longer
  switches to call mode when you tap the mic, so the first second of speech is not cut off.
  Audio output stays on the car or headset. Settings > Voice input > "Use Bluetooth microphone"
  turns the old behavior back on. iOS only; needs a native build (older builds ignore the setting).
- **Dashboard tiles show the facts, not the screen.** Each tile shows the agent mark, the name and
  the status with its time ("Working · 4m"), then the folder (and the computer when more than one
  is connected). The main text is the question when the agent needs you, else the activity, else
  the last reply, else the background command. The terminal snippet is gone.
- A long press on a message in the thread dims it. It no longer makes the message smaller.
- The product name changed from the working name to Herdling. The companion is now `herdlingd`.
- The app no longer asks for permissions it does not use (Face ID, storage, biometrics, overlay, boot).
- **Clearer agent questions.** The menu above the composer shows the question from the screen
  ("Claude asks …"). Each option shows a short title and a muted detail of 2 lines; a chevron
  shows the full detail. A "Recommended" option gets a gold chip and a gold edge. "Type something."
  and "Chat about this" are small buttons under the list. A long menu scrolls and takes at most
  about half of the screen, so the thread stays visible. Yes / No permission menus keep compact rows.
  After "Type an answer", the next send goes into the agent's text field as one line plus Enter.
