# Herdr 2 as the main backend, grouped by Herdr app spaces

Date: 2026-11-14. Status: draft for the maintainer's approval (revised: herdr 1 is removed).

## Intent

The maintainer moves from herdr 1 to Herdr 2 (herdr-core, CLI `hc`) on all computers. At the
desk, the maintainer uses the official Herdr desktop app (herdr-app, `herdrdev/herdr-app`),
connected over SSH to the computers that run the agents. Other desk apps are out of scope.

Herdling must treat a Herdr 2 agent as a normal agent, not as a guest in a catch-all section.
The phone and the desk must show the same groups, and work must move between them with no setup.

Herdr 2 has no workspaces of its own. The core keeps a flat list of terminals. Each terminal has
an address, a folder, a title, an optional agent status (OSC 7501), an optional parent terminal and
free-form labels. The Herdr app adds **spaces** and **tabs** on top:

- It saves them in the core of the machine that runs the terminals (the core document
  `herdr-app`), also for an SSH machine.
- It labels each terminal it starts with `herdr.space=<id>` and `herdr.tab=<id>`.
- A terminal that has those labels "shows up there, even one you start yourself". An id that the
  app does not know becomes a new space or tab, named by the app (herdr-app `defaults/AGENTS.md`).
- A space is "work on one machine, usually in one repo". An unnamed space follows the folder of
  its first terminal.

The maintainer looks for an agent **by project and by task**:

- A **project** is the git repo that an agent works in.
- A **task** is one agent. A new task is a new agent (not a new tab or a new worktree).

### The problem today (seen on 2026-11-13)

A Claude Code agent in terminal `t8` (folder `/home/sam/proj/api`, title "Fix the login
form") was started by another desk app, so it is in no Herdr app space and has no labels. herdlingd puts it
in the made-up workspace `hc:loose`, label "Herdr 2 terminals". The card shows "Herdr 2 terminals"
as the title, a "Cl" icon (from `display_agent: "claude-code"`) and screen text "(disable recaps in
/config)" as the preview, because herdlingd reads no transcript for core agents.

## Goals

1. **Groups are Herdr app spaces.** Every Herdr 2 terminal belongs to exactly one group. The group
   comes from, in order:
   1. the Herdr app space of the terminal (the layout document, else the `herdr.space` label);
   2. the label `herdling.group` (a fallback for terminals in no space, set from the phone or with
      `herdlingd group`);
   3. the repo: the name of the git root folder of the terminal's current folder;
   4. the name of the current folder.

   A space with no name takes the name of its folder, as the Herdr app shows it.
2. **Tasks.** Each agent is one card. The card title is the task name: the core terminal `name`,
   else the agent's 7501 title, else the terminal title, else the Herdr app tab name. Never the
   group name.
3. **Repo on the card.** Each card shows the repo name (and the branch, when known). When the group
   name is the repo name, the card does not repeat it.
4. **Helpers under their task.** A terminal whose `parent` is a live agent shows under that agent,
   as the subagents do now.
5. **New sessions start in Herdr 2, in a space.** On a computer with a core, New session starts the
   agent with `terminal.run` and the labels `herdr.space` and `herdr.tab`. The user picks an
   existing space, or "New space" (a new id, so the Herdr app makes a new space in that folder).
   Each new agent gets a new tab id, so it is its own tab at the desk. The agent then shows in the
   Herdr app with no action at the desk.
6. **Move to group from the phone.** For a terminal in no space, "Move to group…" sets
   `herdr.space` and `herdr.tab`, so the Herdr app takes it in. Whether the Herdr app moves a
   terminal that is already in a space when its labels change is not known: the builder checks it.
   If the app does not move it, the action is offered only for terminals in no space.
7. **Herdr 2 agents are full agents.** The chat view, the last reply on the card, the terminal view
   and the agent icon work as they do for herdr 1.
8. **Herdling sets up herdr-core.** See "Install and update of herdr-core".
9. **One board.** With herdr 1 gone, every entry is a Herdr 2 entry. The app drops the separate
   "Herdr 2" sections and the "Herdr 2" tags.
10. **herdlingd uses only Herdr 2.** See "Removing herdr 1".

## Non-goals

- Other desk apps. No labels or files of other desk apps.
- Moving running herdr 1 sessions to Herdr 2. The user closes them when done.
- A herdr 1 backend in herdlingd. It is removed.
- Worktrees, splits, renaming or deleting spaces and tabs from the phone.
- Writing the Herdr app layout document (`doc.set` on `herdr-app`). Never write it. Herdling uses
  only the documented labels.

## Anti-goals (a failure even if it works)

- An old app build (1.0.0, 1.0.1) loses Herdr 2 agents or shows broken titles after a new herdlingd.
- An old herdlingd breaks a new app.
- Herdling changes or removes a label that it did not set, except `herdr.space` and `herdr.tab` in
  goals 5 and 6.
- A test starts, stops or labels the user's live core.
- Any data goes to a Zog Tech server.
- A herdr 1 user updates herdlingd and silently loses the app. The update must stop or install
  Herdr 2 first, and say so (see "Removing herdr 1").
- An old app build calls a herdr 1 method that worked before and gets a crash or a hang. It gets
  the Herdr 2 answer, or a clear `unsupported` error.

## Install and update of herdr-core

Decisions of the maintainer:

- **Always.** "Install and pair", the installer and `herdlingd update` install herdr-core when it
  is missing and make sure the core runs. (The earlier "Use Herdr 2" switch is gone: there is no
  herdr 1 backend to switch from.)
- **Pinned version.** Each herdlingd release pins one tested herdr-core version and its checksum.
  herdlingd installs that version with a check of the checksum, not by running the upstream
  `install.sh` with no check. The Herdr app also updates the core, so herdlingd never downgrades a
  core. When the running core is newer than the pin, herdlingd works with it while `hello` shows a
  generation and the methods that it knows. It then reports the version on the host screen.


## Removing herdr 1

herdlingd 0.2.0 talks only to herdr-core. The herdr 1 socket client and every herdr 1 call path
go. **The app protocol stays.** Old app builds (1.0.0, 1.0.1) send herdr 1 method names through
`herdr.call` and read herdr 1 shapes, so herdlingd answers each of them from the core. This is the
translation that `companion/src/core/route.rs` does now for `hc:` ids, made complete.

The herdr 1 methods that the app sends, and their Herdr 2 meaning (the builder confirms each one
in `app/src`):

| herdr 1 method (old apps) | On Herdr 2 |
|---|---|
| `session.snapshot`, `workspace.list`, `workspace.get`, `pane.get`, `pane.process_info` | The projection (goals 1–4) |
| `pane.read`, `pane.send_input`, `pane.send_text`, `pane.send_keys`, `agent.prompt`, `pane.answer` | As now (`terminal.read`, `terminal.send`, `terminal.keys`) |
| `pane.watch` | The terminal view from the core (ANSI). Required before 0.2.0 ships |
| `herdr.subscribe` | The core events in herdr 1 shapes, as now |
| `agent.start`, `workspace.create`, `tab.create` | `terminal.run` with `herdr.space` and `herdr.tab` labels (new ids for a new workspace or tab) |
| `agent.rename`, `workspace.rename`, `tab.rename` | `agent.rename` sets the label `herdling.name`. Space and tab renames give `unsupported` (the Herdr app owns those names) |
| `pane.close`, `tab.close`, `workspace.close` | `terminal.kill` on the terminals of that pane, tab or space |
| restart and resume (the app's actions) | Kill, then `terminal.run` with the same command, folder and labels; resume adds the agent's resume argument and session |
| `shell.watch`, `shell.watches`, `shell.unwatch` | The same push rules, fed by core events (status and `lost` or `exited`) |
| `agent.explain` | The same feature, with the text from `terminal.read` |
| `herdr.update` | Updates herdr-core to the pinned version |
| worktrees (`git.worktree_add`) | `git worktree add`, then the agent starts in the new folder in a new space |

Rules:

- `hello.backends` reports only `core`. `hello.methods` lists only methods that work.
- **Old apps get every action back.** The 1.0.0 and 1.0.1 apps hide rename, restart, resume,
  explain, close, shell watch and the chat view for an entry with `backend: "core"` or an `hc:` id
  (`app/src/herdr/backend.ts`). With only one backend, herdlingd 0.2.0 drops both markers: plain
  ids (`t9`, a space or tab id) and no `backend` field, as herdr 1 entries had. Old apps then
  show all the actions, and the table above makes them work. A call with an old `hc:` id still
  works (herdlingd strips the prefix), so saved app state from 0.1.x keeps working.
- An id that names no terminal, tab or space gives `pane_not_found` (or the matching error), never
  a crash.
- A method with no Herdr 2 meaning gives `unsupported` with a clear message.
- **Users still on herdr 1.** `update.check` and `herdlingd update` find out if the computer runs
  herdr 1 and has no core. Then the update to 0.2.0 installs herdr-core first and says that herdr 1
  sessions do not show in Herdling any more. When the core install fails, the update stops and
  leaves the old herdlingd. The app shows this before it updates.
- `AGENTS.md`, `README.md`, `docs/protocol.md`, the site and the store text change from
  "herdr" to "Herdr 2 (herdr-core)".
- 0.2.0 ships only when every row of the table works. Until then the work stays on a branch, and
  herdlingd releases from `main` keep herdr 1.

## Constraints

- Compatibility rules in `docs/protocol.md`: add methods and fields only, make new fields optional,
  check `hello.methods` before a new method. Old apps read the snapshot in the herdr 1 shapes
  (workspaces → tabs → panes → agents), so herdlingd keeps that projection.
- herdr-core API: generation 1, a 0.x preview. Gate every call on `hello.methods`. Methods used:
  `terminal.list`, `terminal.get`, `terminal.label` (an empty value removes a label),
  `terminal.run` (has `labels`, `cwd`, `parent`, `name`, `keep`), `terminal.read`,
  `terminal.attach` (framed stream), `events.subscribe`, `doc.get`, `server.status`. Full list:
  `hc schema`.
- The Herdr app labels and the layout document are a 0.x preview too. Read them defensively: a
  missing or strange value gives the next group source, never an error.
- **App releases:** build 12 (1.0.1) is in App Store review since 2026-11-12. No OTA update to
  runtime 1.0.1 until the review ends. App changes are made now and ship after the review, or in a
  1.0.2 build that the maintainer approves. herdlingd changes can ship at any time (the maintainer
  releases).
- New JS must not need a native module that older binaries lack (AGENTS.md section 5).
- State machines, pure cores and tests as in AGENTS.md section 4.

## Decisions

From the maintainer:

- Groups by project and by task. The desk app is the Herdr app, so its spaces are the groups.
- The repo shows on every card.
- Move off herdr 1 completely: herdlingd drops its herdr 1 backend (decided 2026-11-14).
  Herdling installs herdr-core with a pinned version and a checksum.
- An agent started from the phone must show at the desk: the Herdr app labels do this.
- No work for other desk apps.

The writer's calls (the maintainer can change them):

- **herdlingd does the grouping**, not the app. Old apps then show the groups with no change. The
  projection for the old shapes:
  - one workspace per group: for a space, the space id with the `hc:` prefix (as now); for the
    other sources, `hc:g:<key>`, stable for a group name on one computer;
  - Herdr app tabs as tabs, as now. A terminal in no space gets one tab per task, with the task
    name as the tab label;
  - the task's helpers as more panes in that tab.
  The made-up workspace `hc:loose` goes away. A call with an old `hc:loose` id gives
  `pane_not_found` or the matching error, never a crash.
- The task name goes in the pane `label` and the agent `name`, so old apps show it as the title
  (`agentTitle` in `app/src/herdr/names.ts` takes the own name first).
- New optional fields on agent and pane entries: `group`, `group_source`
  (`space` | `label` | `repo` | `folder`), `repo` (name), `repo_root` (path), `branch`.
- For a known agent kind, `display_agent` carries the display name that the app's `AgentMark` knows
  (or is left out). This fixes the "Cl" icon in old apps too.
- A helper that reports its own status stays a full entry in `agents`. New apps show it under its
  task. Old apps show it as its own card. A blocked helper sends a "needs you" push.
- "Move to group" is only for Herdr 2 agents.
- `herdlingd group <name>` (and `--clear`) sets `herdling.group` on the current terminal. The core
  sets `HC_TERMINAL_ID` (for example `t9`) and `HC_TERMINAL_SOCKET` in each terminal (checked on
  2026-11-14 with herdr-core 0.1.20).
- The folder of a terminal is the foreground process folder (`foreground.cwd`), not the start
  folder (`cwd`). Example: terminal `t9` started in `/home/sam/proj/api`, and its agent works in
  `/home/sam/proj/web`. herdlingd already uses this rule (`cwd_now`).
- New RPC methods (names are the builder's call, in the protocol style):
  - list the groups on the computer (spaces and fallback groups), with counts;
  - move a pane to a group (goal 6);
  - start an agent on the core (`cwd`, agent kind, space or "new space", optional first prompt);
  - core status, install and update (`herdr.update` updates herdr-core).
- Transcripts for core agents use the same resolution as herdr 1: the foreground process pid →
  the agent's session log (Claude: `~/.claude/sessions/<pid>.json`). `thread.resolve` stops giving
  `session: null` for core panes.

## What is left to the builder

- The exact RPC method names, params and result types (`protocol/src/index.ts`, `docs/protocol.md`).
- How the terminal view gets its text from the core: `terminal.attach` with a terminal emulator in
  herdlingd, or `terminal.read` polling. The view must look like the herdr 1 view (ANSI colors).
- The group key format and how to find the git root and branch cheaply (cache per folder).
- How the installer decides that the core runs, and how it starts it on Linux (systemd user unit)
  and macOS (the launchd "Herdr Core" app).
- Where the pinned version and checksum live (for example next to the release manifest that
  `companion/src/update.rs` reads).
- The slice order. A suggested order:
  1. herdlingd: groups, tasks, helpers, repo fields, `display_agent` (fixes the screenshot with no
     app change).
  2. herdlingd: transcripts for core agents.
  3. herdlingd: start agents in a space, list groups, move to group, `herdlingd group`.
  4. herdlingd and installer: install, status, update of herdr-core, and the switch.
  5. App: one board (merge sections), repo line, New session on Herdr 2 with a space picker, Move
     to group, chat view for core, host screen core status and switch. Gate each on
     `hello.methods`.
  6. herdlingd and app: the terminal view for core panes.
  7. herdlingd: the rest of the "Removing herdr 1" table (close, restart, resume, rename, shell
     watch, explain, worktrees, update).
  8. herdlingd: delete the herdr 1 backend, the update guard for herdr 1 users, docs, 0.2.0.

## Tests

- Pure projection tests in `companion/tests/` for each group source and their order, a space with
  no name, helpers under a parent, a parent that is gone, a terminal with no folder, two groups with
  the same name on two computers, and an old `hc:loose` id.
- Label tests against a fake core client: only `herdling.group`, `herdr.space` and `herdr.tab`
  change, and only in the calls that the goals name.
- Install tests: a checksum mismatch stops the install; a newer core is never downgraded.
- App tests for the merged sections, the repo line and each new action behind `hello.methods`.
- No test touches the user's live core.

## Docs to update

`docs/protocol.md` ("Herdr 2 (herdr-core)"), `README.md`, `CHANGELOG.md`, `AGENTS.md` (the
architecture map, when new modules appear) and the site docs for setup.
