# Herdr 2 app board (plan F1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app shows Herdr 2 agents as full agents on one board, with the group, the task, the repo and the helpers of each agent. It adds a "Jump to a terminal" search, a Spaces tab with a space screen, a space picker in New session and "Move to group". Each new action works only when the host has the plan C methods.

**Architecture:** Pure modules hold the rules and have Jest tests next to them: the action gate (`herdr/backend.ts`), the task model (`board/tasks.ts`), the search (`board/jump.ts`), the spaces model (`spaces/spaces.ts`), the thumbnail poll machine (`spaces/thumbPoll.ts`), the space picker (`newSession/spacePick.ts`) and the move rules (`herdr/moveGroup.ts`). Screens and hooks are thin and call them. herdlingd gets one optional field, `parent_id`, so the app can put a helper under its task.

**Tech Stack:** Expo SDK 58, Expo Router native tabs, React 19.3, TypeScript strict, Jest (`jest-expo`), zustand. One small Rust change in `companion/src/core/project.rs`.

**Spec:** `docs/superpowers/specs/2026-11-13-herdr2-main-backend-design.md` (goals 2, 3, 4, 5, 6, 7, 9; slice 5). Plan C (`2026-11-15-herdr2-actions-plan-c.md`) follow-ups for plan F. Inspiration: the official Herdr mobile app (structure and behaviour only; Herdling's design system and words).

## Global Constraints

- Branch `herdr2-app-board` (from `herdr2-only`). Small commits: `board: …`, `app: …`, `companion: …`, `docs: …`, one short line, no period, a blank line, the reason, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git config user.name` is `zog-tech`. Do not push. No OTA, no build, no store action.
- Stay out of the plan F2 areas: `app/src/thread/`, `app/src/terminal/`, the key bar, the in-app banner, themes, "suggested computers" in `app/src/hosts/`. The only edit in `thread/` is the host id in the existing `allows(...)` calls of `SessionDetail.tsx` (one argument per call).
- JS only. No new native dependency. New PNG assets for the Android tab icon are bundled by Metro (OTA-safe).
- Old herdlingd (0.1.x, no plan C methods) keeps the old behaviour: every new action checks `hello.methods`.
- Async flows are state machines (a discriminated union and a pure reducer). Tokens only: no raw colors or sizes in styles.
- Checks in `app/`: `nice -n 15 pnpm exec tsc --noEmit`, `nice -n 15 pnpm test --maxWorkers=2`. Companion: `CARGO_TARGET_DIR` on the external build volume, `nice -n 15 cargo test -j 2 --test core_pure`, clippy with `-j 2`.
- Test data: `sam`, `/home/sam/proj`, `studio.local`. ASD-STE100 for comments, docs and UI text.

## Decisions

- **The action gate.** A host "has the core actions" when its `hello.methods` lists `session.start` (plan C added `groups.list`, `pane.move`, `session.start` and the Herdr 2 meaning of every herdr 1 action in one release). The connection stores this per host in a small store in `herdr/backend.ts` (`setCoreActions(hostId, hello)`). `allows(t, action, hostId?)` allows every action on a core entry of such a host. No host id, or an older host: the old rule (core entries get no herdr 1 action). This keeps `allows` sync and cheap, and every caller already knows the host id.
- **Rename of a core agent** is a free-text task name (`herdling.name`, plan C follow-up): no herdr name rule, and only the "session" rename. Tab and workspace renames of a core entry stay hidden (the Herdr app owns those names; herdlingd answers `unsupported`).
- **One board (goal 9).** No "Herdr 2" tag, no separate core section in "group by workspace", no " · Herdr 2" in the subtitle or the terminal detail. `CORE_LABEL` and `backendLabel` go.
- **Helpers (goal 4).** herdlingd adds the optional field `parent_id` (the pane id of the parent terminal, `hc:<address>`) to core agent and pane entries whose terminal has a parent on this machine. The app puts an agent under its task when `parent_id` names a live agent of the same host and that agent is not itself a helper of the helper (no loops). A helper is not its own card. The card says "2 helpers · 1 working". An old herdlingd sends no `parent_id`: every agent is a card, as before.
- **The task card (NOTES "Inbox").** A card with a `group` shows a letter tile (the first letter or digit of the group, one stable color per group from the new `colors.groupTile` palette, chosen by a hash of the group name), then the group name and the task name on one line. The second line: the computer, the agent kind, the repo line and the helper summary. The repo line is `repo · branch`; the repo is left out when it equals the group (goal 3). The right side keeps the bucket status with a short age ("Working · 3m"). The "Ready" bucket is the unread mark (its sage dot), so a card gets no second dot. A title that starts with the group ("webapp · login form") shows only the rest. Cards with no group keep the agent mark and the old title. Buckets, peek and swipes do not change.
- **Needs-you badge.** The Overview tab shows the count of blocked agents on online hosts (`NativeTabs.Trigger.Badge`). Helpers count too: a blocked helper needs the user.
- **Tabs.** Five tabs: Overview, Spaces, Usage, Automations, Settings. Spaces is second, next to the board, because it is the second way to find an agent. iOS shows five tabs with no "More" tab, and iPad turns them into the sidebar. Overview keeps its name: it holds the Dashboard top and the hosts, not only an inbox. Android gets new `spaces*.png` icons (Material "space dashboard" shape, drawn at 24, 48 and 72 px).
- **Spaces tab.** One section per online computer; one row per workspace of its snapshot (a Herdr app space or a fallback group; herdr 1 workspaces too). Row: the letter tile, the name, the tab map (each tab a small box of equal pane cells, colored by the pane status), and an attention badge (blocked count) or a working mark. "+" in the header opens New session.
- **Space screen** (`/space/[hostId]/[workspaceId]`, pushed from the tab or the board's "Open space"). Tab chips with an attention dot; the panes of the selected tab as thumbnails in a two-column grid (the snapshot has no layout geometry, so the real layout is not known). Each thumbnail: the task name, the status, the last lines of `pane.read` (`source: "visible"`) in small mono text. A tap opens the session. Actions: "+ Terminal" (a new shell tab in the space: `tab.create` on the workspace), "New agent" (New session with this space chosen), and "…": rename (herdr 1 workspace only) and "Close space" (gated on `closeGroup`, with a confirm).
- **A blocked helper** stays a card too: it needs the user, and a tap must open it, not its task.
- **Thumbnail poll.** Only the thumbnails of the selected tab of a focused space screen poll, every 6 seconds, one `pane.read` per pane, never more than 6 panes. A pure machine (`spaces/thumbPoll.ts`) holds `idle | polling(gen, panes)`; a tab change or a blur bumps the generation, and a result of an old generation is dropped.
- **New session on Herdr 2 (goal 5).** When the host has the core actions, New session loads `groups.list` (a small load machine: `idle | loading(gen) | ready | failed`) and shows a "Space" section: "New space" (the default) and one chip per group of source `space` or `label` (a repo or folder group cannot take a new terminal by label, so herdlingd places by folder; it is left out). A space that holds an agent in the chosen folder is selected first. An agent starts with `session.start {cwd, kind, workspace_id?, prompt?, args?}`; `prompt_error` opens the session with the prompt ready to send again. A shell uses `tab.create` (a space) or `workspace.create {backend: "core"}` (a new space). A worktree uses `git.worktree_add {backend: "core"}` and then `agent.start` in its pane, as now. An old host keeps the current flow and the "Where" chips.
- **Move to group (goal 6).** Only for a core agent or terminal with `group_source` other than `space`, on a host that lists `pane.move`. The card menu gets "Move to space…": a sheet with the spaces of `groups.list`, "New space" and "Name a group…" (a text prompt, at most 64 characters; empty removes the label). The snapshot refreshes from the event stream.
- **The chat view for core agents (goal 7)** follows the gate: `allows(agent, "thread", hostId)`. herdlingd already resolves core transcripts.
- **Demo.** The demo host acts as a plan C herdlingd: every herdr action works on `hc:` ids (except the `unsupported` renames of spaces and app tabs), core agents have thread logs, entries carry `group`, `group_source`, `repo`, `branch` and `parent_id`, one helper works under a core task, one core agent is in no space (a repo group) and can move, `groups.list` lists every core group, `pane.move` and `session.start` work.

## Review Focus

1. An old herdlingd (no `session.start` in `hello.methods`): every core action stays hidden, New session uses the old flow — tests in Task 2 and Task 8.
2. A helper whose parent is gone or is a helper of it (a loop): it shows as its own card, never lost — test in Task 4.
3. The thumbnail poll stops on blur and on a tab change, and a late result does not show on the new tab — test in Task 7.
4. `pane.move` is never offered for a terminal in a space — test in Task 9.

---

### Task 1: herdlingd sends `parent_id`

**Files:** Modify `companion/src/core/project.rs` (`pane_entry`, `agent_entry`), `protocol/src/index.ts`, `app/src/herdr/snapshot.ts`, `docs/protocol.md` ("Group and task fields"). Test: `companion/tests/core_pure.rs`.

- [x] Step 1: Failing test `helper_entries_name_their_parent`: a terminal `t2` with `parent: "t1"` gets `parent_id: "hc:t1"` on its pane and agent entry; `t1` has none; a parent on another machine (`box/t1`) gives none.
- [x] Step 2: Run, see it fail. Step 3: implement (a pure helper `parent_pane_id(t)`). Step 4: run `core_pure` and clippy.
- [x] Step 5: Commit "companion: name the parent pane of a helper terminal".

### Task 2: The action gate per host

**Files:** Modify `app/src/herdr/backend.ts`, `backend.test.ts`, `app/src/hosts/connection.ts` (`setConn` calls `setCoreActions`), every caller of `allows`/`assertAllows` (`board/a11y.ts`, `board/AgentRow.tsx`, `board/PeekSheet.tsx`, `app/(tabs)/(overview)/index.tsx`, `app/run-command.tsx`, `herdr/sessionActions.ts`, `herdr/confirmActions.ts`, `herdr/rename.ts`, `herdr/startSession.ts`, `app/restart/…`, `app/resume/…`, `thread/SessionDetail.tsx` host id only).

**Interfaces:** `coreActions(hello): boolean`; `setCoreActions(hostId, hello)`; `allows(t, action, hostId?)`; `assertAllows(t, action, hostId?)`; `renameKindsFor(t, hostId)`; `StartOptions.hostId?`; `RestartPlan.hostId?`; `resumeSession(rpc, a, session, hostId?)`; `renameAgent(rpc, paneId, name, opts?: { free?: boolean; hostId?: string })`.

- [x] Step 1: Failing tests: a core entry of a host with `session.start` allows all 8 actions; without it, none; a herdr 1 entry always all; `renameKindsFor` gives only `session` for a core entry; `renameAgent` with `free` takes "Fix the login form".
- [x] Step 2–4: run, implement, run.
- [x] Step 5: Commit "app: allow Herdr 2 actions on hosts with plan C methods".

### Task 3: One board

**Files:** `board/buckets.ts` (no core split, no tag), `herdr/names.ts`, `herdr/terminals.ts`, `herdr/backend.ts` (drop `CORE_LABEL`, `backendLabel`), tests.

- [x] Step 1: Update tests: one "api" section for a herdr 1 and a core workspace of the same name; no "Herdr 2" in subtitles. Step 2–4. Step 5: Commit "board: show Herdr 2 agents on one board".

### Task 4: The task model

**Files:** Create `app/src/board/tasks.ts`, `tasks.test.ts`; modify `herdr/snapshot.ts` (optional `group`, `group_source`, `repo`, `repo_root`, `branch`, `parent_id`), `board/buckets.ts` (`BoardItem.group`, `task`, `repoLine`, `helpers`; `mergeBoard` folds helpers), `theme/tokens.ts` (`groupTile`).

**Interfaces:** `helperParents(agents): Map<string, string>` (helper pane → parent pane, loops and missing parents left out); `helperSummary(list): string | undefined`; `repoLine(entry): string | undefined`; `groupLetter(name): string`; `groupTone(name, n): number`; `needsYouCount(hosts): number`.

- [x] Step 1: Failing tests for each rule (loop, gone parent, helper of a helper, repo equal to group, empty group, stable tone).
- [x] Step 2–4. Step 5: Commit "board: fold helpers under their task and add the repo line".

### Task 5: Inbox cards and the tab badge

**Files:** Create `app/src/ui/GroupTile.tsx`; modify `board/AgentRow.tsx`, `board/a11y.ts` (the label says the group and helpers), `board/rowText.ts` (`shortAgo`), `app/(tabs)/_layout.tsx` (badge), tests (`AgentRow.test.tsx`, `rowText.test.ts`, `a11y.test.ts`).

- [x] Step 1: Failing tests: a card with a group shows the tile letter, "group" and "task", the repo line and "2 helpers · 1 working"; `shortAgo(190)` = "3m". Step 2–4. Step 5: Commit "board: show the group, repo and helpers on each card".

### Task 6: Jump to a terminal

**Files:** Create `app/src/board/jump.ts`, `jump.test.ts`, `app/src/app/jump.tsx` (a form sheet), register the route in `app/src/app/_layout.tsx`; add a search button to the board header and the Dashboard top.

**Interfaces:** `jumpEntries(hosts): JumpTask[]` (`{key, hostId, hostName, paneId, group?, task, branch?, bucket-like status, helpers: JumpHelper[]}`; terminals with no agent are tasks too); `filterJump(tasks, query): JumpTask[]` (words match the group, task, repo, branch, computer, folder or a helper; a helper match keeps its task).

- [x] Steps 1–4 (TDD on the pure part). Step 5: Commit "board: add a search to jump to any terminal".

### Task 7: Spaces tab and space screen

**Files:** Create `app/src/spaces/spaces.ts`, `spaces.test.ts`, `thumbPoll.ts`, `thumbPoll.test.ts`, `useThumbnails.ts`, `SpaceRow.tsx`, `TabMap.tsx`, `PaneThumb.tsx`; routes `app/src/app/(tabs)/spaces/_layout.tsx`, `index.tsx`, `app/src/app/space/[hostId]/[workspaceId].tsx`; modify `app/(tabs)/_layout.tsx`; assets `assets/images/tabs/spaces*.png`.

**Interfaces:** `hostSpaces(snapshot): Space[]` (`{workspaceId, label, tabs: SpaceTab[], attention, working, core}`; tabs `{tabId, label, panes: {paneId, status, title}[]}` in `number` order); `thumbPoll` `reducer(state, event) → {state, effects}` with events `show(panes)`, `hide`, `tick`, `result(gen, paneId, text)` and effects `read(gen, panes)`, `schedule(ms)`, `cancel`.

- [x] Steps 1–4 (TDD on `spaces.ts` and `thumbPoll.ts`). Step 5: Commit "app: add the Spaces tab and the space screen".

### Task 8: New session on Herdr 2

**Files:** Create `app/src/newSession/spacePick.ts`, `spacePick.test.ts`; modify `herdr/startSession.ts` (`startOnCore`, `core` option for `workspace.create`), `startSession.test.ts`, `app/new.tsx` (the "Space" section and the `host` and `workspace` params).

**Interfaces:** `spaceChoices(groups): SpaceChoice[]`; `firstChoice(choices, snapshot, cwd, asked?)`; `groupsLoad` reducer (`idle | loading | ready | failed`, with a generation); `startOnCore(rpc, {cwd, kind, workspaceId?, prompt?, args?}) → {paneId, promptError?}`.

- [x] Steps 1–4. Step 5: Commit "app: start new sessions in a Herdr 2 space".

### Task 9: Move to group

**Files:** Create `app/src/herdr/moveGroup.ts`, `moveGroup.test.ts`; modify `app/(tabs)/(overview)/index.tsx` (card menu).

**Interfaces:** `canMove(entry, hello): boolean`; `moveTargets(groups, current): MoveTarget[]`; `moveParams(paneId, target): PaneMoveParams`; `groupNameError(name)`.

- [x] Steps 1–4. Step 5: Commit "app: move a Herdr 2 terminal to a space or group".

### Task 10: Demo host as a plan C computer

**Files:** `app/src/demo/scenario.ts`, `DemoTransport.ts`, their tests.

- [x] Step 1: Failing tests: entries have the group fields; `hc:t3` has `parent_id: "hc:t1"`; `tab.create` on `hc:space:1` works; `pane.move` of the repo-group agent sets its space; `session.start` starts an agent and sends the prompt; `groups.list` lists the space and the repo group.
- [x] Step 2–4. Step 5: Commit "app: show spaces, groups and helpers in the demo".

### Task 11: Docs and checks

**Files:** `CHANGELOG.md`, `AGENTS.md` (map: `spaces/`, `board/tasks.ts`, `board/jump.ts`), `docs/protocol.md`, this plan's Follow-ups.

- [x] tsc, Jest, clippy, `core_pure`. Privacy check of `git diff herdr2-only`. Commit "docs: plan F1 app board for Herdr 2".

## Follow-ups

Found while building plan F1. None blocks it.

- **F2 (session screen):** `thread/SessionDetail.tsx` got only the host id in its `allows(...)`
  calls, so the chat view, restart, resume, explain, rename, shell watch and group close follow
  the per-host gate. A rename of a Herdr 2 agent is a free task name (`renameKindsFor`, the
  `TASK_PROMPT_TEXT` in `herdr/rename.ts`). The theme fixture has the new `groupTile` tones: a
  theme change in F2 must keep them (the theme test checks their contrast). The board row now
  shows the group tile and "group  task"; the session header can use `titleParts` and
  `repoLine` from `board/rowText.ts` and `board/tasks.ts` for "group · computer".
- **Plan E:** with the `hc:` markers gone, `isCore` is false and every action shows with no gate.
  Then `startsOnCore` (New session) still needs `session.start` and `hello.backends.core`.
  `canMove` uses `isCore`: plan E must keep a way to know a core terminal (for example
  `group_source`, which only core entries have). Change `canMove` to check `group_source` only.
- **Plan E:** `workspaceForCwd` still skips `hc:` workspaces; the old "Where" chips are only for an
  older herdlingd now.
- The tab map draws the panes of a tab side by side: the snapshot has no pane layout. A future
  herdlingd field with the layout of a Herdr app tab would let the map and the space screen show
  the real split.
- A blocked helper shows twice (a card, and under its task). This is on purpose; check with the
  maintainer.
- The board badge counts blocked agents from the snapshots, so it shows only while the app runs.
  The app icon badge is not changed.
- The Android `spaces*.png` tab icons are drawn by a script (three panes). Replace them with the
  Material "space_dashboard" symbol when the other tab icons are made the same way.
- `pane.move` and `session.start` have no undo in the app. A wrong move needs "Move to space…"
  again (only while the terminal is in no space).
