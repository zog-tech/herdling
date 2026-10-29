# Zogssh Phases 2–4 (Pairing + Push, Voice, Extras) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pair the phone with a host by code or QR, find hosts by Bonjour, get a push when an agent finishes or needs you, talk to agents by voice and hear their replies, and add the terminal view, permission buttons, session actions, subagent threads, stats, usage, automations and swipe navigation.

**Architecture:** `zogsshd` gains three subcommands. `serve` is a long-lived user service: a herdr event watcher that sends Expo pushes, an HTTP pairing endpoint on TCP 7790 and a Bonjour advert. `pair` opens a 5-minute pairing window. `install` writes the launchd or systemd unit. Both `rpc` and `serve` share one config file. The app gets a Bonjour browser in the `ssh` native module, a new local `voice` native module (ASR, audio session, on-device summary) and new screens. All session traffic stays on SSH; only pairing (LAN HTTP) and pushes (Expo) leave it.

**Tech Stack:** Rust (tokio, serde, toml, fs4, axum 0.8, reqwest with rustls, mdns-sd, qrcode, if-addrs, rand, sha2, base64, sysinfo), Expo SDK 58 + Expo Router + TypeScript + Zustand + Jest, expo-notifications, expo-camera, expo-device, expo-haptics, expo-speech, Swift (Network.framework `NWBrowser`, Speech, AVFAudio, FoundationModels), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-10-29-zogssh-design.md`. Phase 1 plan: `docs/superpowers/plans/2026-10-29-zogssh-phase1.md`.

## Global Constraints

Copied from Phase 1:
- pnpm for JS (pnpm workspace at repo root: `app`, `protocol`). cargo for Rust (`companion/`).
- Binary name `zogsshd`; app name "Zogssh"; URL scheme `zogssh`; bundle id `com.zogtech.zogssh`.
- herdr socket: `$HERDR_SOCKET` if set, else `~/.config/herdr/herdr.sock`. Newline-delimited JSON, protocol 22. **One herdr connection per request/response call** (herdr 0.9.0 closes the socket after one reply). Subscriptions keep their own connection.
- RPC wire: one JSON object per line. Request `{"id":number,"method":string,"params":object}`; response `{"id","result"}` or `{"id","error":{"code":string,"message":string}}`; notification `{"method":"event","params":{"stream":string,"data":any}}`.
- Tool result text capped at 4096 bytes, `truncated: true` when cut.
- Visual tokens from the spec "Visual design" section and `design-system/zogssh/MASTER.md`; semantic tokens only, no raw hex in components. Lucide icons; no emoji as icons. Touch targets ≥ 44 pt. Status shown with color + icon + label.
- No personal names, host names, LAN IPs or home paths in committed code, tests or fixtures. Use "Sam", `/home/sam/proj`, `10.0.0.5`, `ExponentPushToken[test]`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

New for Phases 2–4:
- Companion config: `~/.config/zogsshd/config.toml`, mode `0600`, written only through `config::update` (exclusive `flock` on `config.toml.lock` + write to temp file + `rename`). `serve` re-reads it before each push, so `push.register` from `rpc` takes effect without a restart.
- Pairing window file: `~/.config/zogsshd/pair.json`, mode `0600`, `{code, expires_at}` (unix seconds). Pairing port 7790 (config `pair_port`). Window 300 s. Code: 6 digits, single use, window closes after 5 wrong codes.
- authorized_keys line (exact): `command="<abs path>/zogsshd rpc",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 <base64> zogssh:<device>`.
- Every outbound URL (Expo push, Anthropic, Claude usage, Codex usage) is a field of the companion context with the real default, so tests use a local mock server. **No test touches the real network.**
- The companion never logs push tokens, SSH keys, OAuth tokens or `anthropic_key`.
- Push: `POST https://exp.host/--/api/v2/push/send`, body is an array of `{to, title, body, sound:"default", data:{hostId, paneId}}`. Debounce 5 s per pane.
- Summary model: `claude-haiku-5-5` via `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`.
- App native changes go in `app/modules/ssh` or the new `app/modules/voice`. Add JS deps with `npx expo install`. A task that changes native code or `app.json` plugins ends with a dev build (`cd app && npx expo run:ios`).
- New shared types go in `protocol/src/index.ts` and have a serde mirror in `companion/src/types.rs` (same field names, snake_case on the wire).

## Review Focus

1. **Pairing input cannot inject into authorized_keys** → a `public_key` or `device_name` with `\n`, `"`, `,` or a leading option is rejected or sanitized; the file gains exactly one line. (Task 15 test `pair_rejects_injection`.)
2. **Pairing code brute force and replay** → wrong code 5 times closes the window; an expired window rejects; a used code rejects a second POST. (Task 15 tests `five_wrong_codes_close_window`, `expired_window_rejected`, `code_is_single_use`.)
3. **Push debounce** → a status that flips back within 5 s sends nothing; `idle → idle` and `unknown → idle` send nothing; a herdr restart reconnects without a duplicate push. (Task 14 tests `flip_back_within_window_sends_nothing`, `only_from_working_counts_as_finished`, `reconnects_after_herdr_restart`.)
4. **Concurrent config writes** (`rpc push.register` while `serve` pairs) → no lost device entries, file stays `0600`. (Task 13 test `concurrent_updates_keep_both`.)
5. **Hold-to-talk never sends by mistake** → release after slide-away, an empty transcript, or an ASR error sends nothing. (Task 19 tests `release_after_slide_away_cancels`, `empty_transcript_sends_nothing`, `error_sends_nothing`.)

---

## Phase 2: Pairing, push, install

### Task 13: Companion config, `serve` skeleton, `push.register`

**Files:**
- Create: `companion/src/config.rs`, `companion/src/serve/mod.rs`
- Modify: `companion/Cargo.toml` (add `toml = "0.8"`, `fs4 = { version = "0.13", features = ["sync"] }`), `companion/src/lib.rs`, `companion/src/main.rs` (subcommand `serve`), `companion/src/rpc.rs` (`Ctx.config_path`, method `push.register`), `companion/src/types.rs`, `protocol/src/index.ts`
- Test: `companion/tests/config.rs`, `companion/tests/rpc_push_register.rs`

**Interfaces — Produces:**
```rust
// config.rs
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct Config {
    #[serde(default)] pub devices: Vec<Device>,
    pub anthropic_key: Option<String>,
    #[serde(default = "default_pair_port")] pub pair_port: u16,   // 7790
    #[serde(default = "default_ssh_port")] pub ssh_port: u16,     // 22
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Device { pub id: String, pub name: String, pub host_id: String,
    pub public_key: Option<String>, pub expo_token: Option<String>, #[serde(default)] pub prefs: Prefs }
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Prefs { pub finished: bool, pub needs_you: bool }      // Default: both true
pub fn default_path(home: &Path) -> PathBuf;                       // home/.config/zogsshd/config.toml
pub fn load(path: &Path) -> anyhow::Result<Config>;                // missing file → Config::default()
pub fn update<T>(path: &Path, f: impl FnOnce(&mut Config) -> T) -> anyhow::Result<T>; // flock + temp + rename, mode 0600, creates dir 0700
pub fn upsert_device(c: &mut Config, d: Device);                   // replace by id, else push
// serve/mod.rs
pub struct ServeCtx { pub home: PathBuf, pub herdr_socket: PathBuf, pub config_path: PathBuf,
    pub push_url: String, pub debounce: Duration, pub pair_port: Option<u16> /* None = from config */,
    pub host_key_paths: Vec<PathBuf>, pub exe: PathBuf }
pub async fn run(ctx: ServeCtx, shutdown: impl Future<Output = ()>) -> anyhow::Result<()>;
```
- `rpc::Ctx` gains `config_path: PathBuf` (`Ctx::new` sets `config::default_path(&home)`).
- RPC `push.register {device_id, host_id, name, expo_token: string|null, prefs: {finished, needs_you}}` → `{ok: true}`. Upserts the device by `device_id`, keeps an existing `public_key`.
- TS: `export type PushPrefs = { finished: boolean; needs_you: boolean }; export type PushRegister = { device_id: string; host_id: string; name: string; expo_token: string | null; prefs: PushPrefs };`
- `main.rs serve`: builds `ServeCtx` (push_url `https://exp.host/--/api/v2/push/send`, debounce 5 s, `host_key_paths = ["/etc/ssh/ssh_host_ed25519_key.pub"]`, `exe = current_exe().canonicalize()`), runs until SIGTERM or Ctrl-C. In this task `run` only loads the config, prints `zogsshd serve: started` to stderr, and waits for shutdown. Tasks 14–16 add its parts.

- [ ] **Step 1: Tests** (`companion/tests/config.rs`, temp dirs):
  - `missing_file_is_default` — `load` on a missing path → `Config { devices: vec![], anthropic_key: None, pair_port: 7790, ssh_port: 22 }`.
  - `update_round_trip_and_mode` — `update(p, |c| c.anthropic_key = Some("k".into()))`; `load(p).anthropic_key == Some("k")`; `metadata(p).permissions().mode() & 0o777 == 0o600`.
  - `upsert_replaces_by_id` — two upserts with id `d1` (names "a", "b") → one device, name "b".
  - `concurrent_updates_keep_both` — 20 threads, each `update` adds device `d<i>` → `load` has 20 devices.
  - `rpc_push_register.rs::register_then_update_prefs` — `push.register {device_id:"d1", host_id:"h_1", name:"Sam-iPhone", expo_token:"ExponentPushToken[test]", prefs:{finished:true, needs_you:false}}` → `{ok:true}`; config has one device with `prefs.needs_you == false`; a second call with `expo_token:null` keeps one device and sets `expo_token == None`.
  - `push_register_requires_device_id` → error code `bad_request`.
- [ ] **Step 2:** `cd companion && cargo test` → fails (missing `config`).
- [ ] **Step 3:** Implement. `update` opens `config.toml.lock` (create), `lock_exclusive`, `load`, applies `f`, writes `config.toml.tmp` with mode 0600 (`OpenOptions::mode`), `rename`.
- [ ] **Step 4:** `cargo test` → all pass (Phase 1 tests too). Manual: `cargo run -q -- serve` prints `started`; Ctrl-C exits 0.
- [ ] **Step 5:** Commit `feat(companion): config file, serve skeleton and push.register`.

### Task 14: Event watcher → Expo push

**Files:**
- Create: `companion/src/events.rs` (subscription stream, moved out of `rpc.rs`), `companion/src/serve/debounce.rs`, `companion/src/serve/watch.rs`, `companion/src/push.rs`
- Create: `companion/tests/support/fake_herdr_events.rs` (move `spawn_fake_opts`, `Push`, `status_ev` out of `rpc_subscribe.rs`), `companion/tests/support/mock_http.rs` (axum server on `127.0.0.1:0` that records request bodies and answers a scripted JSON)
- Modify: `companion/Cargo.toml` (`reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }`, `axum = "0.8"`), `companion/src/rpc.rs` (`herdr.subscribe` uses `events::subscribe`), `companion/src/serve/mod.rs`, `companion/tests/rpc_subscribe.rs` (use the moved fake)
- Test: `companion/tests/serve_debounce.rs`, `companion/tests/serve_watch.rs`

**Interfaces — Produces:**
```rust
// events.rs — the Phase 1 lifecycle + per-pane status logic, unchanged in behaviour
pub struct EventStream { /* lifecycle conn + StatusConns */ }
impl EventStream { pub async fn next(&mut self) -> Option<Value>; } // None = herdr closed
pub async fn subscribe(socket: &Path, timeout: Duration, events: Option<Vec<String>>) -> Result<EventStream, HerdrError>;
// serve/debounce.rs — pure, time injected
#[derive(Clone, Copy, Debug, PartialEq, Eq)] pub enum Notice { Finished, NeedsYou }
pub struct Debouncer { /* last status + pending (Notice, deadline) per pane */ }
impl Debouncer {
    pub fn new(window: Duration) -> Self;
    pub fn observe(&mut self, pane: &str, status: AgentStatus, now: Instant);
    pub fn due(&mut self, now: Instant) -> Vec<(String, Notice)>;   // removes returned entries
    pub fn next_deadline(&self) -> Option<Instant>;
    pub fn forget(&mut self, pane: &str);
}
// push.rs
#[derive(Serialize, Debug, PartialEq)] pub struct PushMessage { pub to: String, pub title: String, pub body: String,
    pub sound: &'static str /* "default" */, pub data: PushData }
#[derive(Serialize, Debug, PartialEq)] #[serde(rename_all = "camelCase")] pub struct PushData { pub host_id: String, pub pane_id: String }
pub fn messages(cfg: &Config, notice: Notice, pane: &str, title: &str, workspace: &str) -> Vec<PushMessage>;
pub async fn send(client: &reqwest::Client, url: &str, msgs: &[PushMessage]) -> anyhow::Result<Vec<String /* tokens with DeviceNotRegistered */>>;
// serve/watch.rs
pub async fn watch(ctx: &ServeCtx);  // runs forever; reconnects with backoff 1,2,4,8,16,30 s
```
Rules (`observe`): on `→ blocked` from any other status: pending `NeedsYou` at `now + window`. On `working → idle|done`: pending `Finished`. Any other change cancels a pending notice whose condition no longer holds (`NeedsYou` needs `blocked`; `Finished` needs `idle|done`). Initial statuses come from `session.snapshot` agents, so the first event has a "from". `messages`: one per device with an `expo_token` and the matching pref on; title `"<title> needs you"` / `"<title> finished"`; body = workspace label; `data.hostId` = device's `host_id`. Title = `terminal_title_stripped` if not empty, else `agent` (kind). Title and workspace come from a fresh `session.snapshot` at send time (fallback: pane id, ""). Tokens returned as `DeviceNotRegistered` are cleared with `config::update`.

- [ ] **Step 1: Tests** (`serve_debounce.rs`, `t0 = Instant::now()`, window 5 s):
  - `working_to_idle_fires_after_window` — observe(`p`, Working, t0); observe(`p`, Idle, t0+1s); `due(t0+5.9s) == []`; `due(t0+6s) == [("p", Finished)]`.
  - `working_to_done_fires_finished`.
  - `blocked_fires_needs_you` — from Working and from Idle.
  - `flip_back_within_window_sends_nothing` — Working → Blocked at t0, → Working at t0+2s → `due(t0+10s) == []`.
  - `only_from_working_counts_as_finished` — Idle → Idle, Unknown → Idle, Blocked → Idle → `due(t0+10s) == []`.
  - `forget_drops_pending`.
  - `serve_watch.rs::pushes_finished_to_expo` — fake herdr (snapshot: pane `w1:p1`, agent status `working`, `terminal_title_stripped:"api"`, workspace `w1` label `zogssh`), config device `{host_id:"h_1", expo_token:"ExponentPushToken[test]"}`, debounce 50 ms; push `status_ev("w1:p1","idle")` → mock receives exactly `[{"to":"ExponentPushToken[test]","title":"api finished","body":"zogssh","sound":"default","data":{"hostId":"h_1","paneId":"w1:p1"}}]`.
  - `respects_prefs` — `prefs.needs_you=false`, status `blocked` → no request within 300 ms.
  - `clears_unregistered_token` — mock answers `{"data":[{"status":"error","details":{"error":"DeviceNotRegistered"}}]}` → config device `expo_token == None`.
  - `reconnects_after_herdr_restart` — `Push::Drop`, re-bind the fake, then one transition → exactly one push.
  - Phase 1 `rpc_subscribe.rs` tests pass unchanged against the moved fake.
- [ ] **Step 2:** `cargo test` → new tests fail.
- [ ] **Step 3:** Implement. Move the subscribe logic to `events.rs` first and run `cargo test --test rpc_subscribe` before writing the watcher. The watcher loop: `select!` on `stream.next()` and `sleep_until(next_deadline)`.
- [ ] **Step 4:** `cargo test` → pass. Manual: run `serve` with a test device whose token is a real Expo token from a dev build (after Task 18b), finish an agent turn → push arrives.
- [ ] **Step 5:** Commit `feat(companion): serve watches herdr and sends expo pushes`.

### Task 15: Pairing window, `POST /pair`, `pair.revoke`

**Files:**
- Create: `companion/src/pair.rs` (window file, code check, key line, host key fingerprint), `companion/src/serve/http.rs` (axum router)
- Modify: `companion/Cargo.toml` (`rand = "0.9"`, `sha2 = "0.10"`, `base64 = "0.22"`, `qrcode = "0.14"`, `if-addrs = "0.13"`), `companion/src/main.rs` (subcommand `pair`), `companion/src/rpc.rs` (`pair.revoke`), `companion/src/serve/mod.rs`, `protocol/src/index.ts`, `companion/src/types.rs`
- Test: `companion/tests/pair.rs`

**Interfaces — Produces:**
```rust
pub const WINDOW: Duration = Duration::from_secs(300);
pub const MAX_WRONG: u32 = 5;
pub fn open_window(cfg_dir: &Path, now: u64) -> anyhow::Result<String /* 6 digits */>;   // writes pair.json 0600
pub fn key_line(exe: &Path, public_key: &str, device_name: &str) -> Result<String, PairError>;
pub fn append_key(authorized_keys: &Path, line: &str) -> std::io::Result<bool /* false = key blob already present */>;
pub fn remove_key(authorized_keys: &Path, public_key: &str) -> std::io::Result<usize /* lines removed */>;
pub fn host_fingerprint(paths: &[PathBuf]) -> Option<String>;   // "SHA256:<base64 no padding>" of the first readable .pub
pub fn pair_url(addr: &str, port: u16, code: &str) -> String;   // "zogssh://pair?h=<addr>&p=<port>&c=<code>"
#[derive(thiserror::Error, Debug)] pub enum PairError { BadRequest(String), NoWindow, BadCode, TooManyAttempts }
```
- HTTP `POST /pair` JSON `PairRequest` → 200 `PairResponse`; errors `{error: code}` with status 400 `bad_request`, 410 `no_window`, 403 `bad_code`, 429 `too_many_attempts`. Body limit 16 KiB.
- TS: `export type PairRequest = { code: string; device_id: string; device_name: string; host_id: string; public_key: string; expo_token: string | null }; export type PairResponse = { host_name: string; user: string; ssh_port: number; host_key_fingerprint: string | null };`
- On success: append the key line, `upsert_device` (id, name, host_id, public_key, expo_token, default prefs), delete `pair.json`.
- `public_key` must match `^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\r\n]*)?$`; only type + blob are kept. `device_name` → keep `[A-Za-z0-9._-]`, spaces become `-`, max 40, empty → `phone`.
- Code compare is constant time. Each wrong code increments `wrong` in `pair.json`; at `MAX_WRONG` the file is deleted.
- RPC `pair.revoke {device_id, public_key}` → `{removed_keys: number, removed_device: boolean}`: removes every authorized_keys line whose key blob equals the given blob, and the device with that id.
- `zogsshd pair`: opens the window, prints the code in large digits, the first non-loopback IPv4 from `if-addrs`, and the QR of `pair_url` (terminal render with `qrcode::render::unicode::Dense1x2`). Warns `serve is not running — run zogsshd install` when `127.0.0.1:<pair_port>` refuses a TCP connect.

- [ ] **Step 1: Tests** (`pair.rs`; serve HTTP on port 0 in a temp home; host key fixture: a valid ed25519 blob built in the test (`[0,0,0,11]` + `"ssh-ed25519"` + `[0,0,0,32]` + 32 bytes of `7`), written to a temp `.pub`; `ServeCtx.exe = /home/sam/.local/bin/zogsshd`):
  - `pairs_with_right_code` — 200; body `host_key_fingerprint` equals `ssh-keygen -lf`-style value computed in the test with sha2; `authorized_keys` has exactly one line `command="/home/sam/.local/bin/zogsshd rpc",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 <blob> zogssh:Sam-iPhone` (device name "Sam iPhone"); config has the device with `host_id:"h_1"`; `pair.json` gone.
  - `wrong_code_rejected` → 403 `bad_code`, file unchanged.
  - `expired_window_rejected` — window opened with `now - 301` → 410 `no_window`.
  - `five_wrong_codes_close_window` — 5 wrong → 5th returns 429; then right code → 410.
  - `code_is_single_use` — second POST with the same code → 410.
  - `pair_rejects_injection` — `public_key: "ssh-ed25519 AAAA\nssh-rsa BBBB"` → 400; `public_key: "command=\"sh\" ssh-ed25519 AAAA"` → 400; `device_name: "a\"b,c\nd"` → 200 and the line ends with ` zogssh:abcd`; file has 1 line.
  - `duplicate_key_not_appended_twice` — pair twice (two windows) → 1 line, 1 device.
  - `revoke_removes_only_that_key` — file with 3 lines (two other keys) → `pair.revoke` → `removed_keys == 1`, other 2 lines unchanged byte for byte, device gone.
  - `pair_url_format` — `pair_url("10.0.0.5", 7790, "123456") == "zogssh://pair?h=10.0.0.5&p=7790&c=123456"`.
- [ ] **Step 2:** `cargo test --test pair` → fail.
- [ ] **Step 3:** Implement. `append_key` creates `~/.ssh` (0700) and the file (0600) when missing, adds a newline first when the file does not end with one.
- [ ] **Step 4:** `cargo test` → pass. Manual: `cargo run -- serve` and `cargo run -- pair` in two terminals; `curl -s -XPOST localhost:7790/pair -d '{...}' -H 'content-type: application/json'` with a throwaway key in a temp `HOME` (never the real `~/.ssh`).
- [ ] **Step 5:** Commit `feat(companion): pairing window, /pair endpoint and pair.revoke`.

### Task 16a: Bonjour advert in `serve`

**Files:** Create `companion/src/serve/bonjour.rs`. Modify `companion/Cargo.toml` (`mdns-sd = "0.13"`), `companion/src/serve/mod.rs`. Test: `companion/tests/bonjour.rs`.

**Interfaces — Produces:**
```rust
pub const SERVICE_TYPE: &str = "_zogssh._tcp.local.";
pub struct AdvertInfo { pub host: String, pub user: String, pub ssh_port: u16, pub pair_port: u16, pub version: String, pub fingerprint: Option<String> }
pub fn txt(info: &AdvertInfo) -> Vec<(String, String)>;  // host, user, ssh_port, ver, fp (omitted when None)
pub fn advertise(info: &AdvertInfo) -> anyhow::Result<mdns_sd::ServiceDaemon>; // instance name = host; enable_addr_auto; port = pair_port
```
- [ ] **Step 1: Tests:** `txt_has_all_fields` — `txt(&AdvertInfo{host:"mini", user:"sam", ssh_port:22, pair_port:7790, version:"0.2.0", fingerprint:Some("SHA256:abc")})` == `[("host","mini"),("user","sam"),("ssh_port","22"),("ver","0.2.0"),("fp","SHA256:abc")]`; `txt_omits_missing_fp`; `#[ignore] advert_is_browsable` — advertise, browse `SERVICE_TYPE` with a second daemon, resolved within 5 s with TXT `user == "sam"`.
- [ ] **Step 2:** fail. **Step 3:** implement; `serve::run` starts the advert and keeps the daemon alive; an advert error logs and does not stop `serve`.
- [ ] **Step 4:** `cargo test` pass; `cargo test -- --ignored advert_is_browsable` passes on macOS; manual `dns-sd -B _zogssh._tcp` lists the host.
- [ ] **Step 5:** Commit `feat(companion): bonjour advert for _zogssh._tcp`.

### Task 16b: Bonjour browser in the `ssh` native module + discovery store

**Files:**
- Create: `app/modules/ssh/ios/Browser.swift`, `app/src/hosts/discovery.ts`
- Modify: `app/modules/ssh/ios/SshModule.swift` (functions + events), `app/modules/ssh/index.ts`, `app/app.json` (`ios.infoPlist`)
- Test: `app/src/hosts/discovery.test.ts`

**Interfaces — Produces:**
```ts
// modules/ssh/index.ts (new)
export type FoundService = { name: string; address: string | null; pairPort: number; txt: Record<string, string> };
export function startBrowse(): Promise<void>;   // NWBrowser .bonjourWithTXTRecord(type: "_zogssh._tcp", domain: nil)
export function stopBrowse(): Promise<void>;
// events: "onServiceFound" FoundService, "onServiceLost" { name: string }
// src/hosts/discovery.ts
export type Discovered = { name: string; address: string | null; pairPort: number; user?: string; sshPort: number; fingerprint?: string; version?: string };
export function applyFound(list: Discovered[], s: FoundService): Discovered[];  // replace by name, sorted by name
export function applyLost(list: Discovered[], name: string): Discovered[];
export function useDiscovery(active: boolean): Discovered[];                 // start/stop browse with `active`
export function knownHostFor(d: Discovered, hosts: Host[]): Host | undefined; // match by fingerprint, else by address
```
Swift: on `browseResultsChangedHandler`, for each added `.service` result, open an `NWConnection` to the endpoint (TCP), on `.ready` read `currentPath?.remoteEndpoint` → IPv4 string (prefer IPv4; strip `%iface`), cancel, then emit `onServiceFound`. Resolve timeout 3 s → `address: null`. `app.json`: `NSLocalNetworkUsageDescription: "Zogssh finds your computers that run zogsshd on the local network."`, `NSBonjourServices: ["_zogssh._tcp"]`, `NSAppTransportSecurity: { NSAllowsLocalNetworking: true }` (pairing is plain HTTP on the LAN or WireGuard).

- [ ] **Step 1: Tests:** `found_parses_txt` — `{name:"mini", address:"10.0.0.5", pairPort:7790, txt:{user:"sam", ssh_port:"2222", fp:"SHA256:abc", ver:"0.2.0"}}` → `{…, user:"sam", sshPort:2222, fingerprint:"SHA256:abc"}`; `bad_ssh_port_defaults_to_22`; `found_twice_replaces`; `lost_removes`; `known_host_by_fingerprint_then_address`.
- [ ] **Step 2:** `pnpm --filter app test discovery` → fail. **Step 3:** implement JS + Swift.
- [ ] **Step 4:** pass; `pnpm --filter app typecheck`; dev build; simulator with `serve` running on this Mac shows the host (log the event from a temporary dev button, removed before commit).
- [ ] **Step 5:** Commit `feat(app): bonjour browser and discovery store`.

### Task 17: `zogsshd install`

**Files:** Create `companion/src/install.rs`. Modify `companion/src/main.rs`. Test: `companion/tests/install.rs`.

**Interfaces — Produces:**
```rust
pub const LABEL: &str = "com.zogtech.zogsshd";
pub fn launchd_plist(bin: &Path, home: &Path) -> String;
pub fn systemd_unit(bin: &Path) -> String;
pub enum Os { Macos, Linux }
pub struct InstallOpts { pub home: PathBuf, pub exe: PathBuf, pub os: Os, pub dry_run: bool }
pub struct InstallReport { pub bin: PathBuf, pub unit_path: PathBuf, pub commands: Vec<Vec<String>>, pub next_steps: Vec<String> }
pub fn install(o: &InstallOpts) -> anyhow::Result<InstallReport>;  // dry_run: write files, do not run commands
```
- Copies `exe` to `home/.local/bin/zogsshd` (skip when same file; mode 0755).
- macOS: `~/Library/LaunchAgents/com.zogtech.zogsshd.plist`: `ProgramArguments [bin, "serve"]`, `RunAtLoad true`, `KeepAlive true`, `StandardErrorPath ~/Library/Logs/zogsshd.log`, `EnvironmentVariables.PATH = "<home>/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"`. Commands: `launchctl bootout gui/<uid>/com.zogtech.zogsshd` (error ignored), `launchctl bootstrap gui/<uid> <plist>`.
- Linux: `~/.config/systemd/user/zogsshd.service`: `ExecStart=<bin> serve`, `Restart=always`, `RestartSec=5`, `Environment=PATH=<home>/.local/bin:/usr/local/bin:/usr/bin:/bin`, `WantedBy=default.target`. Commands: `systemctl --user daemon-reload`, `systemctl --user enable --now zogsshd.service`. Next step `sudo loginctl enable-linger <user>` when `loginctl show-user <user> -p Linger` prints `Linger=no`.
- Next steps always end with `zogsshd pair`.

- [ ] **Step 1: Tests:** `plist_runs_serve` (contains `<string>/home/sam/.local/bin/zogsshd</string>` then `<string>serve</string>`, `<key>KeepAlive</key>`); `unit_runs_serve` (contains `ExecStart=/home/sam/.local/bin/zogsshd serve` and `Restart=always`); `dry_run_copies_binary_and_writes_unit` (temp home, fake exe file → bin exists with mode 0755, unit file exists, `commands` non-empty, nothing executed); `reinstall_is_idempotent`.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass. Manual on this Mac: `cargo build --release && target/release/zogsshd install` → `launchctl print gui/$(id -u)/com.zogtech.zogsshd` shows running; on the dev server the same with systemd (`systemctl --user status zogsshd`).
- [ ] **Step 5:** Commit `feat(companion): install command for launchd and systemd`.

### Task 18a: App pairing flow, discovery screen, remove host

**Files:**
- Create: `app/src/device.ts`, `app/src/pairing/pair.ts`, `app/src/pairing/pairUrl.ts`, `app/src/hosts/removeHost.ts`
- Create routes: `app/src/app/hosts/discover.tsx`, `app/src/app/hosts/pair.tsx`, `app/src/app/hosts/scan.tsx`, `app/src/app/pair.tsx` (deep link `zogssh://pair?...` → redirect to `hosts/pair`)
- Modify: `app/src/app/_layout.tsx` (screen options), `app/src/app/(tabs)/settings.tsx` ("Add host" → `hosts/discover`), `app/src/app/hosts/[id].tsx` (Remove uses `removeHost`), `app/app.json` (`expo-camera` plugin with `cameraPermission`), `protocol/src/index.ts` (types from Task 15)
- Test: `app/src/pairing/pair.test.ts`, `app/src/pairing/pairUrl.test.ts`, `app/src/hosts/removeHost.test.ts`

**Interfaces — Consumes:** `PairRequest`, `PairResponse` (Task 15), `useDiscovery`, `knownHostFor` (Task 16b), `ensureKey` (Phase 1), `useHosts().addHost/removeHost`.

**Interfaces — Produces:**
```ts
// device.ts
export function getDeviceId(): Promise<string>;   // "d_<random>", SecureStore key "zogssh.device_id"
export function deviceName(): string;             // expo-device deviceName ?? "iPhone"
// pairing/pairUrl.ts
export function parsePairUrl(url: string): { address: string; port: number; code: string } | null;
// pairing/pair.ts
export class PairFailed extends Error { code: "bad_code" | "no_window" | "too_many_attempts" | "unreachable" | "bad_request" }
export function pairMessage(code: PairFailed["code"]): string;
export async function pairWithHost(o: { address: string; port?: number /* 7790 */; code: string; name?: string },
  deps?: { fetch?: typeof fetch; expoToken?: () => Promise<string | null> }): Promise<Host>;
// hosts/removeHost.ts
export async function removeHostEverywhere(hostId: string, deps?: { rpc?: Pick<RpcClient, "call"> }): Promise<{ revoked: boolean }>;
```
`pairWithHost`: makes a host id first, POSTs `http://<address>:<port>/pair` (timeout 10 s via `AbortController`), then `addHost({id, name: name ?? host_name, address, port: ssh_port, user, fingerprint: host_key_fingerprint ?? undefined})`. Messages: `bad_code` "Wrong code. Check the code on the host.", `no_window` "No pairing window. Run zogsshd pair on the host.", `too_many_attempts` "Too many wrong codes. Run zogsshd pair again.", `unreachable` "Can't reach <address>:<port>. Is zogsshd serve running?". `removeHostEverywhere`: when online, `pair.revoke {device_id, public_key}` (errors ignored), then `removeHost`. Screens: discover = list of `Discovered` (paired ones show "Paired"), "Add by address" row (→ `hosts/pair` with an address field) and "Add manually" (→ existing `hosts/add`); pair = address (prefilled), 6-digit code field (`keyboardType="number-pad"`, `textContentType="oneTimeCode"`), "Scan QR" (→ `hosts/scan`, `CameraView` with `barcodeScannerSettings={{barcodeTypes:["qr"]}}`, calls `parsePairUrl`).

- [ ] **Step 1: Tests:**
  - `parse_pair_url` — `"zogssh://pair?h=10.0.0.5&p=7790&c=123456"` → `{address:"10.0.0.5", port:7790, code:"123456"}`; missing `c` → null; `c=12345` → null; other scheme → null.
  - `pair_posts_request_and_saves_host` — mock fetch returns 200 `{host_name:"mini", user:"sam", ssh_port:22, host_key_fingerprint:"SHA256:abc"}` → fetch URL `http://10.0.0.5:7790/pair`, body has `code:"123456"`, `device_id` from `getDeviceId`, `public_key` from mocked `ensureKey`, `host_id` equal to the saved host id; saved host `{address:"10.0.0.5", port:22, user:"sam", fingerprint:"SHA256:abc", name:"mini"}`.
  - `pair_maps_errors` — 403 `{error:"bad_code"}` → `PairFailed` code `bad_code`; fetch rejects → `unreachable`; no host saved.
  - `remove_revokes_then_deletes` — rpc mock receives `pair.revoke {device_id, public_key}`; host gone. `remove_offline_still_deletes` — no rpc → `{revoked:false}`, host gone.
- [ ] **Step 2:** fail. **Step 3:** implement (`npx expo install expo-camera expo-device`).
- [ ] **Step 4:** pass; typecheck; dev build; simulator: `zogsshd pair` on this Mac → discover lists it → code → host appears online in Overview, its fingerprint pinned.
- [ ] **Step 5:** Commit `feat(app): pair with a host by code or QR, discovery list, revoke on remove`.

### Task 18b: Push registration and notification deep links

**Files:**
- Create: `app/src/push/token.ts`, `app/src/push/register.ts`, `app/src/push/prefs.ts`, `app/src/push/useNotificationRouting.ts`
- Modify: `app/src/hosts/connection.ts` (after `hello` succeeds: `registerPush`), `app/src/pairing/pair.ts` (send the token), `app/src/app/_layout.tsx` (`useNotificationRouting()`, `setNotificationHandler`), `app/src/app/(tabs)/settings.tsx` (Notifications: "Finished" and "Needs you" switches), `app/app.json` (`expo-notifications` plugin; `extra.eas.projectId` from `eas init`)
- Test: `app/src/push/register.test.ts`, `app/src/push/routing.test.ts`

**Interfaces — Consumes:** `push.register` (Task 13), `getDeviceId`, `deviceName` (Task 18a).

**Interfaces — Produces:**
```ts
export function getExpoToken(): Promise<string | null>;  // permission asked once; null when denied or no projectId
export const useNotifPrefs: UseBoundStore<…>;            // persisted { finished: boolean; needs_you: boolean }, both default true
export async function registerPush(rpc: Pick<RpcClient, "call">, hostId: string, deps?: { token?: () => Promise<string | null> }): Promise<void>;
export function notificationTarget(data: unknown): string | null; // {hostId, paneId} → "/session/<hostId>/<paneId>?from=push" (both URL-encoded), else null
export function useNotificationRouting(): void;   // cold start (getLastNotificationResponseAsync) + addNotificationResponseReceivedListener → router.push
```
Changing a pref re-registers on every online host. Registration errors are logged, never shown as a host error.

- [ ] **Step 1: Tests:** `register_sends_device_and_prefs` — rpc gets `push.register {device_id:"d_x", host_id:"h_1", name:"Sam-iPhone", expo_token:"ExponentPushToken[test]", prefs:{finished:true, needs_you:true}}`; `register_with_denied_permission_sends_null_token`; `target_from_data` — `{hostId:"h_1", paneId:"w1:p1"}` → `"/session/h_1/w1%3Ap1?from=push"`; `target_rejects_bad_data` (missing paneId, non-string) → null.
- [ ] **Step 2:** fail. **Step 3:** implement (`npx expo install expo-notifications`; run `eas init` once if `extra.eas.projectId` is missing).
- [ ] **Step 4:** pass; dev build on a real iPhone (simulators get no remote push); finish an agent turn on this Mac → push "… finished" in about 5 s; tap → session screen of that pane; turn off "Finished" → next finish sends nothing.
- [ ] **Step 5:** Commit `feat(app): push registration, notification prefs and deep links`.

---

## Phase 3: Voice

### Task 19: Hold to talk (voice module ASR + mic button)

**Files:**
- Create: `app/modules/voice/expo-module.config.json`, `app/modules/voice/ios/VoiceModule.podspec`, `app/modules/voice/ios/VoiceModule.swift`, `app/modules/voice/ios/Recognizer.swift`, `app/modules/voice/index.ts`
- Create: `app/src/voice/holdToTalk.ts` (pure reducer), `app/src/voice/MicButton.tsx`, `app/src/voice/useDictation.ts`
- Modify: `app/src/thread/Composer.tsx` (mic button + live partial text), `app/src/app/new.tsx` (mic fills the prompt field), `app/app.json` (`NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`)
- Test: `app/src/voice/holdToTalk.test.ts`

**Interfaces — Produces:**
```ts
// modules/voice/index.ts
export function requestPermission(): Promise<"granted" | "denied">;     // mic + speech
export function startDictation(o?: { locale?: string }): Promise<void>; // rejects "busy" | "denied" | "unavailable"
export function stopDictation(): Promise<string>;                        // final text
export function cancelDictation(): Promise<void>;
// events: "onPartial" { text: string }, "onDictationError" { code: string; message: string }
// voice/holdToTalk.ts
export type HoldState = { phase: "idle" | "recording" | "armedCancel" | "finishing"; partial: string };
export type HoldEvent = { type: "press" } | { type: "move"; dx: number; dy: number } | { type: "release" }
  | { type: "partial"; text: string } | { type: "final"; text: string } | { type: "error" };
export type HoldEffect = "start" | "stop" | "cancel" | { send: string } | "hapticStart" | "hapticCancel" | "hapticSend";
export const CANCEL_DISTANCE = 80; // pt from the press point
export function holdReducer(s: HoldState, e: HoldEvent): { state: HoldState; effects: HoldEffect[] };
// voice/MicButton.tsx
export function MicButton(p: { onSend: (text: string) => void; onPartial?: (text: string) => void; disabled?: boolean }): JSX.Element;
```
Swift `Recognizer`: iOS 26+ with `SpeechTranscriber.isAvailable` and installed assets (`AssetInventory`) → `SpeechAnalyzer` + `SpeechTranscriber` (volatile results → `onPartial`); else `SFSpeechRecognizer` with `requiresOnDeviceRecognition = true` when `supportsOnDeviceRecognition`. Audio session `.playAndRecord`, options `[.duckOthers, .allowBluetoothHFP, .defaultToSpeaker]`; deactivate with `.notifyOthersOnDeactivation` after stop or cancel. `MicButton`: `Gesture.Pan().minDistance(0)` (onBegin = press, onUpdate = move, onEnd = release, onFinalize without end = cancel), 64 pt round button, red ring while recording, "Release to send · slide away to cancel" hint, haptics via `expo-haptics` (start `Impact.Medium`, send `Notification.Success`, cancel `Notification.Warning`). The Composer sends with the existing `agent.prompt` path; the `agent_blocked` message stays.

- [ ] **Step 1: Tests** (`holdToTalk.test.ts`):
  - `press_starts` — idle + press → phase `recording`, effects `["start", "hapticStart"]`.
  - `release_sends_trimmed_final` — recording + release → `finishing`, effects `["stop"]`; then final `"  hi there "` → idle, effects `[{send:"hi there"}, "hapticSend"]`.
  - `release_after_slide_away_cancels` — move `{dx:0, dy:-81}` → `armedCancel`; release → idle, effects `["cancel", "hapticCancel"]`; no `send`.
  - `slide_back_rearms` — move `dy:-81` then `dy:-10` → `recording`.
  - `empty_transcript_sends_nothing` — final `"   "` → idle, no `send`.
  - `error_sends_nothing` — recording + error → idle, effects `["cancel"]`.
  - `partial_updates_text`.
- [ ] **Step 2:** `pnpm --filter app test holdToTalk` → fail. **Step 3:** implement (`npx expo install expo-haptics`).
- [ ] **Step 4:** pass; dev build on a real iPhone: hold, say "say hi", release → prompt reaches the agent; slide away → nothing sent; airplane mode → still works (on-device).
- [ ] **Step 5:** Commit `feat(app): hold-to-talk with on-device speech recognition`.

### Task 20: TTS full mode

**Files:**
- Create: `app/src/voice/speechText.ts`, `app/src/voice/replyToSpeak.ts`, `app/src/voice/settings.ts`, `app/src/voice/useSpeakReplies.ts`
- Modify: `app/modules/voice/ios/VoiceModule.swift` + `index.ts` (`setSpeechAudio`, `releaseAudio`), session screen `app/src/app/session/[hostId]/[paneId].tsx` (header speaker toggle; `from=push` speaks once), `app/src/app/(tabs)/settings.tsx` (Voice: TTS default on/off, Full/Summary, voice, rate)
- Test: `app/src/voice/speechText.test.ts`, `app/src/voice/replyToSpeak.test.ts`

**Interfaces — Produces:**
```ts
export function speechText(markdown: string): string;
export function replyToSpeak(items: ThreadItem[]): string | null;   // assistant markdown after the last user item, joined "\n\n"; null if none
export function shouldSpeak(prev: AgentStatus | undefined, next: AgentStatus): boolean; // working → idle|done
export type VoiceSettings = { ttsDefault: boolean; mode: "full" | "summary"; voice?: string; rate: number /* 1.0 */ };
export const useVoiceSettings: UseBoundStore<…>;   // persisted
export const useSessionSpeak: UseBoundStore<…>;    // { bySession: Record<string /* hostId:paneId */, boolean> }, falls back to ttsDefault
export function useSpeakReplies(hostId: string, paneId: string, status: AgentStatus | undefined, items: ThreadItem[], o?: { speakNow?: boolean }): void;
// modules/voice (new)
export function setSpeechAudio(): Promise<void>;  // .playback, [.duckOthers, .allowBluetoothA2DP]
export function releaseAudio(): Promise<void>;
```
`speechText`: fenced code → "code block."; inline code → its text; tables → "a table."; links `[t](u)` → `t`; bare URLs → "a link"; images → ""; headings, emphasis, list markers, blockquote markers removed; collapse whitespace. Speaking uses `expo-speech` `Speech.speak(text, {voice, rate, onDone: releaseAudio, onStopped: releaseAudio})`. A new prompt or leaving the screen calls `Speech.stop()`. The voice picker lists `getAvailableVoicesAsync()` voices for the device language, enhanced/premium first.

- [ ] **Step 1: Tests:**
  - `code_block_becomes_marker` — ``"Run this:\n```sh\nls\n```\nDone."`` → `"Run this: code block. Done."`.
  - `table_becomes_marker` — `"Totals:\n| a | b |\n|---|---|\n| 1 | 2 |\nEnd"` → `"Totals: a table. End"`.
  - `link_keeps_text` — `"See [the docs](https://x.dev) now"` → `"See the docs now"`.
  - `strips_emphasis_and_headings` — `"## Plan\n**Bold** and _it_\n- one\n- two"` → `"Plan Bold and it one two"`.
  - `reply_after_last_user` — items `[user, assistant "a", user, assistant "b", tool, assistant "c"]` → `"b\n\nc"`; no assistant after last user → null.
  - `should_speak_only_from_working` — (working, idle) true; (working, done) true; (blocked, idle) false; (undefined, idle) false.
- [ ] **Step 2:** fail. **Step 3:** implement (`npx expo install expo-speech`).
- [ ] **Step 4:** pass; dev build: speaker on, prompt "say hi in two sentences" → reply is spoken with music ducked; AirPods play it.
- [ ] **Step 5:** Commit `feat(app): speak agent replies (full mode)`.

### Task 21: Summary mode (Foundation Models → `summary.make` → full)

**Files:**
- Create: `companion/src/summary.rs`, `app/src/voice/summarize.ts`
- Modify: `companion/src/rpc.rs` (`summary.make`; `Ctx.anthropic_url` default `https://api.anthropic.com/v1/messages`), `app/modules/voice/ios/VoiceModule.swift` + `index.ts`, `app/src/voice/useSpeakReplies.ts`
- Test: `companion/tests/summary.rs`, `app/src/voice/summarize.test.ts`

**Interfaces — Produces:**
```rust
pub const MODEL: &str = "claude-haiku-5-5";
pub const MAX_INPUT_CHARS: usize = 24_000;      // keep the end when longer
pub const SYSTEM: &str = "You summarize a coding agent's reply for someone listening on headphones. \
Say in 2 or 3 short sentences what the agent did and what it needs from the user. No markdown, no code, no lists.";
pub async fn make(client: &reqwest::Client, url: &str, key: &str, text: &str) -> Result<String, RpcError>;
```
- RPC `summary.make {text}` → `{summary: string}`. No `anthropic_key` in config → error `no_key`. HTTP error or empty content → `upstream_error`. Request body: `{model: MODEL, max_tokens: 200, system: SYSTEM, messages: [{role:"user", content: text}]}`; result = concatenated `content[].text` where `type == "text"`.
```ts
// modules/voice (new)
export function localSummaryAvailable(): Promise<boolean>;      // FoundationModels SystemLanguageModel.default.availability == .available (iOS 26+)
export function summarizeLocal(text: string, instructions: string): Promise<string>;
// voice/summarize.ts
export const SUMMARY_INSTRUCTIONS: string; // same text as the Rust SYSTEM
export async function speakableReply(markdown: string, mode: "full" | "summary", deps: {
  local: { available(): Promise<boolean>; summarize(t: string): Promise<string> };
  rpc?: Pick<RpcClient, "call"> }): Promise<{ text: string; source: "local" | "host" | "full" }>;
```
Order: local when available → `summary.make` → `speechText(markdown)`. Each step that throws falls to the next. Summary input is `speechText(markdown)`.

- [ ] **Step 1: Tests:**
  - Rust `summary_calls_anthropic` — mock server; config `anthropic_key = "test-key"` → request header `x-api-key: test-key`, `anthropic-version: 2023-06-01`, body `model == "claude-haiku-5-5"`, `max_tokens == 200`; mock answers `{"content":[{"type":"text","text":"Did X. Needs Y."}]}` → result `{summary:"Did X. Needs Y."}`.
  - `summary_without_key` → error `no_key`, no request made.
  - `summary_upstream_error` — mock 500 → `upstream_error`.
  - `long_input_keeps_end` — 30 000 chars ending with `"END"` → sent content length 24 000, ends with `"END"`.
  - TS `uses_local_first`; `falls_back_to_host` (local unavailable → rpc `summary.make`, source `host`); `falls_back_to_full_on_no_key` (rpc rejects `no_key` → source `full`, text = `speechText`); `full_mode_skips_summary` (no deps called).
- [ ] **Step 2:** fail. **Step 3:** implement.
- [ ] **Step 4:** pass; manual: Summary mode on an iOS 26 device speaks the local summary; with Apple Intelligence off and `anthropic_key` set, speaks the host summary.
- [ ] **Step 5:** Commit `feat: summary mode for spoken replies`.

---

## Phase 4: Extras

### Task 22: Terminal view with ANSI colors and key row

**Files:**
- Create: `app/src/terminal/ansi.ts`, `app/src/terminal/KeyRow.tsx`, `app/src/terminal/AnsiText.tsx`
- Modify: `app/src/thread/useTerminalText.ts` (format option, 1 s refresh while visible, `refresh()`), `app/src/thread/TerminalView.tsx`, `app/src/theme/tokens.ts` (`colors.ansi: string[16]`, terminal palette tokens), session screen (Terminal mode shows `KeyRow` + a text box)
- Test: `app/src/terminal/ansi.test.ts`, `app/src/terminal/keys.test.ts`

**Interfaces — Produces:**
```ts
export type Span = { text: string; fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; inverse?: boolean };
export type Line = Span[];
export function parseAnsi(text: string, palette: readonly string[] /* 16 */): Line[];
export const KEYS: readonly { label: string; key: string }[]; // Esc→"esc", Tab→"tab", Ctrl-C→"ctrl+c", ↑ "up", ↓ "down", ← "left", → "right", Enter→"enter"
export function sendKey(rpc: Pick<RpcClient, "call">, paneId: string, key: string): Promise<void>;   // herdr.call pane.send_keys {pane_id, keys:[key]}
export function sendLine(rpc: Pick<RpcClient, "call">, paneId: string, text: string): Promise<void>; // pane.send_text {pane_id, text} then pane.send_keys ["enter"]
export function useTerminalText(hostId: string, paneId: string, enabled: boolean, o?: { format?: "text" | "ansi"; refreshMs?: number }): { text?: string; error?: string; refresh: () => void };
```
Terminal reads `herdr.call pane.read {pane_id, source:"recent", lines:200, format:"ansi", strip_ansi:false}`, refreshed every 1000 ms while visible and right after each key. SGR support: 0, 1, 2, 3, 4, 7, 22, 23, 24, 27, 30–37, 39, 40–47, 49, 90–97, 100–107, `38;5;n`, `48;5;n`, `38;2;r;g;b`, `48;2;r;g;b`. Other CSI and OSC sequences are dropped. Lucide icons for arrows; Ctrl-C button uses the destructive token.

- [ ] **Step 1: Tests:** `plain_text_one_span`; `sgr_color_and_reset` — `"\x1b[31mred\x1b[0m ok"` → `[[{text:"red", fg:palette[1]}, {text:" ok"}]]`; `bright_and_bg` (`\x1b[92;44m`); `color_256_and_truecolor` (`38;5;196` → `"#ff0000"`, `38;2;1;2;3` → `"#010203"`); `drops_osc_and_cursor_moves` (`"\x1b]0;title\x07a\x1b[2Kb"` → `"ab"`); `split_lines_keep_style` (style carries across `\n`); `truncated_escape_at_end_is_dropped`; `keys_send_herdr_names` — `sendKey(rpc,"w1:p1","ctrl+c")` → `herdr.call {method:"pane.send_keys", params:{pane_id:"w1:p1", keys:["ctrl+c"]}}`; `send_line_text_then_enter` (call order).
- [ ] **Step 2:** fail. **Step 3:** implement. Verify each key name once by hand: `herdr pane send-keys <pane> up` etc. on a scratch pane.
- [ ] **Step 4:** pass; simulator: Terminal mode shows Claude's colored screen; Esc, arrows and Ctrl-C act in a scratch `bash` pane.
- [ ] **Step 5:** Commit `feat(app): ansi terminal view with key row`.

### Task 23: Permission buttons

**Files:**
- Create: `app/src/thread/choices.ts`, `app/src/thread/PermissionButtons.tsx`, fixtures `app/src/thread/__fixtures__/{claude_bash_permission.txt, claude_edit_permission.txt, claude_numbered_prose.txt, claude_idle_prompt.txt}` (hand-written, shaped like Claude Code 2.1.x screens)
- Modify: `app/src/thread/Composer.tsx` (when the agent is blocked, show buttons instead of `BLOCKED_MESSAGE`; keep the message when no choices parse)
- Test: `app/src/thread/choices.test.ts`

**Interfaces — Produces:**
```ts
export type Choice = { key: string /* "1".."9" */; label: string; selected: boolean };
export function parseChoices(screen: string): Choice[];
export function useChoices(hostId: string, paneId: string, blocked: boolean): Choice[]; // pane.read {pane_id, source:"visible", format:"text"} every 1 s while blocked
export function PermissionButtons(p: { choices: Choice[]; onPick: (c: Choice) => void }): JSX.Element;
```
Parse rule: look only at the last 20 non-empty lines; find the last block of consecutive lines matching `^\s*(?:[❯›>]\s*)?(\d)\.\s+(.+?)\s*$`; accept it only when the numbers run 1..n with n ≥ 2 and exactly one line carries the `❯`/`›`/`>` marker. Strip box-drawing characters (`│╭╮╰╯─`) from both line ends first. A pick sends `pane.send_keys {pane_id, keys:[digit]}` (Claude's selector confirms on the digit; no Enter, so nothing lands in the prompt box), with a success haptic. The last choice whose label starts with "No" uses the destructive style.

- [ ] **Step 1: Tests:** `bash_permission` → `[{key:"1",label:"Yes",selected:true},{key:"2",label:"Yes, and don't ask again for git status commands in /home/sam/proj",selected:false},{key:"3",label:"No, and tell Claude what to do differently (esc)",selected:false}]`; `edit_permission` → 3 choices; `numbered_prose_is_ignored` (numbered list in the reply, no marker) → `[]`; `idle_prompt` → `[]`; `boxed_lines_are_stripped` (`"│ ❯ 1. Yes │"` style lines parse).
- [ ] **Step 2:** fail. **Step 3:** implement.
- [ ] **Step 4:** pass; simulator: ask a test agent to run `git status` with permissions on → buttons appear; tap "Yes" → agent continues, buttons vanish.
- [ ] **Step 5:** Commit `feat(app): permission buttons for blocked agents`.

### Task 24: Restart / Resume / Rename / Close

**Files:**
- Create: `app/src/herdr/sessionActions.ts`, route `app/src/app/resume/[hostId]/[paneId].tsx` (modal list)
- Modify: `app/src/herdr/startSession.ts` (`StartOptions.args?: string[]` passed to `agent.start`), session screen (header "…" button + long press on the title → `ActionSheetIOS`), `app/src/app/_layout.tsx`
- Test: `app/src/herdr/sessionActions.test.ts`, `app/src/herdr/startSession.test.ts` (new case)

**Interfaces — Consumes:** `startSession`, `sessions.recent` (Phase 1: `{cwd, limit}` → `RecentSession[]`), `AgentInfo`.

**Interfaces — Produces:**
```ts
export async function restartAgent(rpc: Pick<RpcClient, "call">, a: AgentInfo): Promise<{ paneId: string }>;
// startSession({cwd: a.cwd, kind: a.agent, workspaceId: a.workspace_id}) then pane.close {pane_id: a.pane_id}
export async function resumeSession(rpc: Pick<RpcClient, "call">, a: AgentInfo, session: string): Promise<{ paneId: string }>;
// startSession({cwd, kind:"claude", workspaceId, args:["--resume", session]}); the old pane stays
export async function renameAgent(rpc: Pick<RpcClient, "call">, paneId: string, name: string): Promise<void>;
// agent.rename {target: paneId, name}; name must match /^[a-z][a-z0-9_-]{0,31}$/ else throws code "bad_name"
export async function closeAgent(rpc: Pick<RpcClient, "call">, paneId: string): Promise<void>; // pane.close {pane_id}
```
Menu items: Restart, Resume older session (Claude only), Rename, Close (destructive, confirm alert). After Restart/Resume `router.replace` to the new pane. Rename uses `Alert.prompt`. Resume list shows `first_prompt` and relative `last_activity`, newest first.

- [ ] **Step 1: Tests:** `start_passes_args` — `agent.start` params include `args:["--resume","abc"]`; `restart_starts_then_closes_old` (call order: `tab.create`, `agent.start {kind:"codex"}`, `pane.close {pane_id:"w1:p1"}`); `restart_keeps_old_when_start_fails` (no `pane.close`); `resume_uses_resume_args`; `rename_validates` (`"My Agent"` → `bad_name`, no call); `close_sends_pane_close`.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; simulator: each menu item on a scratch session.
- [ ] **Step 5:** Commit `feat(app): restart, resume, rename and close a session`.

### Task 25: Subagent thread screen

**Files:**
- Create: route `app/src/app/subagent/[hostId]/[agentId].tsx` (param `log`), `app/src/thread/useSubagentThread.ts`
- Modify: `companion/src/rpc.rs` (`thread.subagent` result adds `log_path`), `companion/src/types.rs`, `protocol/src/index.ts`, `app/src/thread/items/SubagentCard.tsx` (tap opens the screen when `agent_id` is set)
- Test: `companion/tests/claude_resolve.rs` (new case), `app/src/thread/useSubagentThread.test.tsx`

**Interfaces — Produces:**
- RPC `thread.subagent {log_path, agent_id, before?, limit}` → `SubagentPage = ThreadPage & { log_path: string }` (the subagent file path).
- `useSubagentThread(hostId: string, parentLog: string, agentId: string): { items: ThreadItem[]; status: FollowStatus; loadOlder(): void; hasOlder: boolean }` — first page via `thread.subagent`, then `thread.follow {log_path, from: end}`; older pages via `thread.subagent {before: cursor}`.
- The screen reuses `ThreadList`; header shows the subagent description; no composer.

- [ ] **Step 1: Tests:** Rust `subagent_page_includes_log_path` (fixture parent log + `subagents/agent-a1.jsonl` → `log_path` ends with `/subagents/agent-a1.jsonl`); TS `loads_page_then_follows_subagent_log` (rpc mock: `thread.subagent` then `thread.follow {log_path:".../agent-a1.jsonl", from: 120}`; a follow event adds an item).
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; simulator: a session that used a Task tool → tap the card → subagent thread renders.
- [ ] **Step 5:** Commit `feat: subagent thread screen`.

### Task 26a: `stats.get` and host card meters

**Files:**
- Create: `companion/src/stats.rs`, `app/src/hosts/useHostStats.ts`, `app/src/ui/Meter.tsx`, `app/src/ui/format.ts`
- Modify: `companion/Cargo.toml` (`sysinfo = "0.37"`), `companion/src/rpc.rs` (`Ctx.stats: Arc<Mutex<sysinfo::System>>`), `companion/src/types.rs`, `protocol/src/index.ts`, Overview host card in `app/src/app/(tabs)/index.tsx`
- Test: `companion/tests/stats.rs`, `app/src/ui/format.test.ts`

**Interfaces — Produces:**
- RPC `stats.get` → `Stats = { cpu_pct: number; mem_used: number; mem_total: number; load: [number, number, number]; uptime_s: number }` (bytes; `mem_used = total − available`). The first call in a process refreshes CPU twice, `sysinfo::MINIMUM_CPU_UPDATE_INTERVAL` apart; later calls refresh once against the kept `System`.
- `useHostStats(hostId: string): Stats | undefined` — every 10 s while the screen is focused and the app is active.
- `formatBytes(n: number): string` (`17179869184` → `"16 GB"`, `1610612736` → `"1.5 GB"`), `pct(used: number, total: number): number` (0..100, 0 when total is 0).
- `Meter({ label, value /* 0..100 */, detail })` — bar + text label (not color only); bar color: accent < 70, amber 70–89, danger ≥ 90 (status tokens).

- [ ] **Step 1: Tests:** Rust `stats_are_sane` (`0.0 <= cpu_pct <= 100.0`, `0 < mem_used <= mem_total`, `uptime_s > 0`), `second_call_is_fast` (< 100 ms); TS `format_bytes`, `pct_bounds`.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; simulator: host cards show CPU and Mem bars for this Mac and the dev server.
- [ ] **Step 5:** Commit `feat: host cpu and memory stats`.

### Task 26b: `usage.get` and Usage tab

**Files:**
- Create: `companion/src/usage.rs`, `app/src/app/(tabs)/usage.tsx`, `app/src/usage/useUsage.ts`
- Modify: `companion/src/rpc.rs` (`usage.get`; `Ctx.usage_urls`), `companion/src/types.rs`, `protocol/src/index.ts`, `app/src/app/(tabs)/_layout.tsx` (tab with `Gauge` icon), `app/src/ui/format.ts` (`formatResetIn`)
- Test: `companion/tests/usage.rs`, `app/src/ui/format.test.ts`

**Interfaces — Produces:**
```ts
export type UsageWindow = { label: string; used_pct: number; resets_at: number | null /* unix s */ };
export type ProviderUsage = { provider: "claude" | "codex"; status: "ok" | "not_logged_in" | "unavailable"; error?: string; windows: UsageWindow[] };
export type Usage = { providers: ProviderUsage[] };   // always both providers, in that order
export function formatResetIn(resetsAt: number | null, nowS: number): string; // 7800 s → "resets in 2h 10m"; < 60 s → "resets now"; null → ""
```
- Claude token: macOS `security find-generic-password -s "Claude Code-credentials" -w`; Linux `~/.claude/.credentials.json`; field `claudeAiOauth.accessToken`. `GET <claude_usage_url>` (default `https://api.anthropic.com/api/oauth/usage`) with `Authorization: Bearer`, `anthropic-beta: oauth-2025-04-20`. Parse `five_hour` → "5h", `seven_day` → "7d", `seven_day_opus` → "7d Opus" (skip null), `utilization` → `used_pct`, ISO `resets_at` → unix s.
- Codex token: `~/.codex/auth.json` `tokens.access_token`, `tokens.account_id`. `GET <codex_usage_url>` (default `https://chatgpt.com/backend-api/wham/usage`) with `Authorization: Bearer`, `ChatGPT-Account-Id`. Parse `rate_limit.primary_window` / `secondary_window` (`used_percent`, `reset_at`, label from `limit_window_seconds`: 18000 → "5h", 604800 → "7d", else `"<n>h"`).
- Never refresh or write tokens. No credentials → `not_logged_in`. 401 → `unavailable`, error `"token expired — open the CLI on the host"`. Other failure → `unavailable`. Pure parse functions `parse_claude(&Value) -> Vec<UsageWindow>`, `parse_codex(&Value) -> Vec<UsageWindow>`. First implementation step: confirm both endpoints and field names by hand on this Mac (`curl` with the real token, output not committed) and against herdr-gpui's source; fixtures hold invented numbers only.
- Usage tab: per host section: provider rows of `Meter`s with `formatResetIn`, then the host's CPU/Mem meters (Task 26a). Pull to refresh; auto refresh every 60 s while focused.

- [ ] **Step 1: Tests:** `parse_claude_windows` (fixture → `[{label:"5h", used_pct:42.0, resets_at:1767225600}, {label:"7d", …}]`); `parse_codex_windows`; `usage_with_mock_endpoints` (temp home with both credential files, mock server → both `ok`); `missing_credentials_not_logged_in`; `expired_token_unavailable` (mock 401); TS `format_reset_in`.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; simulator: Usage tab shows real bars for this Mac.
- [ ] **Step 5:** Commit `feat: plan usage per host and usage tab`.

### Task 27: Automations tab

`herdr-automate` is not installed on this Mac or the dev server (checked 2026-10-29), and `herdr --help` has no automation command. The companion isolates the CLI contract in one adapter, so the tab works today (“not installed”) and only the parse functions change when a real CLI appears.

**Files:**
- Create: `companion/src/automations.rs`, `app/src/app/(tabs)/automations.tsx`, `app/src/automations/useAutomations.ts`
- Modify: `companion/src/rpc.rs` (`Ctx.bin_dirs: Vec<PathBuf>` = `$PATH` entries + `~/.local/bin` + `~/.cargo/bin`), `companion/src/types.rs`, `protocol/src/index.ts`, `app/src/app/(tabs)/_layout.tsx` (tab with `Workflow` icon)
- Test: `companion/tests/automations.rs` (fake `herdr-automate` shell script in a temp dir)

**Interfaces — Produces:**
```ts
export type Automation = { id: string; name: string; schedule?: string; enabled: boolean;
  pending_approval: boolean; plan?: string; caps?: string[]; content_hash?: string };
export type AutomationRun = { id: string; automation_id: string; started_at: number; finished_at: number | null;
  status: "running" | "ok" | "failed" | "pending_approval"; summary?: string };
```
- RPC `automations.list` → `{automations: Automation[]}` (runs `herdr-automate list --json`).
- RPC `automations.runs {id?, limit=20}` → `{runs: AutomationRun[]}` (`herdr-automate runs --json [--id <id>] --limit <n>`).
- RPC `automations.approve {id, content_hash}` → `{approved: true}` (`herdr-automate approve <id> --hash <content_hash>`).
- Binary not found in `bin_dirs` → error code `not_installed` for all three. Non-zero exit → `automate_failed` with the first stderr line. Output that does not parse → `bad_output`. Timeout 15 s.
- Tab: per host — `not_installed` → card "herdr-automate is not installed on <host>" (muted, not an error); else automations list (pending ones first, amber "Needs approval"), last runs, and an approve sheet that shows plan, caps and content hash with a "Approve" button.

- [ ] **Step 1: Tests:** `not_installed_when_missing` (empty `bin_dirs` → `not_installed` for list, runs, approve); `list_maps_json` (script prints a fixture → one pending automation with `content_hash:"sha256:abc"`); `approve_passes_hash` (script writes its args to a file → `approve a1 --hash sha256:abc`); `nonzero_exit_is_automate_failed`.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; simulator: tab shows "not installed" for both hosts.
- [ ] **Step 5:** Commit `feat: automations tab (herdr-automate adapter)`.

### Task 28a: Swipe between agents in a workspace

**Files:** Create `app/src/herdr/neighbors.ts`. Modify session screen (pan gesture on the thread area only, not the terminal). Test: `app/src/herdr/neighbors.test.ts`.

**Interfaces — Produces:** `neighborAgents(s: Snapshot, paneId: string): { prev?: string; next?: string }` — agents of the same workspace ordered by tab `number`, then by the pane's index in `s.panes`; no wrap-around. Gesture: `Gesture.Pan().activeOffsetX([-30, 30]).failOffsetY([-15, 15])`; on end with `|translationX| > 80` or `|velocityX| > 600` → `router.replace` to the neighbor, selection haptic; Reduce Motion → no slide animation.

- [ ] **Step 1: Tests:** `orders_by_tab_then_pane`; `first_has_no_prev`; `other_workspace_excluded`; `unknown_pane_returns_empty`.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass; simulator: swipe moves between two agents of one workspace.
- [ ] **Step 5:** Commit `feat(app): swipe between agents in a workspace`.

### Task 28b: Polish pass and Phases 2–4 end-to-end check

- [ ] Run the ui-ux-pro-max pre-delivery checklist (`design-system/zogssh/MASTER.md`) over every new screen: tokens only (`grep -rn "#[0-9A-Fa-f]\{6\}" app/src --include=*.tsx` finds nothing outside `theme/`), 44 pt targets, labels plus icons on statuses and meters, Dynamic Type at the largest size, Reduce Motion, VoiceOver labels on the mic and key-row buttons. Fix what fails; one commit `fix(app): polish pass`.
- [ ] Add the missing spec item: a light haptic when the open session's agent status changes (`useSpeakReplies` already watches the status; add `Haptics.selectionAsync()` there). Commit with the polish fixes.
- [ ] Install on both hosts with `zogsshd install` (dev server: build from a temp clone, as in Task 12). Delete the manually added hosts from Phase 1 in the app and pair both again by code; check that `authorized_keys` on each host has the restricted line and that `ssh -i <phone key copy> host` without a command still runs only `zogsshd rpc`.
- [ ] On a real iPhone over WireGuard: Bonjour list (LAN only), push for finished and needs-you with the app closed, tap opens the session and speaks it, hold-to-talk prompt, Summary mode, terminal keys, permission button, restart and resume, subagent thread, stats, usage, automations "not installed", swipe.
- [ ] Write `docs/phase2-4-verification.md` with what passed and what did not. Commit `docs: phase 2-4 verification`.
