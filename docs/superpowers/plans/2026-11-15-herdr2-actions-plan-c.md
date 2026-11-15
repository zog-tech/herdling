# Herdr 2 actions (plan C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every herdr 1 action that the app sends gets a Herdr 2 meaning for a core (`hc:`) entry, and herdlingd gets three new methods (list groups, move a pane, start an agent) and the `herdlingd group` command.

**Architecture:** A new pure module `core/actions.rs` holds the rules: the labels of a new or moved terminal, the new space and tab ids, the agent command line, the members of a tab or space, the explain answer and the group list. `core/route.rs` gets `action()`, which turns a herdr 1 call on a core id into one `Action`. `core/live.rs` does the I/O of each action. A pure state machine in `core/start.rs` drives the steps of a new agent (shell, command, wait for the agent, first prompt).

**Tech Stack:** Rust (tokio, serde_json, rand), herdr-core JSON-RPC generation 1, the fake core in `companion/tests/support/fake_core.rs`, TypeScript types in `protocol/`, the app demo host.

**Spec:** `docs/superpowers/specs/2026-11-13-herdr2-main-backend-design.md` (goals 5 and 6, "Removing herdr 1" table, `herdlingd group`). Plan A (`2026-11-14-herdr2-groups-plan-a.md`) is done. Later plans: B (install and update of herdr-core), D (terminal view, `pane.watch`), E (delete herdr 1, drop the `hc:` markers, 0.2.0), F (app UI).

## Global Constraints

- Branch `herdr2-only`. Small commits, prefix `companion:` or `docs:`, one short line, no period, a blank line and the reason, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git config user.name` is `zog-tech`. Do not push. Do not run `herdlingd install`.
- Never write the Herdr app layout document (`doc.set` on `herdr-app`). Only change the labels `herdling.group`, `herdling.name`, `herdr.space`, `herdr.tab`, and only in the calls that need them.
- No test touches the live core. Tests use `tests/support/fake_core.rs` and temp folders.
- Add fields and methods only; new fields optional. An unknown id gives `pane_not_found` (or `tab_not_found`, `workspace_not_found`), never a panic. A method with no Herdr 2 meaning gives `unsupported` with a clear message.
- Gate each core write call on the core `hello.methods`: a list that lacks the method gives `unsupported`; a missing list means "try".
- herdr 1 behaviour does not change. Calls with no `hc:` id go to herdr 1 as before, except where a new optional param (`backend: "core"`) asks for the core.
- Builds: `CARGO_TARGET_DIR` on the external build volume (AGENTS.md section 7), `nice -n 15 cargo test -j 2`, `nice -n 15 cargo clippy -j 2 --all-targets -- -D warnings`. No `cargo fmt` over the crate.
- Test data: user `sam`, `/home/sam/proj`, `studio.local`. ASD-STE100 for comments and docs.

## Decisions

- **A new terminal is a login shell, as the Herdr app makes them.** The Herdr app runs `["/bin/zsh", "-l"]` with `keep: true` and types the agent command into it (seen with `hc get` on 2026-11-15). herdlingd does the same: `terminal.run {argv: [$SHELL, "-l"], cwd, labels, keep: true, no_parent: true}`. With no absolute `$SHELL`, `argv` is empty (the core's own shell). This keeps the herdr 1 two-step flow of the app: `tab.create` / `workspace.create` make the shell, `agent.start` types the agent command.
- **New ids** look like the Herdr app ids: `sp` or `tb` and 32 lower-case hex digits (16 random bytes).
- **Placement of a new terminal** (`tab.create`, `session.start`): workspace `hc:space:<id>` → `herdr.space=<id>`, `herdr.tab=<new tab id>`; no workspace or "new space" → a new space id and a new tab id; `hc:g:<key>` of a `label` group → `herdling.group=<group label>`; `hc:g:<key>` of a repo or folder group → no labels (the folder places it).
- **`agent.start` on a core pane** types `<program> <args>` (shell-quoted) with `terminal.send`. The program comes from `agents::AGENT_BINS` (first name). An unknown kind gives `bad_request`. The herdr agent `name` param is ignored: it is a generated name, not a task name.
- **`agent.prompt` on a core terminal with no 7501 status** gives `agent_not_ready` ("not an active named agent yet"). The app already retries on this text after `agent.start`. So a prompt never goes into the shell before the agent runs.
- **Restart and resume** need no own code path: the app composes them from `tab.create`, `agent.start` (with the resume `args`), `workspace.get` and `pane.close`. Each of these works on core ids after this plan. The new terminal is a new tab of the same space, as in herdr 1.
- **`agent.rename`** sets `herdling.name` (an empty or null name removes it). `tab.rename` of a task tab `hc:task:<address>` does the same for that terminal. `tab.rename` of `hc:tab:` and every `workspace.rename` give `unsupported`: the Herdr app owns those names. `task_name` and `push_text` take `herdling.name` first.
- **`tab.close` and `workspace.close`** kill each terminal of that tab or workspace in the projection (`terminal.kill`). An id that the projection does not hold gives `tab_not_found` or `workspace_not_found`. `close_group` is ignored.
- **`agent.explain`** answers the herdr 1 shape from `terminal.get` and `terminal.read`: the status comes from the agent itself (OSC 7501), so `screen_detection_skipped: true`, one rule `osc-7501` that matched, and the last screen lines as its evidence.
- **`workspace.get`** on a core id answers from the projection. **`workspace.list`** adds the core workspaces to the herdr 1 list, as `session.snapshot` does.
- **`workspace.create {backend: "core", cwd}`** makes the shell in a new space. Without `backend: "core"` the call goes to herdr 1 as before. Plan E makes the core the default.
- **`git.worktree_add {backend: "core"}`**: git makes the worktree, then herdlingd starts a shell in a new space in the worktree folder. The result has `via: "herdr"` and core ids, so an app that knows `via: "herdr"` starts the agent in that pane.
- **`shell.watch` on a core pane** is stored as for herdr 1. `serve` checks core watches from the core loop: `terminal.get` → `project::process_info` → `shell_watch::probe`, every `POLL` and early after a core `foreground` event of a watched pane. A finished or unknown terminal drops the watch.
- **New methods:** `groups.list`, `pane.move`, `session.start` (details in Task 4).
- **Move only for terminals in no space.** A terminal in the layout document or with a `herdr.space` label gives `unsupported` for `pane.move`. Whether the Herdr app moves a terminal that is already in a space when its labels change is not known (see Follow-ups).

## Review Focus

1. A `tab.close` or `workspace.close` with a stale or `hc:loose` id must kill nothing and answer `tab_not_found` / `workspace_not_found` — test in Task 3.
2. A core whose `hello.methods` lacks `terminal.run` or `terminal.label` (an older core): the action answers `unsupported` and changes nothing — test in Task 3.
3. `agent.prompt` right after `agent.start`, before the agent reports a status: the text must not go into the shell — test in Task 3.
4. An agent kind with arguments that hold spaces or quotes (`--resume`, a prompt): the typed line must be quoted so the shell runs exactly that argv — test in Task 1.
5. `pane.move` on a terminal that the Herdr app already holds: refuse, and change no label — test in Task 4.

---

### Task 1: Pure action rules

**Files:**
- Create: `companion/src/core/actions.rs`
- Modify: `companion/src/core/mod.rs`, `companion/src/core/groups.rs` (`task_name` takes `herdling.name` first), `companion/src/core/project.rs` (`push_text` the same; stale tab id guard in rule 2)
- Test: `companion/tests/core_actions.rs`, `companion/tests/core_pure.rs`

**Interfaces (all in `herdlingd::core::actions`):**
- `pub const NAME_LABEL: &str = "herdling.name"; SPACE_LABEL = "herdr.space"; TAB_LABEL = "herdr.tab";`
- `pub struct ActionError { pub code: String, pub message: String }` with `fn not_found(kind, id)`, `fn unsupported(msg)`, `fn bad(msg)`; `impl From<ActionError> for RpcError`.
- `pub fn new_id(prefix: &str, bytes: [u8; 16]) -> String` — `prefix` + 32 hex digits.
- `pub struct NewIds { pub space: String, pub tab: String }` and `pub fn fresh_ids() -> NewIds` (uses `rand`; the only impure function here).
- `pub enum Place { Space(String), NewSpace, LabelGroup { key: String, label: String }, Folder { key: String } }`
- `pub fn place_of(workspace_id: Option<&str>, p: &Projection) -> Result<Place, ActionError>` — `None` → `NewSpace`; `hc:space:<id>` → `Space(id)`; `hc:g:<key>` in `p` → `LabelGroup` when its panes have `group_source: "label"`, else `Folder`; other ids → `workspace_not_found`.
- `pub fn place_labels(place: &Place, ids: &NewIds) -> Map<String, Value>`
- `pub fn shell_argv(shell: Option<&str>) -> Vec<String>` — `[shell, "-l"]` for an absolute path, else empty.
- `pub fn run_params(cwd: Option<&str>, labels: Map<String, Value>, argv: Vec<String>) -> Value` — `{argv, cwd?, labels, keep: true, no_parent: true}`.
- `pub fn placed_ids(place: &Place, ids: &NewIds, addr: &str) -> (String, String)` — the workspace and tab id of the new terminal, as the projection will show it: space → `hc:space:<id>` / `hc:tab:<tab>`; group → `hc:g:<key>` / `hc:task:<addr>`.
- `pub fn created(kind: &str, ws: &str, tab: &str, pane: &str) -> Value` — `{type: kind, workspace: {workspace_id}, tab: {tab_id, workspace_id}, root_pane: {pane_id, tab_id, workspace_id}}`.
- `pub fn shell_quote(s: &str) -> String` and `pub fn agent_line(kind: &str, args: &[String]) -> Result<String, ActionError>`.
- `pub enum Scope { Tab(String), Workspace(String) }` and `pub fn members(p: &Projection, scope: &Scope) -> Result<Vec<String>, ActionError>` — the terminal addresses.
- `pub fn workspace_get(p: &Projection, id: &str) -> Result<Value, ActionError>` — `{type: "workspace_info", workspace: <entry>}`.
- `pub fn explain(t: &Value, screen: &str) -> Value`
- `pub fn rename_labels(name: Option<&str>) -> Map<String, Value>` — trimmed; empty or none gives `""` (removes).
- `pub fn in_space(addr: &str, p: &Projection) -> bool` — the pane entry of `addr` has `group_source: "space"`.
- Added in Task 4: `group_name`, `MoveTarget`, `move_target`, `move_labels`, `where_is`, `merge_workspace_list` (Task 3).
- `pub fn groups(p: &Projection) -> Value` — `{groups: [{workspace_id, label, source, space_id?, terminals, agents, agent_status}]}`.

- [x] **Step 1: Write the failing tests** in `tests/core_actions.rs`: `new_ids_look_like_the_herdr_app_ids` (`new_id("sp", [0xab; 16])` = `"sp" + "ab"*16`), `place_from_workspace_ids` (none, space, label group, repo group, unknown → `workspace_not_found`, `hc:loose` → `workspace_not_found`), `place_labels_set_only_the_needed_labels` (space: two `herdr.*`; label group: only `herdling.group`; folder: empty), `agent_line_quotes_each_argument` (`claude --resume 'a b'`, `codex resume abc`, a single quote → `'it'\''s'`, unknown kind → `bad_request`), `members_of_tab_and_workspace` (doc space with two tabs; `hc:task:t3`; unknown → not found), `explain_has_the_herdr_one_shape`, `rename_labels_trim_and_remove`, `groups_list_counts`, `shell_argv_needs_an_absolute_path`. In `core_pure.rs`: `herdling_name_is_the_task_name`, `stale_tab_label_gets_a_task_tab` (a `herdr.tab` that a document space of another workspace holds → `hc:task:<addr>`).
- [x] **Step 2: Run** `nice -n 15 cargo test -j 2 --test core_actions --test core_pure` — FAIL (module missing).
- [x] **Step 3: Implement** `actions.rs`, the `herdling.name` rule and the tab guard.
- [x] **Step 4: Run** the same tests — PASS. Then the whole suite.
- [x] **Step 5: Commit** — "companion: add pure rules for Herdr 2 actions"

### Task 2: Fake core writes and the hello gate

**Files:**
- Modify: `companion/tests/support/fake_core.rs` (`terminal.run`, `terminal.label`, `hello.methods`), `companion/src/core/live.rs` (`require`)

**Interfaces:**
- Fake: `State.methods: Option<Vec<String>>` (None → every method the fake answers). `terminal.run` adds a live terminal `t<n>` (n = count + 1) with the given `cwd`, `labels`, `argv`, no status, and returns `{terminal: <record>}`. `terminal.label` merges labels; a value `""` removes the key. `terminal.kill` marks the record `state: "finished"`.
- `pub async fn require(c: &mut Client, methods: &[&str]) -> Result<(), RpcError>` in `live.rs`.

This task has no own test file: Task 3 tests use it. Commit with Task 3.

### Task 3: herdr 1 actions on core ids

**Files:**
- Modify: `companion/src/core/route.rs` (`Action`, `action()`), `companion/src/core/live.rs` (`call` runs an `Action`), `companion/src/rpc.rs` (`herdr_call`: `workspace.create {backend: "core"}`, `workspace.list` merge)
- Test: `companion/tests/core_actions_rpc.rs`

**Interfaces:**
- `pub enum Action { Call(Plan), Run { kind: &'static str, workspace: Option<String>, cwd: Option<String> }, Start { addr, line }, Prompt { addr, text }, Label { addr, labels }, Kill(Scope), Explain { addr }, WorkspaceGet(String) }`
- `pub fn action(method: &str, params: &Value, id: &str) -> Result<Action, ActionError>` — falls back to `plan()` for the single-call rows.
- `live::call` keeps its signature.

- [x] **Step 1: Write the failing tests** (rpc session with the fake core, as `core_rpc.rs`):
  - `tab_create_in_a_space_runs_a_labelled_shell`: `tab.create {workspace_id: "hc:space:sp1", cwd: "/home/sam/proj"}` → one `terminal.run` with `labels` = `{herdr.space: "sp1", herdr.tab: tb…}`, `keep: true`, and the answer `root_pane.pane_id` = `hc:t3`, `workspace.workspace_id` = `hc:space:sp1`.
  - `workspace_create_for_the_core_makes_a_new_space`: `backend: "core"` → new `sp…` and `tb…` labels.
  - `agent_start_types_the_agent_command`: `agent.start {pane_id: "hc:t2", kind: "claude", args: ["--resume", "abc"]}` → `terminal.send {terminal: "t2", text: "claude --resume abc"}`.
  - `prompt_waits_for_the_agent`: on `t2` (no status) → error `agent_not_ready`, no `terminal.send`; on `t1` → `terminal.send`.
  - `restart_sequence_of_the_app` and `resume_sequence_of_the_app`: `workspace.get`, `tab.create`, `agent.start`, `pane.close` → the calls the app expects and one `terminal.kill` of the old pane.
  - `rename_sets_only_herdling_name`: `agent.rename` → `terminal.label {labels: {"herdling.name": "fix login"}}`; null name → `""`; `tab.rename` of `hc:task:t1` → same; `tab.rename` of `hc:tab:x` and `workspace.rename` → `unsupported`.
  - `close_tab_and_workspace_kill_their_terminals`, `close_unknown_ids_kill_nothing` (`hc:loose`, `hc:tab:none`).
  - `explain_reads_the_screen`.
  - `old_core_without_the_method_is_unsupported`: `State.methods` without `terminal.run` → `tab.create` gives `unsupported`, no `terminal.run`.
  - `workspace_list_adds_core_workspaces`.
- [x] **Step 2: Run** `nice -n 15 cargo test -j 2 --test core_actions_rpc` — FAIL.
- [x] **Step 3: Implement** Task 2 and Task 3.
- [x] **Step 4: Run** all companion tests — PASS.
- [x] **Step 5: Commit** — "companion: give herdr 1 actions a Herdr 2 meaning"

### Task 4: New methods `groups.list`, `pane.move`, `session.start`

**Files:**
- Create: `companion/src/core/start.rs` (pure state machine)
- Modify: `companion/src/rpc.rs` (`METHODS`, `dispatch`), `companion/src/core/live.rs`, `protocol/src/index.ts`, `app/src/hosts/methods.ts`, `app/src/demo/DemoTransport.ts`
- Test: `companion/tests/core_start.rs` (machine), `companion/tests/core_actions_rpc.rs` (methods), the existing `rpc_basic.rs` method-list test, the demo test.

**Interfaces:**
- `groups.list {}` → `{groups: [{workspace_id, label, source, space_id?, terminals, agents, agent_status}]}`. No core → `unsupported`.
- `pane.move {pane_id, workspace_id?: "hc:space:<id>", new_space?: bool, group?: string}` → `{pane_id, workspace_id, tab_id}`. Exactly one of the three targets. `workspace_id`/`new_space` set `herdr.space` and a new `herdr.tab`; `group` sets `herdling.group` (an empty group removes it). A terminal in a space → `unsupported`.
- `session.start {cwd, kind, workspace_id?, prompt?, args?}` → `{pane_id, workspace_id, tab_id, prompt_error?}`.
- `core::start`: `pub enum State { Shell, Command { addr }, Waiting { addr, tries }, Prompt { addr }, Done }`, `pub enum Input { Ran(String), Typed, Record(Value), Sent, Failed(String) }`, `pub enum Effect { Run, Type { addr, line }, Wait(Duration), Get(String), Send { addr, text }, Kill(String), Finish(Outcome) }`, `pub enum Outcome { Started { addr, prompt_error: Option<String> }, Failed(String) }`, `pub fn begin() -> (State, Vec<Effect>)`, `pub fn step(state: State, input: Input, plan: &Plan) -> (State, Vec<Effect>)` where `Plan { line, prompt: Option<String>, max_tries: u32, wait: Duration }`. A failed command kills the new terminal and gives an error; a failed or timed-out prompt gives `Finish(Ok(Some(prompt_error)))`.

- [x] **Step 1: Write the failing tests**: each state and input of `step` (including impossible pairs → `Done` with an error), `groups_list_counts_spaces_and_groups`, `pane_move_to_new_space_sets_two_labels`, `pane_move_to_group_sets_one_label`, `pane_move_refuses_a_terminal_in_a_space`, `session_start_runs_types_and_prompts` (fake terminal gets a status before the prompt), `session_start_without_core_is_unsupported`.
- [x] **Step 2: Run** — FAIL.
- [x] **Step 3: Implement**; add each method to `METHODS`, `APP_METHODS`, the protocol types and the demo host.
- [x] **Step 4: Run** companion tests, `pnpm exec tsc --noEmit` in `app/` and `protocol/`, `pnpm test --maxWorkers=2` in `app/` — PASS.
- [x] **Step 5: Commit** — "companion: list groups, move panes and start agents on Herdr 2"

### Task 5: `git.worktree_add` on the core

**Files:** Modify `companion/src/rpc.rs` (`git_worktree_add`), `protocol/src/index.ts` (`backend?: "core"` param). Test: `companion/tests/core_actions_rpc.rs`.

- [x] **Step 1: Write the failing test** `worktree_for_the_core_opens_a_new_space`: a temp git repo (skip with a message when `git` is missing), `git.worktree_add {cwd, branch: "fix-x", backend: "core"}` → the folder exists, one `terminal.run` with `cwd` = the worktree and two `herdr.*` labels, the answer has `via: "herdr"`, `workspace_id` `hc:space:sp…`, `pane_id` `hc:t3`.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [x] **Step 5: Commit** — "companion: make worktrees for Herdr 2 in a new space"

### Task 6: `shell.watch` on core panes

**Files:** Modify `companion/src/rpc.rs` (`shell_watch` accepts core ids), `companion/src/serve/shells.rs` (`poll` takes a `Backend`), `companion/src/serve/watch.rs` (herdr 1 loop checks non-core watches only), `companion/src/serve/core_watch.rs` (core loop checks core watches, nudged by `foreground` events). Test: `companion/tests/serve_shells.rs` (or a new `core_shells.rs`).

**Interfaces:** `pub enum Backend<'a> { Herdr, Core(&'a CoreSocket) }` and `pub fn core_probe(r: Result<Value, CoreError>) -> Probe` in `serve/shells.rs`: not found, finished or a record that is not live → `Gone`; other error → `Unknown`; else `probe(process_info)` with the foreground folder. `pub fn core_watch::foreground_pane(params: &Value) -> Option<String>`.

- [x] **Step 1: Write the failing tests**: `core_probe_rules` (pure), `core_watch_sends_one_push_when_the_command_ends` (fake core: foreground pid ≠ shell pid, then equal → one push to the mock push server), `shell_watch_accepts_a_core_pane`.
- [x] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [x] **Step 5: Commit** — "companion: watch shell commands in Herdr 2 terminals"

### Task 7: `herdlingd group`

**Files:** Create `companion/src/group_cmd.rs`; modify `companion/src/lib.rs`, `companion/src/main.rs` (usage and subcommand). Test: `companion/tests/group_cmd.rs`.

**Interfaces:** `pub enum GroupCmd { Set(String), Clear }`, `pub fn parse(args: &[String]) -> Result<GroupCmd, String>` (no args, two names, a name over 64 characters or with control characters → error); `pub fn labels(cmd: &GroupCmd) -> Value`; `pub async fn run(cmd: GroupCmd, terminal: Option<String>, socket: Option<PathBuf>, fallback: Option<CoreSocket>) -> Result<String, String>` — needs `HC_TERMINAL_ID`, uses `HC_TERMINAL_SOCKET`, else the resolved socket.

- [x] **Step 1: Write the failing tests**: `parse_rules`, `group_sets_the_label_on_the_own_terminal` (fake core, `terminal.label {terminal: "t1", labels: {"herdling.group": "Clips"}}`), `clear_removes_it`, `outside_a_core_terminal_fails`.
- [x] **Step 2–4:** run, implement, run.
- [x] **Step 5: Commit** — "companion: add herdlingd group for Herdr 2 terminals"

### Task 8: Docs and a live read check

**Files:** `docs/protocol.md`, `CHANGELOG.md` (Unreleased herdlingd), `AGENTS.md` (`core/` row: `actions.rs`, `start.rs`; `group_cmd.rs`; `main.rs` subcommands), this plan's Follow-ups.

- [x] **Step 1:** Update the docs. Fix the plan A doc follow-up (the agent field list "`name` the task name"; the unnamed-space sentence under rule 2).
- [x] **Step 2:** Clippy clean, all tests, type checks.
- [x] **Step 3:** Privacy check of `git diff main`.
- [x] **Step 4:** Read-only live check: `nice -n 15 cargo build -j 2`, then `printf` a `hello`, a `session.snapshot` and a `groups.list` request into `$CARGO_TARGET_DIR/debug/herdlingd rpc`. No write method.
- [x] **Step 5: Commit** — "docs: Herdr 2 actions, new methods and herdlingd group"

## Follow-ups

Found while building plan C. None blocks plan C.

- **Open question (goal 6):** does the Herdr app move a terminal that is already in a space when its
  `herdr.space` and `herdr.tab` labels change? Not tested (it needs the live core). `pane.move`
  refuses a terminal in a space until the maintainer checks it at the desk.
- **Plan E:** `workspace.create` and `git.worktree_add` use the core only with `backend: "core"`.
  With herdr 1 gone, the core is the default. The restart of an agent whose space is gone (the last
  terminal of a space that is not in the layout document) calls `workspace.create` without the
  marker, so until plan E it goes to herdr 1.
- **Plan E:** `herdr.update` is still herdr 1 only (plan B makes it update herdr-core).
- **Plan F (app):** the app still hides rename, restart, resume, explain, close of groups, shell
  watch and new tabs for core entries (`app/src/herdr/backend.ts`, `CORE_HAS` is empty), and the
  demo host refuses `shell.watch` on a core pane. Turn each on behind `hello.methods` (the new
  methods) or a herdlingd version check. Use `groups.list`, `pane.move` and `session.start` for New
  session on Herdr 2 and "Move to group". Accept `via: "herdr"` with `hc:` ids in `worktreePane`.
- **Plan F:** `agent.rename` in the app checks the herdr agent name rule (lower case, 32
  characters). `herdling.name` has no such rule: the app can allow free text for a core agent.
- **Plan D:** the terminal view (`pane.watch`) of a new core shell.
- `agent.start` types the command into a login shell. A shell with a slow start script takes the
  typed text when it is ready. herdlingd does not wait for the shell prompt.
- `session.start` waits up to 60 seconds for an agent that never reports an OSC 7501 status (an
  agent kind with no Herdr 2 integration). It then gives `prompt_error`. The app should show the
  prompt again.
- `tab.close` and `workspace.close` kill every terminal of a Herdr app space, also plain shells.
  This is what herdr 1 did; the app asks before a group close.
- The demo host does not start agents with `session.start`; it answers `unsupported`.
