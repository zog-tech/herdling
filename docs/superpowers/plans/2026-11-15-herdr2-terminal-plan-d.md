# Herdr 2 terminal view (plan D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Herdr 2 (`hc:`) pane shows its terminal in the app as a herdr 1 pane does: ANSI colors, scrollback, live updates, the page keys of a full-screen app. Old apps (1.0.0, 1.0.1) get this with no app change.

**Architecture:** herdlingd answers the same calls with the same shapes that the app uses for herdr 1. `pane.watch` on a core pane opens a passive `terminal.attach` stream (`observe: true`) on a framed core connection, feeds the bytes into a terminal emulator in herdlingd (the `vt100` crate), and sends the rendered screen with SGR colors as the herdr 1 `pane.watch` events. A pure state machine (`core/attach.rs`) owns the stream life: attach, frames, close, reconnect with a generation per attempt. `pane.get` gets the herdr 1 `scroll` field from the facts of a running watch, so the app finds full-screen apps. `pane.read` with `format: "ansi"` takes one paint from a short attach.

**Tech Stack:** Rust (tokio, serde_json), herdr-core JSON-RPC generation 1 in framed mode, `vt100` 0.18 (new), the fakes in `companion/tests/support/`.

**Spec:** `docs/superpowers/specs/2026-11-13-herdr2-main-backend-design.md` ("Removing herdr 1", row `pane.watch`; "What is left to the builder", the terminal view; slice 6, herdlingd part). Other plans: A (done), B (install and update of herdr-core), C (Herdr 2 actions), E (delete herdr 1, 0.2.0), F (app).

## What the app uses today (read in `app/src`)

| App code | Call | What it needs |
|---|---|---|
| `thread/useTerminalText.ts` | `pane.watch` `{pane_id, lines: 200, format: "ansi", interval_ms: 80}` when `hello.methods` has it | Events `{revision, text, truncated}`; an `{error, message}` or `{closed: true}` event ends the stream, then the app polls |
| same, fallback | `herdr.call` `pane.read` `{source: "recent", lines, format: "ansi", strip_ansi: false}` every 1 s | `read.text` with SGR |
| `terminal/ansi.ts` | — | SGR only: 0, 1, 2, 3, 4, 7, 22–27, 30–37, 39, 40–47, 49, 90–97, 100–107, `38/48;5;n`, `38/48;2;r;g;b`. Lines split on `\n` |
| `thread/TerminalView.tsx`, `terminal/pageScroll.ts` | `herdr.call` `pane.get` | `pane.scroll.{max_offset_from_bottom, viewport_rows}`: offset 0 and a screen that fills every row means a full-screen app, so the app shows Page Up and Page Down |
| `terminal/latency.tsx` | `ping` | Already works |
| keys, text, page keys | `pane.send_input`, `pane.send_keys`, `pane.send_text` | Already routed (`core/route.rs`); the page sequences become the `pageup` / `pagedown` keys |

The app does not gate the terminal view of a core pane (`allows(..., "thread")` gates only the chat view). Nothing changes in the app.

## The choice: `terminal.attach` and an emulator, not `terminal.read` polling

- `terminal.read` gives plain text only (`ReadResult {text, complete, how}`). Polling it can never show colors. The view must look like the herdr 1 view, so polling is out.
- `terminal.attach` gives the first paint (screen, optional `history` lines, status) and then the raw program output. `observe: true` is "watch only: never type or resize" (core `viewers.rs`: an observer's DATA, RESIZE and FOCUS are dropped, it never sets the size). With `resize_notifications: true` the core sends a RESIZE frame before the first paint and before each repaint after a size change. This was checked read-only on the live core 0.1.19: the attach answered `{channel, resize_notifications: true, automatic_input: true}`, then RESIZE `[cols, rows]`, then one DATA frame that starts with CAN and draws history lines with `\r\n` and the screen with SGR.
- Raw bytes are not a screen. herdlingd needs an emulator to turn them into lines of text with SGR. `vt100` 0.18 (MIT, pure Rust, deps `vte`, `unicode-width`, `itoa`) has a grid, scrollback, the alternate screen and cell colors and attributes. It never writes answers back, so it cannot type into the terminal. Rendering is ours (`core/screen.rs`), so the output has only the SGR codes that `ansi.ts` knows.
- One emulator per watch, in the `herdlingd rpc` process of that SSH channel. It costs the grid plus `lines` of history.
- A core that does not list `terminal.attach` in `hello.methods` keeps the plain `terminal.read` polling of today.

## Global Constraints

- Branch `herdr2-terminal` in `.claude/worktrees/herdr2-terminal`. Small commits, prefix `companion:` or `docs:`, one short line, no period, a blank line and the reason, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git config user.name` is `zog-tech`. Do not push. Do not install the binary.
- Plans B and C change `rpc.rs`, `protocol/src/index.ts`, `docs/protocol.md` and `CHANGELOG.md` too. Keep the edits there small and in one place each. Do not touch `core/route.rs` or `core/live.rs` beyond one call site.
- Add fields and methods only; new fields optional. An unknown id gives `pane_not_found`, never a panic.
- herdlingd never types, resizes or focuses through an attach: only CREDIT and CLOSE frames go out on a stream channel. A test checks this.
- No test touches the live core: `tests/support/fake_core.rs` (extended for framed mode) and temp folders.
- Test data: user `sam`, paths like `/home/sam/proj`, hosts like `studio.local`.
- Cargo: `CARGO_TARGET_DIR=/Volumes/MiniSSD/builds/herdling-target nice -n 15 cargo test -j 2`, the same for `clippy -j 2 --all-targets -- -D warnings`. No `cargo fmt` over the crate.
- ASD-STE100 for comments and docs. Each new module starts with a doc comment that says what it is for.

## Review Focus

1. Passive attach: the attach params have `observe: true`; herdlingd sends no DATA, RESIZE, FOCUS, FACTS or AUTOMATIC_INPUT frame — test in Task 4.
2. Flow control: herdlingd sends CREDIT for every DATA payload, so a long stream never stalls at 256 KiB — test in Task 4.
3. The terminal ends (CLOSE with `exited`): the reattach gets `finished` → the app gets `{error: "pane_not_found"}` and the stream ends — tests in Tasks 3 and 4.
4. The core restarts (socket closed): herdlingd reattaches with a new generation and a fresh emulator; a late frame of the old attempt is ignored; after the retry limit the app gets `{closed: true}` — tests in Tasks 3 and 4.
5. A panic in the emulator on strange bytes ends nothing: the attempt counts as lost and herdlingd reattaches — Task 4.
6. Output with only the SGR codes that `app/src/terminal/ansi.ts` knows; trailing blank rows cut on the main screen, every row kept on the alternate screen (for `fullScreenApp`) — Task 2.

---

### Task 1: The framed wire codec

**Files:**
- Create: `companion/src/core/frame.rs`
- Modify: `companion/src/core/mod.rs` (`pub mod frame;`)
- Test: `companion/tests/core_frame.rs`

**Interfaces (all in `herdlingd::core::frame`):**
- `pub const DATA: u8 = 0; CREDIT = 1; CLOSE = 2; RESIZE = 3; FOCUS = 4; FACTS = 5; AUTOMATIC_INPUT = 6;`
- `pub const HEADER: usize = 9; pub const MAX_PAYLOAD: usize = 16 << 20;`
- `#[derive(Debug, Clone, PartialEq)] pub struct Frame { pub channel: u32, pub kind: u8, pub payload: Vec<u8> }`
- `pub fn encode(channel: u32, kind: u8, payload: &[u8]) -> Vec<u8>` — `[channel u32 LE][kind u8][len u32 LE][payload]`.
- `pub fn credit(channel: u32, n: u32) -> Vec<u8>`, `pub fn close(channel: u32) -> Vec<u8>`, `pub fn rpc(msg: &Value) -> Vec<u8>` (DATA on channel 0).
- `#[derive(Default)] pub struct Decoder` with `pub fn push(&mut self, bytes: &[u8])` and `pub fn next(&mut self) -> Result<Option<Frame>, TooLarge>`; `pub struct TooLarge(pub usize)`.
- `pub fn size(payload: &[u8]) -> Option<(u16, u16)>` — RESIZE payload to `(cols, rows)`.

- [ ] **Step 1: Failing tests:** round trip of each kind; a frame split at every byte position decodes once; two frames in one push; a header that claims more than `MAX_PAYLOAD` gives `TooLarge`; `size` of `[155,0,46,0]` is `(155, 46)` and of 3 bytes is `None`.
- [ ] **Step 2:** `nice -n 15 cargo test -j 2 --test core_frame` → compile error.
- [ ] **Step 3: Implement** (pure, no I/O).
- [ ] **Step 4:** the tests pass.
- [ ] **Step 5: Commit** — "companion: add the herdr-core framed wire codec"

### Task 2: The screen emulator and its ANSI render

**Files:**
- Modify: `companion/Cargo.toml` (`vt100 = "0.18"`), `Cargo.lock`
- Create: `companion/src/core/screen.rs`
- Test: `companion/tests/core_screen.rs`

**Interfaces (`herdlingd::core::screen`):**
- `pub struct Emulator` with `pub fn new(cols: u16, rows: u16, history: usize) -> Emulator` (0 counts as 1), `pub fn feed(&mut self, bytes: &[u8])`, `pub fn resize(&mut self, cols: u16, rows: u16)`, `pub fn alternate(&self) -> bool`, `pub fn rows(&self) -> u16`, `pub fn render(&mut self, ansi: bool) -> Render`.
- `#[derive(Debug, Clone, PartialEq)] pub struct Render { pub text: String, pub alternate: bool, pub rows: u16, pub history: usize }` — `history` is the count of history lines in `text`.
- Render rules: history lines (main screen only, oldest first) then the screen rows; lines joined with `\n`. Each line: the text of its cells, wide-character continuation cells skipped, an empty cell is a space. Trailing cells with no text and a default background, not inverse or underlined, are cut. On the main screen, trailing empty rows of the screen are cut (herdr 1 does the same); on the alternate screen every row stays. With `ansi`, a style change writes one SGR: `\x1b[0` then `;1` bold, `;2` dim, `;3` italic, `;4` underline, `;7` inverse, the colors (`30–37`/`90–97` for index 0–15, `38;5;n` for 16–255, `38;2;r;g;b`; the 4x forms for the background), then `m`. A line that ends with a style writes `\x1b[0m`. Each line starts with the default style.

- [ ] **Step 1: Failing tests:** plain text `hi\r\nthere` → `"hi\nthere"`; red `\x1b[31mred\x1b[0m` → `"\x1b[0;31mred\x1b[0m"`; 256 and RGB colors, bright index 9 → `91`, bg; bold + inverse; `ansi: false` has no `\x1b`; trailing spaces cut but a colored background kept; 30 lines into a 10-row emulator with history 50 → 21 history lines plus the screen rows and `history == 21`; history cap; `\x1b[?1049h` alternate screen → `alternate`, all rows kept, no history; a wide `"界"` renders once; `resize` to a smaller grid keeps the bottom rows; CAN (`\x18`) in a paint does not show.
- [ ] **Step 2:** fails (no module).
- [ ] **Step 3: Implement.** History through `set_scrollback` in blocks of `rows`, then back to 0.
- [ ] **Step 4:** pass.
- [ ] **Step 5: Commit** — "companion: render Herdr 2 terminal output with an emulator"

### Task 3: The attach stream state machine

**Files:**
- Create: `companion/src/core/attach.rs`
- Test: `companion/tests/core_attach.rs`

**Interfaces (`herdlingd::core::attach`):** pure `step(state, input, now) -> Step`.
- `pub const MAX_RETRIES: u32 = 5;` `pub fn backoff(failures: u32) -> Duration` — 250 ms doubled per failure, at most 4 s.
- `pub enum State { Attaching { gen, failures }, Live { gen, channel, dirty, last_emit: Option<Instant> }, Waiting { gen, failures, until }, Ended }`
- `pub enum Input { Attached { gen, channel, cols, rows }, Failed { gen, failure: Failure }, Resize { gen, cols, rows }, Data { gen, bytes }, Closed { gen }, Tick, Stop }` with `pub enum Failure { Gone { code, message }, Unavailable(String) }`.
- `pub enum Effect { Connect { gen }, Reset { cols, rows }, Feed(Vec<u8>), Resize { cols, rows }, Credit { channel, n }, Emit, End(Ending) }` with `pub enum Ending { Error { code, message }, Closed }`.
- `pub struct Step { pub state: State, pub effects: Vec<Effect> }`, `pub fn wake(state: &State) -> Option<Instant>`, `pub fn start(gen: u64) -> State` (Attaching, failures 0).
- `pub struct Config { pub interval: Duration }`, passed to `step`.

Rules:
- Any input with a `gen` other than the state's `gen` gives no change and no effect.
- `Attaching` + `Attached` → `Live`, `Reset`, not dirty. `Attaching` + `Failed(Gone)` → `End(Error)`. `Failed(Unavailable)` → `Waiting` with `failures + 1` and `until = now + backoff`; when `failures + 1 > MAX_RETRIES` → `End(Closed)`.
- `Live` + `Data` → `Feed`, `Credit { channel, n: len }`, dirty; `Emit` at once when `last_emit` is `None` or at least `interval` old. `Live` + `Resize` → `Resize`, dirty. `Live` + `Tick` with dirty and the interval passed → `Emit`. `Live` + `Closed` → `Waiting` with failures 0 + 1 (a stream that lived starts the count again). `Live` + `Failed(Gone)` → `End(Error)`.
- `Waiting` + `Tick` at or after `until` → `Attaching { gen + 1 }`, `Connect { gen + 1 }`.
- `Stop` from any state → `Ended`, no effect. `Ended` takes no input.
- `wake`: `Live` dirty → `last_emit + interval`; `Waiting` → `until`; else `None`.

- [ ] **Step 1: Failing tests:** each state with each input, including a stale generation in `Live` and `Waiting`, the retry limit, the first data emits at once, a second data within the interval does not emit but `wake` gives the due time, `Tick` then emits once, `Ended` ignores everything.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit** — "companion: add the attach stream state machine for Herdr 2 panes"

### Task 4: `pane.watch` on a core pane through `terminal.attach`

**Files:**
- Create: `companion/src/core/term_watch.rs` (the I/O: framed connection, attach, the driver loop, facts)
- Modify: `companion/src/core/mod.rs`, `companion/src/watch.rs` (core branch: attach when the core lists `terminal.attach`, else the `terminal.read` poll of today)
- Modify: `companion/tests/support/fake_core.rs` (framed mode: `hello {framed: true}`, `terminal.attach`, frames in and out, `Ctl::Output`, `Ctl::CloseStream`, `Ctl::Resize`; a `frames` log of what herdlingd sent; a `State.attach` switch that lists the method)
- Test: `companion/tests/core_terminal.rs`

**Interfaces:**
- `pub async fn open(sock: &CoreSocket, timeout: Duration, addr: &str, history: usize) -> Result<Attached, CoreError>` — connect, `hello {generation: 1, framed: true}`, `terminal.attach {terminal, observe: true, resize_notifications: true, history, cols, rows}` (cols and rows from the record or 80×24), wait for the reply on channel 0. `Attached { conn, channel, cols, rows }`.
- `pub async fn supports_attach(sock, timeout) -> bool` — `hello.methods` has `terminal.attach`.
- `pub async fn watch(...)` — the driver: runs `attach::step`, does the effects, reads frames with `select!` against `wake`, catches an emulator panic (`catch_unwind`) as `Closed`, and sends `{revision: 0, text, truncated}` through the existing `watch::Gate`. `End(Error)` sends `{error, message}`; `End(Closed)` sends `{closed: true}`.
- `pane.watch` with a core id: the first `open` happens before the reply, so `pane_not_found` is the call error, as for herdr 1.

- [ ] **Step 1: Failing tests** (fake core with `attach: true`):
  - `watch_streams_ansi`: the paint `"\x18\x1b[H\x1b[2J\x1b[31mred\x1b[0m"` → the first event text is `"\x1b[0;31mred\x1b[0m"`; `Ctl::Output("\r\nnext")` → a later event has `red` and `next` on two lines.
  - `attach_is_passive`: the attach params have `observe: true`; every frame herdlingd sent on the stream channel is CREDIT or CLOSE, and the CREDIT sum equals the DATA bytes.
  - `unknown_pane_is_not_found`: `hc:t99` → call error `pane_not_found`.
  - `exit_ends_with_pane_not_found`: after the first event, the test removes `t1` and sends `CLOSE {"reason":"exited"}` → event `{error: "pane_not_found"}`.
  - `core_restart_reattaches`: `Ctl::Drop` → a second `terminal.attach` call, and a later screen arrives.
  - `old_core_polls_read`: a core with no `terminal.attach` → `terminal.read` calls as today (the existing `pane_watch_reads_a_core_pane` test stays green).
- [ ] **Step 2–4:** fail, implement, pass. Run all companion tests.
- [ ] **Step 5: Commit** — "companion: stream Herdr 2 panes with colors through terminal.attach"

### Task 5: Full-screen facts in `pane.get` and an ANSI `pane.read`

**Files:**
- Modify: `companion/src/core/term_watch.rs` (`Facts`, `snapshot`), `companion/src/rpc.rs` (one `Ctx` field, and one hook in `herdr_call` for a core id)
- Test: `companion/tests/core_terminal.rs`

**Interfaces:**
- `#[derive(Clone, Default)] pub struct Facts` (a shared map pane id → `{alternate, rows, history}`, written at each emit, removed when the watch ends). `Ctx.term_facts: Facts`.
- `pub fn add_scroll(result: &mut Value, facts: &Facts, pane: &str)` — on a `pane.get` answer, sets `pane.scroll = {max_offset_from_bottom, viewport_rows}`: offset 0 on the alternate screen, else the history line count; `viewport_rows` the rows. No facts: no change.
- `pub async fn snapshot(sock, timeout, addr, lines) -> Result<String, CoreError>` — one attach, the paint until 40 ms with no frame (at most 1 s), the ANSI render, then CLOSE.
- `herdr_call`: a core `pane.read` with `format: "ansi"` and a core that lists `terminal.attach` → the herdr 1 `pane_read` shape with the ANSI text; other core calls as now; a core `pane.get` → `add_scroll`.

- [ ] **Step 1: Failing tests:** during a watch of an alternate-screen paint, `pane.get` has `scroll {max_offset_from_bottom: 0, viewport_rows: 24}`; with no watch, no `scroll`; `pane.read` `format: "ansi"` gives the SGR text and closes its channel; `format: "text"` still calls `terminal.read`.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit** — "companion: report full-screen apps and ANSI reads for Herdr 2 panes"

### Task 6: Docs and a read-only live check

**Files:** `docs/protocol.md` (the core table row of `pane.read`, `pane.watch` and `pane.get`), `CHANGELOG.md` (Unreleased), `AGENTS.md` (`core/` row: `frame.rs`, `screen.rs`, `attach.rs`, `term_watch.rs`).

- [ ] **Step 1:** update the three files.
- [ ] **Step 2:** privacy check of `git diff main` (names, hosts, IPs, home paths, SSH aliases, private projects).
- [ ] **Step 3: Live check, read only:** `cargo build -j 2`, then pipe `hello` and a `pane.watch` of an existing `hc:` shell pane through `./herdlingd rpc` for a few seconds. Expected: events with SGR text; the core shows no input and no size change.
- [ ] **Step 4: Commit** — "docs: Herdr 2 terminal view"
