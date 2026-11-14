# Herdr 2 groups, tasks and transcripts (plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** herdlingd shows every Herdr 2 agent as a normal card: in its Herdr app space or a fallback group, with its task name, its repo, the right agent icon and its last reply from the transcript.

**Architecture:** The pure projection in `companion/src/core/project.rs` gets a new pure helper module `core/groups.rs` (group sources, task names, helpers) and takes a folder → repo map as input. A thin I/O module `core/repos.rs` fills that map with `git`. Core agents resolve their transcript from the core terminal record with the same rules that herdr 1 panes use, and their previews read that transcript. No app change: the 1.0.0 and 1.0.1 apps show the result.

**Tech Stack:** Rust (tokio, serde_json), herdr-core JSON-RPC (generation 1), the existing test fakes in `companion/tests/support/`.

**Spec:** `docs/superpowers/specs/2026-11-13-herdr2-main-backend-design.md` (goals 1–4 and 7, slices 1–2). This plan keeps the herdr 1 backend. Later plans: B (install and update of herdr-core), C (the "Removing herdr 1" table, start in a space, move to group, `herdlingd group`), D (the terminal view), E (delete herdr 1, 0.2.0), F (app).

## Global Constraints

- Branch `herdr2-groups` (already made from `main`). Small commits, prefix `companion:` or `docs:`, one short line, no period, a blank line and the reason, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Check `git config user.name` is `zog-tech` before the first commit. Do not push.
- Add fields only. New fields are optional. Never rename or remove an existing field of an entry.
- Never write the Herdr app layout document. This plan writes no labels at all.
- No test touches the user's live core: tests use `tests/support/fake_core.rs` and temp folders.
- Test data uses generic names: user `sam`, paths like `/home/sam/proj`, hosts like `studio.local`.
- Shared machine: run cargo with `nice -n 15` and `-j 2` (`nice -n 15 cargo test -j 2`, `nice -n 15 cargo clippy -j 2 --all-targets -- -D warnings`). Do not run `cargo fmt` over the crate.
- Writing style for comments and docs: ASD-STE100 (AGENTS.md "Writing style"). Each new module starts with a short doc comment that says what it is for.
- Clippy clean with `-D warnings`.

## Review Focus

1. A terminal with no folder at all (no `foreground.cwd`, no `cwd`): it must still get a group ("Terminals") and never be dropped — test in Task 2.
2. A folder that is not in a git repo, or a `git` that is missing or slow: the group falls back to the folder name, and the snapshot is not slower than the git timeout — tests in Tasks 2 and 3.
3. A `herdr.space` label whose space is not (yet) in the layout document, as right after a phone starts an agent: the terminal goes to that space, named from its `where` label — test in Task 2.
4. A helper whose parent is gone, finished, or on another machine: the helper becomes its own task in its own group — test in Task 1.
5. An old app sends an id from 0.1.x (`hc:loose`, `hc:loose:tab`): herdlingd answers `pane_not_found`, never a crash — test in Task 2.

---

### Task 1: Pure group helpers

**Files:**
- Create: `companion/src/core/groups.rs`
- Modify: `companion/src/core/mod.rs` (add `pub mod groups;`)
- Modify: `companion/src/core/project.rs` (make `cwd_now` and `text` `pub(crate)` for reuse)
- Test: `companion/tests/core_groups.rs`

**Interfaces:**
- Produces (all in `herdlingd::core::groups`):
  - `pub const GROUP_LABEL: &str = "herdling.group";`
  - `pub const NO_FOLDER_LABEL: &str = "Terminals";`
  - `#[derive(Debug, Clone, PartialEq)] pub struct RepoInfo { pub root: String, pub name: String, pub branch: Option<String> }`
  - `#[derive(Debug, Clone, Copy, PartialEq)] pub enum GroupSource { Space, Label, Repo, Folder }` with `pub fn word(self) -> &'static str` giving `"space" | "label" | "repo" | "folder"`.
  - `#[derive(Debug, Clone, PartialEq)] pub struct Group { pub key: String, pub label: String, pub source: GroupSource }`
  - `pub type Repos = std::collections::HashMap<String, Option<RepoInfo>>;` (key: a folder path as `folder_of` gives it)
  - `pub fn folder_of(t: &Value) -> Option<&str>` — the foreground folder, else the start folder (`cwd_now`).
  - `pub fn label_space(t: &Value) -> Option<LabelSpace>` with `pub struct LabelSpace { pub space: String, pub tab: Option<String>, pub name: Option<String> }`. `space` from `labels["herdr.space"]`, `tab` from `labels["herdr.tab"]`, `name` from `labels["where"]` before the last `" / "` (`"herdling / 1"` → `"herdling"`). Empty values count as missing.
  - `pub fn fallback_group(t: &Value, repos: &Repos) -> Group` — in order: `labels["herdling.group"]` (source `Label`), the repo of `folder_of(t)` in `repos` (source `Repo`, label `RepoInfo.name`), the last part of `folder_of(t)` (source `Folder`), else `NO_FOLDER_LABEL` (source `Folder`). `key` = `group_key(label)`.
  - `pub fn group_key(label: &str) -> String` — trimmed, lower case, each run of characters other than `a-z0-9-_.` becomes `-`; empty gives `"terminals"`.
  - `pub fn task_name(t: &Value) -> Option<String>` — the terminal `name`, else `status.title`, else the terminal `title`. Trimmed; empty counts as missing.
  - `pub fn live_parent<'a>(t: &Value, live: &[&'a Value]) -> Option<&'a Value>` — the record in `live` whose `address` equals `t.parent`, only when that record is an agent (`project::agent_status` is `Some`) and is not `t` itself. A parent address with `/` (another machine) gives `None`.

- [ ] **Step 1: Write the failing tests** in `companion/tests/core_groups.rs` (a local `rec(json)` helper builds records like `tests/support/fake_core.rs::terminal`):
  - `label_wins_over_repo`: labels `{"herdling.group": "Clips"}`, folder `/home/sam/proj/api` in a repo named `proj` → `Group { key: "clips", label: "Clips", source: Label }`.
  - `repo_then_folder`: no label, repo `proj` → source `Repo`, label `"proj"`; folder `/home/sam/scratch` with `None` in `repos` → source `Folder`, label `"scratch"`.
  - `no_folder_gives_terminals`: no `cwd`, no `foreground` → label `"Terminals"`, key `"terminals"`.
  - `foreground_folder_wins`: `cwd` `/home/sam/a`, `foreground.cwd` `/home/sam/b` → `folder_of` is `/home/sam/b`.
  - `space_label_and_where_name`: labels `{"herdr.space": "sp1", "herdr.tab": "tb1", "where": "web app / 2"}` → `LabelSpace { space: "sp1", tab: Some("tb1"), name: Some("web app") }`; empty `herdr.space` → `None`.
  - `task_name_order`: name `"Fix login"` wins; with name null → status title; with neither → terminal title; all empty → `None`.
  - `group_key_normalizes`: `"  Web App! "` → `"web-app-"`... assert exactly what the rule gives: `"web-app-"`; `""` → `"terminals"`.
  - `helper_parent_rules`: parent `t1` live agent → `Some`; parent `t1` live but not an agent → `None`; parent `box/t1` → `None`; parent missing from `live` → `None`; parent equal to own address → `None`.

- [ ] **Step 2: Run the tests to see them fail**

  Run: `cd companion && nice -n 15 cargo test -j 2 --test core_groups`
  Expected: compile error, `groups` not found.

- [ ] **Step 3: Implement `companion/src/core/groups.rs`** with the interfaces above. Pure: no I/O, no clock.

- [ ] **Step 4: Run the tests to see them pass**

  Run: `cd companion && nice -n 15 cargo test -j 2 --test core_groups`
  Expected: all pass.

- [ ] **Step 5: Commit**

  ```bash
  git add companion/src/core/groups.rs companion/src/core/mod.rs companion/src/core/project.rs companion/tests/core_groups.rs
  git commit   # "companion: add pure group rules for Herdr 2 terminals"
  ```

### Task 2: Projection with spaces, groups, tasks and repos

**Files:**
- Modify: `companion/src/core/project.rs` (`project`, `pane_entry`, `agent_entry`, module doc, remove the `LOOSE_*` constants)
- Modify: `companion/src/core/live.rs:46` (pass an empty `Repos` for now; Task 3 fills it)
- Test: `companion/tests/core_pure.rs` (update the tests that expect `hc:loose`, add new ones)

**Interfaces:**
- Consumes: Task 1 (`groups::*`).
- Produces:
  - `pub fn project(terminals: &[Value], doc: Option<&Value>, repos: &Repos) -> Projection`
  - `pub fn folders(terminals: &[Value]) -> Vec<String>` — the distinct `folder_of` values of the live terminals of this machine, sorted.
  - Id formats: space workspace `hc:space:<id>` and tab `hc:tab:<id>` (as now); fallback group workspace `hc:g:<key>`; task tab `hc:task:<address>`.
  - New optional fields on every core agent and pane entry: `group` (label), `group_source` (`GroupSource::word`), `repo`, `repo_root`, `branch` (from `repos[folder_of]`, absent when unknown).
  - Agent entry: `name` = `task_name(t)`; `display_agent` = absent (null) when `agent_kind(t)` is one of the known kinds (`claude`, `codex`, `opencode`, `gemini`, `omp`), else the reported app. Pane entry: `label` = `task_name(t)`.

Placement rules, in this order (each terminal is placed once):
1. Terminals in the layout document: as now (space → tab → panes).
2. A terminal with `label_space` whose space is not in the document: workspace `hc:space:<space>`, label = `LabelSpace.name`, else the folder name; tab `hc:tab:<tab>` when `tab` is set, else `hc:task:<address>`. Several such terminals with the same space share one workspace entry.
3. A helper (`live_parent` is `Some`) whose parent was placed in rule 3 or 4: a pane in the parent's tab. A helper of a terminal placed by rules 1–2 follows rule 4 (the Herdr app decides where its own helpers show).
4. Every other terminal: workspace `hc:g:<key>` of `fallback_group`, one tab `hc:task:<address>` per terminal, tab label = `task_name` else the agent kind else the address.

Workspace `number`s follow the order of first use; `tab_count` and `agent_status` sums as now.

- [ ] **Step 1: Write the failing tests** in `core_pure.rs`:
  - `loose_terminal_groups_by_repo`: one agent in no space, folder `/home/sam/proj/api`, `repos` maps it to `RepoInfo { root: "/home/sam/proj", name: "proj", branch: Some("main") }` → one workspace `hc:g:proj` labelled `"proj"`, one tab `hc:task:t8` labelled `"fix tests"`, the agent has `group: "proj"`, `group_source: "repo"`, `repo: "proj"`, `branch: "main"`, `name: "fix tests"`, `display_agent: null`, `agent: "claude"`. No entry has `hc:loose`.
  - `label_space_not_in_doc`: labels `herdr.space=sp9`, `herdr.tab=tb9`, `where=web / 1`, doc without `sp9` → workspace `hc:space:sp9` labelled `"web"`, tab `hc:tab:tb9`.
  - `helper_goes_into_parent_tab`: agent `t1` in no space, helper `t2` with `parent: "t1"` → both panes have `tab_id: "hc:task:t1"`, both agents listed, one tab.
  - `helper_of_space_terminal_is_own_task`: parent placed by the document → helper gets its own `hc:task:` tab in its fallback group.
  - `no_folder_terminal_is_kept`: a terminal with no folder → workspace `hc:g:terminals`.
  - `unknown_app_keeps_display_agent`: status app `"Aider"` → `agent: "aider"`, `display_agent: "Aider"`.
  - Keep the existing `projection_places_terminals_by_the_layout_document` test passing; update the existing loose-workspace assertions to the new ids.
  - `old_loose_ids_are_not_found` in `tests/core_rpc.rs`: `herdr.call` `pane.read` with `pane_id: "hc:loose"` → error code `unsupported` or `pane_not_found` (assert it is an error, not a panic or hang).

- [ ] **Step 2: Run to see them fail**

  Run: `cd companion && nice -n 15 cargo test -j 2 --test core_pure --test core_rpc`
  Expected: the new tests fail (old ids, missing fields).

- [ ] **Step 3: Implement** the new `project` signature, `folders`, the placement rules and the fields in `project.rs`. Update `live.rs` to call `project::project(&terminals, doc, &groups::Repos::new())`. Update the module doc comment.

- [ ] **Step 4: Run all companion tests**

  Run: `cd companion && nice -n 15 cargo test -j 2`
  Expected: all pass. Fix `core_serve.rs` and `core_rpc.rs` only where they assert the old loose ids.

- [ ] **Step 5: Commit** — "companion: group Herdr 2 terminals by space, label, repo or folder"

### Task 3: Repo lookup for the projection

**Files:**
- Create: `companion/src/core/repos.rs`
- Modify: `companion/src/core/mod.rs`, `companion/src/git.rs` (add `branch`), `companion/src/core/live.rs` (`projection`)
- Test: `companion/tests/core_rpc.rs`

**Interfaces:**
- Consumes: `git::toplevel(cwd: &Path) -> Result<Option<PathBuf>, RpcError>` (exists), `project::folders`, `groups::{Repos, RepoInfo}`.
- Produces:
  - `pub async fn branch(root: &Path) -> Option<String>` in `git.rs`: `git rev-parse --abbrev-ref HEAD`; `None` on error or for `"HEAD"` (a detached head).
  - `pub async fn lookup(folders: &[String]) -> Repos` in `core/repos.rs`: one entry per folder; folders run in parallel; each folder at most 2 s in all (on a timeout the entry is `None` and is not cached). Results are cached in a process-wide map for 30 s (`const TTL: Duration = Duration::from_secs(30)`), so a burst of snapshots runs `git` once per folder. A folder that does not exist gives `None`.
  - `live::projection` calls `repos::lookup(&project::folders(&terminals))` and passes the map to `project`.

- [ ] **Step 1: Write the failing test** `snapshot_has_repo_of_agent_folder` in `core_rpc.rs`: make a temp folder, run `git init -b main` and one empty commit in it (`git -c user.name=sam -c user.email=sam@example.com commit --allow-empty -m x`), give the fake core one agent whose `foreground.cwd` is a subfolder of it → `session.snapshot` agent has `repo` = the temp folder's name, `repo_root` = its path, `branch: "main"`, `group_source: "repo"`. Skip the test with a message when `git` is not on `PATH`.
- [ ] **Step 2: Run it to see it fail** — `nice -n 15 cargo test -j 2 --test core_rpc snapshot_has_repo` → FAIL (no `repo`).
- [ ] **Step 3: Implement** `git::branch`, `core/repos.rs` and the `live::projection` change.
- [ ] **Step 4: Run all companion tests** — `nice -n 15 cargo test -j 2` → all pass.
- [ ] **Step 5: Commit** — "companion: add the repo and branch of Herdr 2 terminals"

### Task 4: Transcripts for core agents

**Files:**
- Modify: `companion/src/claude/resolve.rs` (extract the pid → session step)
- Modify: `companion/src/transcript/mod.rs` (one resolve path from process info)
- Modify: `companion/src/rpc.rs:783-793` (`thread_resolve` core branch)
- Test: `companion/tests/transcript_rpc.rs` (or `core_rpc.rs`, whichever already builds a temp `HOME` with Claude sessions)

**Interfaces:**
- Consumes: `project::process_info(t)` (exists: herdr 1 `pane.process_info` shape from a core record), `project::agent_kind`, `groups::folder_of`, `live::record`.
- Produces:
  - `pub fn claude::resolve::session_from_info(home: &Path, cwd: &str, info: &Value, table: ProcessTable) -> Option<(String, PathBuf)>` — the body of `resolve_with` after the herdr calls (`pane_pids` + `locate`). `resolve_with` calls it.
  - `pub fn transcript::resolve_from_info(home: &Path, kind: &str, cwd: Option<String>, info: &Value, procs: ProcList, table: ProcessTable) -> ThreadRef` — Claude through `session_from_info`, the other agents through `procs::agent_start` + `locate`, as `resolve_with` does now. Blocking: callers use `spawn_blocking`. `resolve_with` uses it after its herdr 1 calls.
  - `pub async fn transcript::resolve_core(home: &Path, record: &Value) -> ThreadRef` — `kind` = `agent_kind(record)` (default `"unknown"`), `cwd` = `folder_of(record)`, `info` = `process_info(record)["process_info"]`, with `host_procs` and `process_table`.
  - `thread.resolve` on an `hc:` pane: `live::record` then `resolve_core`. A record that is not found gives the error as now.

- [ ] **Step 1: Write the failing test** `core_thread_resolves_claude_session`: temp `HOME` with `.claude/sessions/101.json` = `{"sessionId": "abc", "cwd": "/home/sam/proj/src"}` and the log `.claude/projects/<project_dir of /home/sam/proj/src>/abc.jsonl` (use `claude::resolve::project_dir` to build the path); the fake core terminal (fake_core `terminal()`: foreground pid 101, folder `/home/sam/proj/src`) → `thread.resolve` `{pane_id: "hc:t1"}` gives `session: "abc"` and `log_path` ending in `abc.jsonl`.
- [ ] **Step 2: Run it to see it fail** — `session` is null.
- [ ] **Step 3: Implement** the three functions and the `thread_resolve` change. Keep the herdr 1 behavior the same: the existing `claude_resolve.rs` and `transcript_*` tests must pass unchanged.
- [ ] **Step 4: Run all companion tests** — `nice -n 15 cargo test -j 2` → all pass.
- [ ] **Step 5: Commit** — "companion: resolve transcripts of Herdr 2 agents"

### Task 5: Previews of core agents from their transcripts

**Files:**
- Modify: `companion/src/core/live.rs` (`previews`), `companion/src/rpc.rs` (`agents_preview` passes `&ctx.home` and `&ctx.preview`)
- Modify: `companion/src/preview.rs` (make `PreviewState::cached_log` and `cache_log` `pub(crate)`; extract the log → `AgentPreview` fill of `one_pane` as `pub(crate) fn fill_from_log(p: &mut AgentPreview, status: AgentStatus, log: &LogPreview)` if it is not already a function)
- Test: `companion/tests/core_rpc.rs`

**Interfaces:**
- Consumes: Task 4 `transcript::resolve_core`, `preview::read_any_log`.
- Produces: `pub async fn previews(sock: &CoreSocket, timeout: Duration, home: &Path, state: &PreviewState, wanted: Option<&[String]>) -> Result<Vec<AgentPreview>, CoreError>`. For an agent whose kind `transcript::Agent::from_kind` knows: the log path from `state.cached_log`, else `resolve_core` and `state.cache_log`; then `read_any_log` in `spawn_blocking`; fill as herdr 1 does, with the same `source` value that herdr 1 uses for a log preview. With no log, or a log with no text for the status: the screen line as now (`source: "screen"`). The 7501 `msg` stays the first choice for a working agent's activity only when the log gives no activity.

- [ ] **Step 1: Write the failing test** `core_preview_reads_the_transcript`: the Task 4 fixture plus one assistant line in `abc.jsonl` (`{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"All tests pass now."}]}}`, copy the exact shape from a fixture in `tests/fixtures/`), terminal status `idle` → `agents.preview` gives `last_reply: "All tests pass now."` for `hc:t1`, and the source is not `"screen"`.
- [ ] **Step 2: Run it to see it fail** — the reply is the screen line.
- [ ] **Step 3: Implement** the `previews` change and the `rpc.rs` call site.
- [ ] **Step 4: Run all companion tests and clippy**

  Run: `cd companion && nice -n 15 cargo test -j 2 && nice -n 15 cargo clippy -j 2 --all-targets -- -D warnings`
  Expected: all pass, no warnings.
- [ ] **Step 5: Commit** — "companion: preview Herdr 2 agents from their transcripts"

### Task 6: Docs and a live check

**Files:**
- Modify: `docs/protocol.md` (section "Herdr 2 (herdr-core)": placement rules, the `hc:g:` and `hc:task:` ids, the new optional fields, `display_agent`, `thread.resolve` and previews for core panes; remove the `hc:loose` text)
- Modify: `CHANGELOG.md` (Unreleased: the same, in two to four lines)
- Modify: `AGENTS.md` (architecture map, `core/` row: add `groups.rs` and `repos.rs`)

- [ ] **Step 1: Update the three files.** ASD-STE100; no real host names or paths.
- [ ] **Step 2: Privacy check of the branch**

  Read `git diff main` for the items in AGENTS.md section 8: personal names, host names, IP
  addresses, home folder paths, SSH aliases and names of other private projects.
  Expected: none.
- [ ] **Step 3: Live check, read only.** Build with `nice -n 15 cargo build -j 2`, then run the new binary's `rpc` against the real core with a `session.snapshot` request, as in `docs/protocol.md` (`printf '...' | ./target/debug/herdlingd rpc`). It only reads. Expected: no `hc:loose`; each agent has a group, a task name and a repo; `thread.resolve` on a Claude agent gives a `log_path`. Do not install the binary: the maintainer decides when to deploy.
- [ ] **Step 4: Commit** — "docs: Herdr 2 groups, tasks and transcripts"
