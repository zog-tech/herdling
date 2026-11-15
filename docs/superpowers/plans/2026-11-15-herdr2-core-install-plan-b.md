# Install, check and update of herdr-core (plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** herdlingd installs a pinned, checksum-checked herdr-core (Herdr 2), reports its status, updates it to the pin (never down) and makes sure that it runs. The installer, `herdlingd update` and `update.apply` can install the core first. The herdr 1 guard for the 0.2.0 update is ready.

**Architecture:** A new module `companion/src/core_install/` holds the pin (`pin.rs`, read from `companion/core-pin.json`), a pure install state machine (`machine.rs`, `step(state, input) -> Step`), the pure herdr 1 guard (`guard.rs`) and a thin I/O driver (`mod.rs`) behind the `CoreIo` trait. The real I/O uses the `HerdrRunner` trait of `herdr_update.rs` for processes, a download function and a socket probe as parameters. New RPC methods `core.status` and `core.install`. `herdr.update` goes to the core on a host that has the core and no herdr 1. `update.check` and `update.apply` get optional `core` fields, and the release manifest gets optional `requires_core` and `core` fields.

**Tech Stack:** Rust (tokio, reqwest, sha2, serde), POSIX `sh` for `site/public/install.sh`, TypeScript types in `protocol/`.

**Spec:** `docs/superpowers/specs/2026-11-13-herdr2-main-backend-design.md` ("Install and update of herdr-core", "Removing herdr 1" → "Users still on herdr 1", slice 4) and `docs/superpowers/specs/2026-10-31-herdlingd-install-update-design.md`. Other plans: A (groups, done), C (the "Removing herdr 1" table), D (terminal view), E (delete herdr 1, 0.2.0), F (app).

## Facts about upstream herdr-core (checked on 2026-11-15)

- No GitHub release assets. Releases are on `https://releases.herdr.dev/core/`:
  `latest.json`, `<version>/manifest.json` with `version`, `generation`, `notes` and
  `targets.<os>-<arch>.{url, sha256}`. Targets: `linux-aarch64`, `linux-x86_64`, `macos-aarch64`,
  `macos-x86_64`, `windows-x86_64`. Asset: `<version>/herdr-core-<target>.tar.gz`. No signatures.
- The tarball holds `herdr-core`, `LICENSE`, `THIRD-PARTY-NOTICES` and, for macOS,
  `Herdr Core.app` (signed, identifier `dev.herdr.core`). Linux builds are static.
- The upstream `install.sh` installs into `~/.local/bin/herdr-core` and adds a `hc` link when no
  `hc` exists. On macOS (not root, a folder in the home folder) it runs
  `<app>/Contents/MacOS/herdr-core --hc-install-bundle <that file> ~/.local/bin/herdr-core`, then
  `herdr-core server restart` on an update. On Linux it swaps an installed core with
  `herdr-core update --from <file>` (terminals keep running), else it copies the file.
- The core starts itself as a service: a systemd user service on Linux, a one-shot launchd job on
  macOS. herdlingd does not write a unit. `herdr-core server start` starts it. Upstream's own remote
  install over SSH (`hc machine add --install`) runs `server restart` from the SSH session.

## Decisions

- **The pin lives in `companion/core-pin.json`:** `version`, `required` and one `sha256` per target.
  herdlingd embeds it (`include_str!`), so the release key signs it with the binary. The download
  URL is made from the version and the target (`https://releases.herdr.dev/core/<v>/herdr-core-<t>.tar.gz`),
  never read from a file. The release workflow copies the pin into `latest.json` as `core`, and
  `required` as `requires_core`. Pin: herdr-core **0.1.20** (the version that the spec records as checked).
- **`required` is the switch for plan E.** It is `false` now. When it is `true`: the installer installs
  the core and does not need herdr 1, and `update.apply` to a release with `requires_core: true`
  installs the core first. Explicit `core.install` and `herdlingd core install` work at all times.
- **Never downgrade, never touch a package manager's core.** Only `~/.local/bin/herdr-core` belongs
  to herdlingd. A core elsewhere (Homebrew, Nix, conda) is kept as it is.
- **The checksum is checked twice:** the downloaded tarball against the pin, then the unpacked
  `herdr-core --version` against the pinned version.
- **herdr.update:** a host with herdr 1 updates herdr 1 (no change). A host with the core and no
  herdr 1 updates the core to the pin. Plan E removes the herdr 1 branch.

## Global Constraints

- Worktree `.claude/worktrees/herdr2-install`, branch `herdr2-install`. Do not push, release or
  install. Commits `companion:` / `site:` / `docs:`, one short line, no period, a blank line, the
  reason, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git config user.name` is `zog-tech`.
- Add methods and fields only. New fields are optional. Release asset names and the fields of
  `latest.json` stay. The `--quiet` contract of `install.sh` gets only a new step name (`core`) and a
  new error code (`core_install_failed`); old apps show an unknown code as `install_failed` with its text.
- Tests never download, never touch the live core and never write outside temp folders.
- `nice -n 15 cargo test -j 2`, `nice -n 15 cargo clippy -j 2 --all-targets -- -D warnings`,
  `CARGO_TARGET_DIR=/Volumes/MiniSSD/builds/herdling-target`. No `cargo fmt` over the crate.
- Plan C works in `core/route.rs` and near it; plan D in the terminal view. This plan adds its own
  module and keeps edits in shared files (`rpc.rs`, `protocol/src/index.ts`, `docs/protocol.md`,
  `CHANGELOG.md`) small.
- ASD-STE100 for comments and docs. Test data: `sam`, `/home/sam`, `studio.local`.

## Review Focus

1. A checksum mismatch stops before any file outside the stage folder changes — Task 2 and Task 3.
2. A core newer than the pin, or of unknown version, is never replaced — Task 2 and Task 3.
3. A core from a package manager is never replaced — Task 2.
4. A failed core install in `update.apply` leaves the old herdlingd — Task 5.
5. An old app sees no change: new methods only, new optional fields — Tasks 4 and 5.

---

### Task 1: The pin

**Files:** Create `companion/core-pin.json`, `companion/src/core_install/mod.rs`, `companion/src/core_install/pin.rs`; modify `companion/src/lib.rs`. Test: `companion/tests/core_install.rs`.

**Interfaces** (`herdlingd::core_install::pin`):
- `pub const RELEASES: &str = "https://releases.herdr.dev/core";`
- `#[derive(Deserialize, Serialize)] pub struct CorePin { pub version: String, #[serde(default)] pub required: bool, pub sha256: BTreeMap<String, String> }`
- `pub fn embedded() -> CorePin` (parses `core-pin.json`; a test proves that it parses).
- `pub fn target(os: &str, arch: &str) -> Option<&'static str>` (`macos`/`linux` × `aarch64`/`x86_64` → `macos-aarch64` …).
- `impl CorePin { pub fn valid(&self) -> bool; pub fn sha_for(&self, target) -> Option<String>; pub fn url(&self, target) -> String }`. `valid`: a version that `update::parse_version` takes, every sha 64 hex digits.

- [ ] Tests: the embedded pin is valid and has the four Unix targets; `target` maps; `url` is `RELEASES/<v>/herdr-core-<t>.tar.gz`; a bad version or bad sha is not valid.
- [ ] Implement, run `cargo test --test core_install`, commit `companion: pin herdr-core 0.1.20 with its checksums`.

### Task 2: The pure install state machine

**Files:** Create `companion/src/core_install/machine.rs`. Test: `companion/tests/core_install.rs`.

**Interfaces** (`herdlingd::core_install::machine`):
- `pub enum Where { Missing, Ours, Managed }` and `pub struct Found { pub at: Where, pub version: Option<String> }`.
- `pub enum Decision { Install, Update, UpToDate, KeepNewer, KeepUnknown, KeepManaged }` and `pub fn decide(found: &Found, pin: &str) -> Decision`.
- `pub enum PlaceMode { Bundle { update: bool }, SwapFrom, Copy }` and `pub fn place_mode(mac: bool, bundle: bool, update: bool) -> PlaceMode`.
- `pub struct Plan { pub pin: String, pub sha256: String, pub mac: bool }`.
- `pub enum State`, `pub enum Input`, `pub enum Effect { FindInstalled, Download, Unpack, CheckUnpacked, Place(PlaceMode), ProbeRunning { wait: bool }, Start }`, `pub enum Step { Next(State, Effect), Done(Outcome), Fail(Failure) }`, `pub fn step(plan: &Plan, state: State, input: Input) -> Step`.
- `pub struct Outcome { pub from: Option<String>, pub to: Option<String>, pub status: Status, pub started: bool }`, `pub enum Status { Installed, Updated, UpToDate, KeptNewer, KeptUnknown, KeptManaged }`.
- `pub struct Failure { pub code: &'static str, pub message: String }`. Codes: `download_failed`, `checksum_mismatch`, `install_failed`, `core_not_running`, `internal` (an impossible event).

- [ ] Tests: each decision; a newer core goes straight to `ProbeRunning` with no `Download` (never downgrade); a checksum mismatch fails with `checksum_mismatch`; an unpacked core of another version fails; a missing core goes Download → Unpack → Check → Place(Copy) → Probe → Start → Probe → Done; a core that does not start fails `core_not_running`; an impossible event fails `internal`.
- [ ] Implement, test, commit `companion: pure state machine for the herdr-core install`.

### Task 3: The I/O driver, status and the lock

**Files:** `companion/src/core_install/mod.rs`. Test: `companion/tests/core_install.rs`.

**Interfaces** (`herdlingd::core_install`):
- `pub trait CoreIo { fn find_installed(&mut self) -> Found; fn download(&mut self, url: &str) -> Result<String, String>; fn unpack(&mut self) -> Result<bool, String>; fn check_unpacked(&mut self) -> Result<Option<String>, String>; fn place(&mut self, mode: PlaceMode) -> Result<(), String>; fn running(&mut self, wait: bool) -> Option<String>; fn start(&mut self) -> Result<(), String>; }`
- `pub fn drive(plan: &Plan, io: &mut dyn CoreIo) -> Result<Outcome, RpcError>`.
- `pub struct CoreInstallCtx { home, dirs, env, runner: Arc<dyn HerdrRunner>, fetch: Fetch, probe: Probe, mac: bool, target: Option<String>, pin: CorePin, lock_dir }` with `new(home, core_socket)` for production.
- `pub struct SystemCoreIo` (implements `CoreIo` with the context; stage folder `~/.cache/herdling/core.<pid>`, removed on drop).
- `pub fn status(ctx) -> CoreStatus`, `pub fn install(ctx, pin: &CorePin) -> Result<CoreInstall, RpcError>` (takes `core-install.lock`, error `busy`).
- Types in `types.rs`: `CoreStatus`, `CoreInstall`.

- [ ] Tests with a temp home, a fake `HerdrRunner` and a fake fetch: a fresh Linux install puts `~/.local/bin/herdr-core` and the `hc` link and starts the core; a mismatch leaves `~/.local/bin` empty and removes the stage folder; a newer core is not fetched; a managed core is not replaced; status fields; a second install while the lock is held gives `busy`.
- [ ] Implement, test, commit `companion: install, update and status of herdr-core`.

### Task 4: RPC methods and the CLI

**Files:** `companion/src/rpc.rs` (METHODS, dispatch, `Ctx.core_install`), `companion/src/main.rs` (`herdlingd core status|install|required`), `protocol/src/index.ts`. Test: `companion/tests/core_install_rpc.rs`.

- [ ] `core.status` → `CoreStatus`. `core.install` → `CoreInstall`. Both give `unsupported` when `Ctx.core_install` is `None`.
- [ ] `herdr.update`: pure `herdr_update_target(herdr1: bool, core: bool)`; on `Core` it runs `core.install` and shapes a `HerdrUpdate` (`handoff: "complete"` when the core was swapped, else `"none"`).
- [ ] `herdlingd core required` exits 0 when the pin says `required`, else 1 (the installer reads it).
- [ ] Tests through `rpc::run` with fakes. Commit `companion: core.status and core.install methods`.

### Task 5: The herdr 1 guard and update.check / update.apply

**Files:** Create `companion/src/core_install/guard.rs`; modify `companion/src/update.rs`, `companion/src/types.rs`, `companion/tests/update.rs`, `.github/workflows/release-herdlingd.yml`.

- [ ] `pub enum Guard { Proceed, InstallCoreFirst { herdr1: bool } }`, `pub fn guard(requires_core, core_installed, herdr1) -> Guard`, `pub const HERDR1_NOTICE`.
- [ ] `Manifest` gets `#[serde(default)] requires_core: bool` and `core: Option<CorePin>`. `UpdateCtx` gets `core: Option<CoreInstallCtx>`.
- [ ] `update.check` adds `core: { requires_core, installed, herdr1, install_first, pinned, notice? }`.
- [ ] `update.apply`: when the manifest says `requires_core`, install the core (the manifest pin, else the own pin) before the download of herdlingd. A failure gives `core_install_failed` and changes nothing else. The result adds `core` and `notice`.
- [ ] Tests: guard table; apply with `requires_core` and a failing core install keeps the old binary; a manifest without the new fields works as before.
- [ ] The workflow adds `requires_core` and `core` from `companion/core-pin.json`. Commit `companion: install herdr-core first when a release needs it`.

### Task 6: The installer script

**Files:** `site/public/install.sh`, `app/src/hosts/installer.ts` (comment and the new code in `SCRIPT_CODES` with a message), its test.

- [ ] Unpack before the herdr check. When `herdlingd core required` exits 0: no herdr 1 check, step `core`, `herdlingd core install`, failure → `HERDLINGD_ERROR core_install_failed`. Else the old herdr 1 check (`--with-herdr`).
- [ ] `sh -n`; a local run with `HERDLING_RELEASE_BASE` on a loopback server with fake releases in a temp `HOME` (one release that requires the core with a fake herdlingd, one that does not).
- [ ] Commit `site: install herdr-core in the installer when herdlingd needs it`.

### Task 7: Docs, privacy check and a live read-only check

- [ ] `docs/protocol.md` (`core.status`, `core.install`, new fields), `CHANGELOG.md`, `AGENTS.md` (map and section 6), site docs when the user text changes.
- [ ] `git diff main` privacy search. Debug build; `herdlingd rpc` with `core.status` on this computer (read only).
- [ ] Commit `docs: herdr-core install, status and update`.

## Follow-ups for plans E and F

- E: set `"required": true` in `companion/core-pin.json` for 0.2.0. Ship the guard in a 0.1.x
  release from `main` first, so the 0.1.x herdlingd on users' computers runs it when it updates to 0.2.0.
- E: remove the herdr 1 branch of `herdr.update`.
- F: host screen: `core.status` (installed, running, pinned, newer than the pin), an "Install
  Herdr 2" button (`core.install`), and the `update.check.core.notice` before an update.
