# herdlingd 0.2.0: Herdr 2 only (plan E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** herdlingd 0.2.0 talks only to herdr-core. The herdr 1 client and every herdr 1 call path go. Old apps (1.0.0, 1.0.1) keep every action, because each herdr 1 method that they send gets its Herdr 2 meaning, and the entries lose the `hc:` and `backend` markers that made old apps hide actions.

**Architecture:** `rpc::herdr_call` sends every call to `core::route`, which already translates herdr 1 calls on core ids (plans A, C, D). A new pure module `core/ids.rs` owns the id scheme: plain ids, one form per kind, and the legacy `hc:` prefix stripped on input. `serve` keeps only the core watcher. The shared process helpers of `herdr_update.rs` stay for the core install; the herdr 1 update goes.

**Tech Stack:** Rust (tokio, serde_json), herdr-core JSON-RPC generation 1, the fake core in `companion/tests/support/fake_core.rs`; Expo app (TypeScript, Jest).

**Spec:** `docs/superpowers/specs/2026-11-13-herdr2-main-backend-design.md` ("Removing herdr 1", "Decisions", anti-goals). Follow-ups of plans A, B, C, D and F1 in `docs/superpowers/plans/`.

## Global Constraints

- Worktree `.claude/worktrees/herdr2-remove`, branch `herdr2-remove` (from `herdr2-only`). Do not push, tag, release, install or deploy.
- A parallel agent (plan F2) changes `app/src/thread/`, `app/src/terminal/`, `app/src/hosts/`, themes and adds one companion method (`machines.suggest`). Keep `rpc.rs` `METHODS`/`dispatch` edits to removals and small changes. App edits only in `app/src/board/`, `app/src/newSession/`, `app/src/herdr/`.
- Anti-goals (a failure even when tests pass): an old app loses Herdr 2 agents or gets broken titles; an old app's herdr 1 call crashes or hangs (it gets an answer or a clear `unsupported`); a herdr 1 user silently loses the app.
- No test touches the live core. Fakes in `companion/tests/support/`. Delete a herdr 1 test only when its feature is gone; port a test that still describes a behaviour.
- A `CARGO_TARGET_DIR` on the build volume, `nice -n 15 cargo test -j 2`, `nice -n 15 cargo clippy -j 2 --all-targets -- -D warnings`. No `cargo fmt` over the crate. App: `pnpm exec tsc --noEmit`, `nice -n 15 pnpm test --maxWorkers=2`.
- Test data `sam`, `/home/sam/proj`, `studio.local`. ASD-STE100 in comments, docs and UI text.
- The installer's `--quiet` lines and the release asset names do not change.

## Decisions

- **The id scheme** (`core/ids.rs`). Every id is plain (no `hc:`), and no entry or event has `backend`. One form per kind, so two kinds never share an id:

  | Kind | Id | Example |
  |---|---|---|
  | pane (terminal) | the terminal address: no `:` and no `/` | `t7` |
  | workspace of a Herdr app space | `space:<space id>` | `space:sp3f…` |
  | workspace of a fallback group | `g:<group key>` (key: `[a-z0-9-]`) | `g:api` |
  | tab of a Herdr app tab | `tab:<tab id>` | `tab:tb91…` |
  | task tab (one terminal) | `task:<address>` | `task:t7` |

  A pane id has no `:`; every other id has a kind word and a `:`, so the kinds cannot collide. A space id taken raw (as the spec example says) could equal a terminal address (a label `herdr.space=t9`), and herdlingd could not tell a space from a group without a projection; the kind word fixes both. Input ids that start with `hc:` lose that prefix once, so saved app state of 0.1.x (`hc:t7`, `hc:space:sp1`) names the same entry. `hc:loose` becomes `loose`: not a pane of the core (`pane_not_found`), not a workspace (`workspace_not_found`), not a tab (`tab_not_found`).
- **Every `herdr.call` goes to the core.** The id comes from the first non-empty string of `pane_id`, `target`, `tab_id`, `workspace_id`. Calls with no id: `session.snapshot`, `workspace.list`, `workspace.create` (the core is the default; `backend: "core"` is still accepted). Any other method with no id, or with no Herdr 2 meaning, gives `unsupported` with a message. No core socket or no core answer: `herdr_unavailable` (old apps show "herdr is not running").
- **`hello`:** `backends` has only `core`. `herdr_ok` is true when the core answers, `herdr_version` is the core version, `herdr_protocol` is left out. Old apps then show "herdr ok (0.1.20)" and no "herdr is not running" banner while the core runs. `methods` loses nothing: each method works on the core.
- **`herdr.subscribe`:** only the core stream (the two-leg merge goes). An explicit `events` list filters the translated lines by `event` name. When the core stream ends, the app gets `{closed: true}` and subscribes again, as with herdr 1.
- **`herdr.update`** always installs the pinned core (`core_install::install`), never down. `herdr_update_target` and the herdr 1 `herdr update --handoff` path go. The process helpers in `herdr_update.rs` stay (the core install uses them).
- **`git.worktree_add`:** git makes the worktree, then a shell opens in a new space (`via: "herdr"`). The herdr `worktree.create` path (`worktree.rs`) goes.
- **Desk activity goes.** Only herdr 1 reported focus and typing at the desk. `serve/desk.rs`, `phone_input.rs` and the "quiet at the computer" hold-back go; `quiet_at_desk` stays in the config and the protocol (old apps send it) and has no effect.
- **Previews:** `agents.preview` reads only the core. Claude background tasks (`background`) move to the core preview, with the agent start from the terminal record.
- **Transcripts:** `thread.resolve` uses `transcript::resolve_core` for every pane. The herdr 1 resolvers (`transcript::resolve`, `claude::resolve`) go; `claude::session_from_info` stays.
- **`shell.watch`** stores the plain pane id. The serve core loop checks every watch.
- **0.2.0:** `companion/core-pin.json` `"required": true`; `companion/Cargo.toml` version `0.2.0` (and `Cargo.lock`). No tag, no release.
- **App (works with 0.1.x and 0.2.0):** a host is "Herdr 2 only" when `hello.backends.core` is present and `hello.backends.herdr` is not (`setCoreActions` stores it). `isCoreEntry(t, hostId)` = `isCore(t)` or the host is Herdr 2 only. `renameKindsFor(t, hostId)` and the free task name use it, so a 0.2.0 host shows only the task rename. `canMove` checks only `group_source` (only core entries have it) and `pane.move`. `workspaceForCwd` keeps core workspaces (`startSession` and `startShell` already drop a workspace that `allows(…, "newTab", hostId)` refuses). `startsOnCore` already needs `session.start` and `hello.backends.core`.

## Review Focus

1. An old app's restart of the last agent of a label space that the Herdr app has not saved yet: `pane.close`, then `workspace.get` gives `workspace_not_found`, then `workspace.create` without `backend` must make a new space on the core — test in Task 4 (`restart_keep_conversation_of_the_last_pane`).
2. Saved 0.1.x ids (`hc:t1`, `hc:space:sp1`, `hc:tab:tb1`, `hc:task:t1`, `hc:g:api`) in every call kind, and `hc:loose` as pane, tab and workspace id — test in Task 2 (`legacy_ids_name_the_same_entries`, `loose_ids_are_not_found`).
3. A call while no core runs: an answer `herdr_unavailable`, never a hang — test in Task 1 (`no_core_gives_herdr_unavailable`).
4. A herdr 1 method that has no Herdr 2 meaning (`pane.split`, `workspace.focus`): `unsupported`, not `unknown_method` and not a hang — test in Task 4.
5. A label space id with a `:` or a `/` (`herdr.space=a:b`): the projection still gives unique ids, and `tab.create` on it gives `workspace_not_found`, not a panic — test in Task 2.

---

### Task 1: Every `herdr.call` and every pane method from the core

**Files:**
- Modify: `companion/src/rpc.rs` (`herdr_call`, `hello`, `session_snapshot`, `workspace_list`, `pane_answer`, `thread_resolve`, `agents_preview`, `pane_info`, `pane_roots`, `git_worktree_add`, `herdr_update`, `herdr_subscribe`, `Ctx`), `companion/src/core/route.rs` (`target`), `companion/src/core/live.rs` (`call_any`), `companion/src/core/stream.rs`, `companion/src/watch.rs`, `companion/src/core/live.rs` previews (background), `companion/src/main.rs`
- Delete: `companion/src/herdr.rs`, `companion/src/events.rs` (the pure event helpers move to `core/events.rs`), `companion/src/core/merge.rs`, `companion/src/worktree.rs`, the herdr 1 parts of `preview.rs`, `transcript/mod.rs`, `claude/resolve.rs`, `herdr_update.rs`; tests/support `fake_herdr.rs`, `fake_herdr_events.rs`
- Test: new `companion/tests/support/rpc_session.rs` (session + fake core setup); port `rpc_basic.rs`, `rpc_subscribe.rs`, `pane_watch.rs`, `pane_answer.rs`, `agents_preview.rs`, `transcript_rpc.rs`, `claude_resolve.rs`, `commands_list.rs`, `repo_views.rs`, `worktree_add.rs`, `core_rpc.rs`, `core_actions_rpc.rs`, `herdr_update.rs`

**Interfaces:**
- Produces: `Ctx::new(home: PathBuf) -> Ctx` (no herdr socket; `herdr_update` field gone); `core::route::target(params: &Value) -> Option<String>`; `core::live::call_any(sock, timeout, method, params) -> Result<Value, RpcError>` (the router for every `herdr.call`).
- `core::stream::open(sock: CoreSocket, timeout, events: Option<Vec<String>>) -> Result<mpsc::Receiver<Value>, RpcError>`.

- [ ] Step 1: Port the tests to the fake core and write the new ones: `no_core_gives_herdr_unavailable` (no socket and a dead socket, `herdr.call pane.read` and `session.snapshot`), `hello_reports_the_core_as_herdr` (`herdr_ok: true`, `herdr_version: "0.1.19"`, `backends` keys `["core"]`), `hello_without_core` (`herdr_ok: false`, no `backends`), `workspace_create_defaults_to_the_core`, `worktree_add_defaults_to_the_core`, `herdr_update_installs_the_core`, `subscribe_filters_by_event_name`, `subscribe_reports_close_when_the_core_drops`, `preview_has_claude_background_for_core_agents`.
- [ ] Step 2: Run `nice -n 15 cargo test -j 2` — FAIL (compile errors on `Ctx::new`).
- [ ] Step 3: Implement; delete the herdr 1 modules and fakes.
- [ ] Step 4: Run all companion tests and clippy — PASS.
- [ ] Step 5: Commit "companion: answer every herdr call from Herdr 2" (several commits allowed: rpc, stream, modules).

### Task 2: Plain ids

**Files:**
- Create: `companion/src/core/ids.rs`
- Modify: `companion/src/core/project.rs` (ids, no `backend`), `actions.rs`, `route.rs`, `live.rs`, `events.rs`, `term_watch.rs`, `serve/core_watch.rs`, `core/tracker.rs`, `rpc.rs` (`shell.watch` stores the plain id)
- Test: `companion/tests/core_ids.rs`; update `core_pure.rs`, `core_actions.rs`, `core_actions_rpc.rs`, `core_rpc.rs` and the others to plain ids

**Interfaces:**
- `pub const LEGACY_PREFIX: &str = "hc:"`; `pub fn strip_legacy(id: &str) -> &str`; `pub fn pane(addr) -> String`; `pub fn space_ws(id) -> String`; `pub fn group_ws(key) -> String`; `pub fn space_tab(id) -> String`; `pub fn task_tab(addr) -> String`; `pub fn address(id) -> Option<&str>`; `pub enum Workspace<'a> { Space(&'a str), Group(&'a str) }`, `pub fn workspace(id) -> Option<Workspace>`; `pub enum Tab<'a> { Space(&'a str), Task(&'a str) }`, `pub fn tab(id) -> Option<Tab>`.
- `project::pane_id`, `project::address` call `ids`. `project::is_core_id` and `project::BACKEND` go.

- [ ] Step 1: Failing tests in `core_ids.rs`: `each_kind_has_its_own_form`, `kinds_never_collide` (a label space `t1` gives workspace `space:t1`, never `t1`), `legacy_prefix_is_stripped_once`, `loose_names_nothing`, `address_rejects_ids_of_other_kinds_and_machines`. In `core_pure.rs`: `entries_have_plain_ids_and_no_backend`. In `core_actions_rpc.rs`: `legacy_ids_name_the_same_entries`, `loose_ids_are_not_found`, `space_id_with_a_colon_is_not_found`.
- [ ] Step 2: Run — FAIL. Step 3: Implement. Step 4: Run all — PASS.
- [ ] Step 5: Commit "companion: give Herdr 2 entries plain ids".

### Task 3: Serve watches only the core

**Files:** Modify `companion/src/serve/mod.rs`, `serve/core_watch.rs` (owns `deliver`), `serve/shells.rs` (no `Backend`); delete `serve/watch.rs`, `serve/desk.rs`, `phone_input.rs`, `push::describe`; tests: delete `serve_desk.rs`, port `serve_watch.rs` (pushes, prefs, unregistered token, reconnect, choice buttons) and `serve_shells.rs` to the fake core.

- [ ] Step 1: Port tests: `pushes_finished_to_expo`, `respects_prefs`, `clears_unregistered_token`, `reconnects_after_a_core_restart`, three choice-button tests, `foreground_nudge_sends_the_shell_push_before_the_poll`.
- [ ] Step 2–4: fail, implement, pass.
- [ ] Step 5: Commit "companion: watch only Herdr 2 in herdlingd serve".

### Task 4: The old app's call sequences

**Files:** Test: `companion/tests/old_app.rs` (one test per row of the spec table, with the exact params that `app/src` on `main` sends).

Rows and tests:
- `session.snapshot`, `workspace.list`, `workspace.get`, `pane.get`, `pane.process_info` → `snapshot_and_reads_have_herdr_one_shapes` (task name as pane `label` and agent `name`, `display_agent`, plain ids, no `backend`).
- `pane.read`, `pane.send_input`, `pane.send_text`, `pane.send_keys`, `agent.prompt`, `pane.answer` → `typing_and_reading`.
- `pane.watch` → `pane_watch_streams_the_screen`.
- `herdr.subscribe` → `subscribe_has_herdr_one_lines`.
- New session: `workspace.create {cwd, label, focus}` / `tab.create {workspace_id, cwd, focus}`, `agent.start {name, kind, pane_id, args?}`, `agent.prompt {target, text}` → `new_session_in_a_new_workspace`, `new_session_in_an_existing_workspace`, `failed_start_undo_closes_the_tab`.
- `agent.rename {target, name}` (and `name: null`), `tab.rename`, `workspace.rename` → `renames`.
- `pane.close`, `tab.close`, `workspace.close {close_group: true}` → `closes`.
- Restart: `restart_new_conversation` (`tab.create` + `agent.start` + `pane.close`), `restart_keep_conversation` (`pane.close` + `workspace.get` + `tab.create` + `agent.start {args: ["--resume", id]}`), `restart_keep_conversation_of_the_last_pane` (`workspace.get` fails, `workspace.create` makes a new space).
- Resume: `resume_in_the_same_workspace`.
- `shell.watch` / `shell.watches` / `shell.unwatch` → `shell_watch_round_trip`.
- `agent.explain {target}` → `explain`.
- `herdr.update` → `herdr_update` (with no install context: `update_unavailable`).
- `git.worktree_add {cwd, branch}` → `worktree_then_agent_start_in_its_pane`.
- Methods with no meaning → `herdr_one_only_methods_are_unsupported` (`pane.split`, `workspace.focus`, `tab.focus`).

- [ ] Step 1: Write the tests. Step 2: Run; fix each failing row in `core/route.rs` or `core/live.rs`. Step 3: Run all — PASS.
- [ ] Step 4: Commit "companion: test the old app call sequences on Herdr 2".

### Task 5: 0.2.0

**Files:** `companion/core-pin.json` (`"required": true`), `companion/Cargo.toml` (`version = "0.2.0"`), `Cargo.lock`; test `core_install.rs` `pin_is_required` (the embedded pin).

- [ ] Step 1: Test, Step 2: change, Step 3: run all. Step 4: Commit "companion: herdlingd 0.2.0 needs herdr-core".

### Task 6: App follow-ups

**Files:** `app/src/herdr/backend.ts` (+ test), `app/src/herdr/moveGroup.ts` (+ test), `app/src/herdr/workspaceForCwd.ts` (+ test), `app/src/herdr/rename.ts`, `app/src/herdr/sessionActions.ts`, `app/src/newSession/spacePick.ts` test.

**Interfaces:** `coreOnly(hello: Pick<Hello, "backends"> | undefined): boolean`; `setCoreActions(hostId, hello)` also stores `coreOnly`; `hostIsCoreOnly(hostId?: string): boolean`; `isCoreEntry(t: BackendTarget, hostId?: string): boolean`; `renameKindsFor(t, hostId?)`.

- [ ] Step 1: Failing Jest tests: a 0.2.0 hello (`backends: {core}`, `session.start`) makes a plain-id entry give `renameKindsFor` = `["session"]` and `allows` every action; a 0.1.x hello with both backends keeps the old rules for `hc:` and plain ids; `canMove` is true for a plain-id entry with `group_source: "repo"` and `pane.move`, false for `space` and for no `group_source`; `workspaceForCwd` returns a core workspace; `startsOnCore` true for a 0.2.0 hello.
- [ ] Step 2–4: fail, implement, pass (`tsc`, Jest).
- [ ] Step 5: Commit "app: treat a Herdr 2 only host as Herdr 2".

### Task 7: Docs, site, store and checks

**Files:** `AGENTS.md`, `README.md`, `docs/protocol.md`, `CHANGELOG.md` (0.2.0 with the breaking notes for herdr 1 users), `site/public/*.md` (then `python3 site/scripts/sync.py`, `sh site/scripts/check.sh`), `store/`, this plan's Follow-ups.

- [ ] Step 1: "herdr" → "Herdr 2 (herdr-core)" where it names the runtime. Keep the installer contract.
- [ ] Step 2: Clippy, all tests, `tsc` in `app/` and `protocol/`, Jest. Privacy check of `git diff herdr2-only`.
- [ ] Step 3: Read-only live check: debug build; `printf` `hello`, `session.snapshot` and a passive `pane.watch` (no `cols`, `rows`) into `herdlingd rpc`. Confirm plain ids, groups, task names; no write method.
- [ ] Step 4: Commit "docs: herdlingd 0.2.0 works only with Herdr 2".

## Release order (for the maintainer)

Computers on 0.1.x run the core-install guard of plan B only when their herdlingd has it. So a 0.1.10 from `main` with the guard ships first, then 0.2.0. The maintainer decides. The 0.1.10 cherry-pick list from `herdr2-only` is in "Follow-ups" below (checked with `git merge-tree`).

## Follow-ups

### 0.1.10 cherry-pick list (from `herdr2-only`, onto `main`)

Plan B (the herdr-core install, `core.status`, `core.install`, and the install-first step of
`update.apply` for a release with `requires_core`). A 0.1.x computer needs it before it updates to
0.2.0: without it, `herdlingd update` replaces the binary and no core is installed.

In this order (each applies with no conflict on `main` at 8193c81, and `cargo test` passes after the seven: 680 passed, 0 failed; checked in a scratch worktree):

1. `db4226d` docs: plan B for the herdr-core install and update
2. `58b6a01` companion: install, update and status of herdr-core
3. `084499d` companion: core.status and core.install methods
4. `f665232` companion: install herdr-core first when a release needs it
5. `8cb0e7a` site: install herdr-core in the installer when herdlingd needs it
6. `2c70ad2` docs: herdr-core install, status and update
7. `583a09e` docs: mark plan B done and list its open questions

Then bump `companion/Cargo.toml` to 0.1.10 with a CHANGELOG entry. Keep `core-pin.json`
`"required": false` in 0.1.10, so 0.1.10 still works with herdr 1. Plans C, D and F2 are not
needed for the guard. The 0.2.0 manifest must say `requires_core: true`.

### Open points

- The site (`site/public/`) now describes 0.2.0. Deploy it only with the 0.2.0 release.
- The app demo host (`app/src/demo/`) still uses `hc:` ids, as a 0.1.x host does. The demo works;
  a 0.2.0 demo is a later change.
- The app's password setup still offers "Install herdr and herdlingd" (herdr 1) when herdr is
  missing. On 0.2.0 the installer installs the core, so the herdr 1 offer is not needed. Change
  it in the app (a JS change) after 0.2.0 ships.
- `hello` of 0.2.0 reports the core version as `herdr_version`. An old app shows it as the herdr
  version (for example "0.1.20").
