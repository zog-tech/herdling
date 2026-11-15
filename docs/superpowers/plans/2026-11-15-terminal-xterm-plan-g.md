# Real terminal view with xterm.js (plan G) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The terminal view of a Herdr 2 pane is a real terminal emulator: an exact cell grid,
full-width background colors, the cursor, full-screen apps (vim, htop, Claude Code), wide
characters and emoji, in the user's terminal theme.

**Architecture:** herdlingd gets an opt-in raw stream on `pane.watch` (`format: "vt"`). It sends
the bytes of `terminal.attach` as base64 events, with no emulator in herdlingd. The core's first
paint recreates the screen and the history in a fresh emulator, so herdlingd does not make its own
repaint. The app shows the stream in xterm.js inside a `react-native-webview` that loads lazily (the
same way as `preview/`). xterm.js and its addons are bundled into the app as strings and inlined
into the page HTML. Keyboard input stays in React Native. A setting picks "Classic" (today's
`AnsiText`) or "Terminal" (the new view).

**Tech Stack:** Rust (tokio, serde_json, base64 0.22, already a dependency). Expo SDK 58,
TypeScript strict, `react-native-webview` 14.0.1 (already in the 1.0.1 binary), `@xterm/xterm`
6.0.0, `@xterm/addon-search` 0.16.0, `@xterm/addon-unicode11` 0.9.0 (new, JS only).

**Spec:** the task brief of plan G; `docs/protocol.md` ("Terminal screen: `pane.watch`",
"Terminal view"); plan D (`2026-11-15-herdr2-terminal-plan-d.md`); plan F2
(`2026-11-15-herdr2-app-session-plan-f2.md`: Phone width, key bar, terminal themes).

## Decisions

### Companion: the raw stream

- **The core already makes the repaint.** herdr-core `viewers.rs` `first_paint` starts each attach
  with CAN, a soft reset, every mode turned off, up to `history` lines pushed into the scrollback
  with `\r\n`, a clear, the screen with SGR, the modes, the cursor and the title (Ghostty
  `Terminal::paint`). The paint is made for a fresh viewer emulator. After a size change or when a
  viewer falls behind, the core sends a RESIZE frame and a paint with `history = 0` (clear and the
  screen; the viewer keeps its own scrollback). So herdlingd forwards the bytes as they come. A
  `vt100` repaint (`state_formatted`) is not needed and would lose the cursor modes that Ghostty
  keeps.
- **Params.** `pane.watch` takes `format: "vt"`. An older herdlingd refuses it with `bad_request`
  ("format must be text or ansi"), so the app gates on a new `hello` field:
  `watch_formats: ["text", "ansi", "vt"]`. `cols` and `rows` keep their meaning (drive mode);
  without them the attach is passive (`observe: true`). `lines` is the history of the first paint.
- **Reply.** `{stream, format: "vt"}` plus `drive: true` in drive mode.
- **Events** (the `data` of the stream event):
  - `{vt: "reset", gen, seq: 0, cols, rows}`: a new attach (the first one, or a reattach after the
    core connection closed). The app makes a fresh emulator of that size. The core paint follows.
  - `{vt: "data", gen, seq, data}`: raw bytes, standard base64. At most 48 KiB of bytes per event.
  - `{vt: "resize", gen, seq, cols, rows}`: the terminal size changed. A paint follows.
  - `{error, message}` and `{closed: true}` end the stream, as for the other formats.
  - `seq` counts the events of one `gen` from 0. The app drops an event of an old `gen` and starts
    the watch again on a gap.
- **Batching.** The state machine of plan D (`core/attach.rs`) stays as it is: its `Emit` effect
  (at most one per `interval_ms`, at once after a quiet time) flushes the bytes that came since the
  last flush. A batch of 256 KiB flushes at once. So typing echo has no added delay, and a flood
  of output costs at most 20 events per second plus the size cap.
- **Pure core.** `core/vt.rs`: `Batch` with `reset`, `feed`, `resize`, `flush`, which give the
  events (JSON values). `term_watch.rs` runs the attach effects into a `Batch` instead of the
  emulator when the format is `vt`. No emulator and no `pane.get` facts in this mode (the app reads
  the alternate screen from xterm.js).
- **Old core.** A core with no `terminal.attach` gives the call error `unsupported`, and the app
  uses the classic view. On herdlingd 0.2.0 every pane is a Herdr 2 pane. A herdlingd 0.1.x host has
  no `watch_formats`, so the app keeps the classic view there.

### App: the view

- **Lazy WebView.** `XtermView` gets the component from `preview/webview.ts` `loadWebView()`. A
  binary without `RNCWebViewModule` gets null, and `TerminalView` uses the classic view. The
  1.0.1 binary has the module.
- **Bundled xterm.js, offline.** `app/scripts/gen-xterm-assets.mjs` reads `lib/xterm.js`,
  `css/xterm.css`, the two addon UMD files and the JetBrains Mono regular and bold TTF files
  (base64, as `@font-face` data URLs, so the cell grid matches the app font) and writes
  `app/src/terminal/xterm/assets.generated.ts` (string constants, with the license lines and the
  versions). The file is in git, so Metro and EAS Update need no extra step. A Jest test runs the
  generator in memory and fails when the file differs from `node_modules` (a version bump without a
  new file). The page has no `http`, `https` or `//` URL in a `src` or `href`.
- **OTA safety.** `@xterm/*` are plain JavaScript and CSS with no native code and no
  `expo-module.config.json`. They never load in the React Native runtime: the app holds them as
  strings, and only the WebView runs them. `react-native-webview` is already a native dependency of
  1.0.1. No change to `app.json`.
- **Renderer.** The DOM renderer of xterm.js. The WebGL addon works in current WKWebView and Android
  WebView, but a lost GL context needs extra code, and DOM speed is enough for a phone grid.
  WebGL is a follow-up.
- **Bridge (RN → page)**, one JSON string per `postMessage`, all with an `e` (epoch) that grows by
  one on each accepted reset:
  `reset {cols, rows}`, `data {b64}`, `resize {cols, rows}`, `theme {theme}`, `font {size}`,
  `search {term, dir: "next" | "prev" | "clear"}`, `scrollToBottom`, `scrollPages {n}`.
  Before the page says `ready`, messages wait in an outbox. The outbox keeps the messages since
  the last reset (at most 4 MiB of data); above that it marks an overflow, and on `ready` the app
  starts the watch again. A page reload (the web content process ended) mounts a new page and starts
  the watch again.
- **Bridge (page → RN):** `ready`, `metrics {cellWidth, cellHeight, fontSize, width, height}`,
  `buffer {alternate, atBottom}`, `search {index, count}`, `tap`, `text {text}` (long press: the
  plain text of the buffer, for the "Select text" screen). `parseFromWeb` checks each shape; an
  unknown message is dropped.
- **Input.** The page never takes the keyboard: `disableStdin`, the hidden textarea gets
  `inputmode="none"` and loses focus at once, and a transparent layer over the terminal takes every
  touch (vertical drag scrolls the buffer, horizontal drag scrolls the page sideways, tap, long
  press). xterm.js `onData` (answers to device queries, mouse reports) is not connected, so the page
  never types into the pane. Typing stays in `TerminalControls` (box, "Type directly", key bar).
- **Width modes** (pure `layout.ts`, from the cell size that the page measures, as a ratio of the
  font size):
  - Phone width: drive at `floor(width / cell)` × `floor(height / line)` at the normal font size,
    clamped to the `pane.watch` limits. As in plan F2: a 400 ms debounce, a new grid starts a new
    watch, a reply with no `drive` marks the connection and shows Fit.
  - Fit: passive, the pane grid, the font size so that the columns fit the width and the rows fit the
    height, never above the normal size, never below `FIT_MIN_SIZE` (then the page scrolls).
  - Scroll sideways: passive, the normal font size (smaller only to fit the rows in the height); the
    page scrolls sideways.
  - Wrap: a grid cannot wrap. The new view shows Wrap as Fit, and its width button cycles Fit,
    Scroll, Phone.
- **Features.** Search: the search addon (`findNext`/`findPrevious` with decorations in the search
  tokens; the page reports `index` and `count`). Page keys: on the alternate screen the page
  buttons send Page Up and Page Down to the app (as today); on the main screen the history scrolls
  by touch (the bridge also has `scrollPages` for a later button). Follow: xterm.js keeps the view at the end while it is there; a "Jump to end"
  button shows when it is not; the keyboard opening jumps to the end. Copy: a long press opens
  "Select text" with the buffer text. The latency badge stays. Themes: `xtermTheme(colors)` maps
  `terminal.bg`, `terminal.fg`, the 16 `ansi` colors and the selection; a theme change remounts the
  screen (as today), and the new page gets the new theme.
- **Stays on the classic view only:** Wrap lines, local echo and typing prediction (the raw stream
  shows the echo of the computer; prediction on the grid is a follow-up), herdr 1 panes and
  herdlingd 0.1.x hosts, the `pane.read` poll fallback, the preview `TerminalView` in the session
  peek (no controls: it uses the same choice as the session view).
- **Setting.** Settings, Terminal: "Renderer", a segmented choice "Terminal" (default) or
  "Classic". `chooseRenderer(pref, {formats, webView})` gives "terminal" only when the pref is
  "terminal", the host lists `vt` in `watch_formats` and the build has the web view. A stream
  error `unsupported` or `bad_request` falls back to Classic for that screen.

## File map

| File | What |
|---|---|
| `companion/src/core/vt.rs` (new) | Pure batcher of raw stream events |
| `companion/src/core/term_watch.rs` | `Watch.format`, the vt branch of `run`, `{format: "vt"}` reply, `unsupported` on an old core |
| `companion/src/watch.rs` | `Format` enum in `WatchParams` (`text`, `ansi`, `vt`) |
| `companion/src/rpc.rs`, `types.rs` | `hello.watch_formats` |
| `companion/tests/core_vt.rs` (new), `core_terminal.rs`, `pane_watch.rs` | Tests |
| `protocol/src/index.ts` | `PaneWatchParams.format` `"vt"`, `PaneWatchResult.format`, `PaneWatchVtEvent`, `Hello.watch_formats` |
| `app/scripts/gen-xterm-assets.mjs` (new) | Writes `assets.generated.ts` |
| `app/src/terminal/xterm/assets.generated.ts` (new, generated) | xterm.js, CSS, addons, fonts as strings |
| `app/src/terminal/xterm/page.ts` (new) | `xtermHtml(assets)`: the page and its small script |
| `app/src/terminal/xterm/bridge.ts` (new) | Message types, `parseFromWeb`, `vtReducer`, `outboxReducer`, `chunkB64` |
| `app/src/terminal/xterm/layout.ts` (new) | Width mode math |
| `app/src/terminal/xterm/theme.ts` (new) | `xtermTheme(colors)` |
| `app/src/terminal/xterm/search.ts` (new) | `searchOp(prev, next, count)` |
| `app/src/terminal/renderer.ts` (new) | Renderer pref store and `chooseRenderer` |
| `app/src/terminal/xterm/useVtStream.ts` (new) | The `pane.watch` `vt` stream hook |
| `app/src/terminal/xterm/XtermView.tsx` (new) | The WebView component and the bridge |
| `app/src/thread/TerminalView.tsx` | Picks the renderer; the xterm branch of the body |
| `app/src/app/(tabs)/settings/index.tsx` | "Renderer" row |

## Global Constraints

- Worktree `.claude/worktrees/herdr2-xterm`, branch `herdr2-xterm`. Do not push, build, OTA or install.
- Do not touch `core/route.rs`, `core/live.rs`, `core/actions.rs`, `core_install/`, `workspace.close`,
  `tab.close` or the `hc:` id handling of the app (a parallel branch).
- Add fields and params only. Old apps never send `format: "vt"`; nothing changes for them.
- No new native dependency. `react-native-webview` loads only through `loadWebView()`.
- herdlingd sends only CREDIT and CLOSE frames on a stream channel, in every format.
- Cargo: `CARGO_TARGET_DIR=/Volumes/MiniSSD/builds/herdling-target`, `nice -n 15 cargo test -j 2`,
  `nice -n 15 cargo clippy -j 2 --all-targets -- -D warnings`, no `cargo fmt` over the crate.
  App: `pnpm exec tsc --noEmit`, `nice -n 15 pnpm test --maxWorkers=2`.
- TypeScript strict, no `any`, design tokens only, ASD-STE100 for comments and UI text.
- Commits by `zog-tech`, `terminal: …`, `companion: …`, `docs: …`.

## Review Focus

1. A reattach in the middle of a stream: late bytes of the old attach never reach the new
   emulator (companion: `gen`; app: `vtReducer` and the page epoch) — tests in Tasks 1, 2, 4.
2. A big first paint (2000 lines of history) before the page is ready: the outbox keeps it in
   order, or marks an overflow and restarts the watch — test in Task 4.
3. A full-screen app that asks for mouse reports or device answers: the page sends nothing to the
   pane (no `onData` link; check in the page test that `onData` is never named) — Task 5.
4. A host without `vt` (herdlingd 0.1.x, or 0.2.0 before this change), or a build without the web
   view: the classic view, with no error — test in Task 6.
5. A tiny font: Fit on a 300-column pane never goes below `FIT_MIN_SIZE` — test in Task 4.

---

### Task 1: Companion raw stream batcher (`core/vt.rs`)

**Interfaces:** `pub const MAX_EVENT: usize = 48 * 1024; pub const MAX_BATCH: usize = 256 * 1024;`
`#[derive(Default)] pub struct Batch` with `pub fn reset(&mut self, gen: u64, cols: u16, rows: u16) -> Vec<Value>`,
`pub fn feed(&mut self, bytes: &[u8]) -> Vec<Value>` (flushes when the batch reaches `MAX_BATCH`),
`pub fn resize(&mut self, cols: u16, rows: u16) -> Vec<Value>` (flush, then the resize event),
`pub fn flush(&mut self) -> Vec<Value>` (events of at most `MAX_EVENT` bytes; nothing when empty).

- [ ] Tests (`companion/tests/core_vt.rs`): reset gives `{vt:"reset", gen, seq:0, cols, rows}`;
  feed then flush gives one `data` with `seq 1` and the base64 of the bytes; 100 KiB gives 3 events
  with seq 1, 2, 3 that join to the input; resize flushes first; a reset drops the old batch and
  starts seq again; empty flush gives nothing; `MAX_BATCH` flushes in `feed`.
- [ ] Implement; tests pass; commit "companion: add the raw terminal stream batcher".

### Task 2: `pane.watch` with `format: "vt"`

- `WatchParams.format: Format` (`Text`, `Ansi`, `Vt`), `ansi` stays for the old paths
  (`format == Ansi`). `Watch` gets `format`. In `run`, with `Vt`: `Reset` → `batch.reset(gen, …)`,
  `Feed` → `batch.feed`, `Resize` → `batch.resize`, `Emit` → `batch.flush`; each event goes out;
  no emulator, no facts. Reply `{stream, format: "vt"}` (+ `drive`). An old core → call error
  `unsupported`. `hello.watch_formats = ["text","ansi","vt"]`.
- [ ] Tests (`core_terminal.rs`): `vt_streams_raw_bytes` (reset with the attach size, then data
  whose decoded bytes equal `PAINT`, then `Ctl::Output` bytes); `vt_is_passive_and_credits`;
  `vt_reattach_resets_with_a_new_gen`; `vt_resize_event`; `vt_drive_mode` (`observe: false`, reply
  `drive` and `format`); `vt_on_old_core_is_unsupported`; `hello_lists_watch_formats` (`rpc_basic`
  or `core_terminal`). `WatchParams::parse` of `vt` and of a bad format (`pane_watch.rs`).
- [ ] Protocol types; commit "companion: stream raw terminal bytes on pane.watch format vt".

### Task 3: Bundled xterm.js page

- `gen-xterm-assets.mjs` exports `buildAssets(root): string` and writes the file when run.
  `page.ts`: `xtermHtml(a: XtermAssets): string`; `PAGE_SCRIPT` (the page code as a string).
- [ ] Tests: `assets.generated.ts` equals `buildAssets()` output; the HTML has the xterm version,
  no `http:`/`https:` URL in `src`/`href`, no `<script src`; `PAGE_SCRIPT` has no `onData`; the
  script parses (`new Function(PAGE_SCRIPT)` compiles).
- [ ] Commit "terminal: bundle xterm.js for an offline terminal page".

### Task 4: Pure bridge, layout, theme and search rules

- `bridge.ts`: `ToWeb`, `FromWeb`, `encodeToWeb`, `parseFromWeb`, `chunkB64(b64, max)`,
  `VtState`, `vtReducer(state, event) → {state, out: ToWeb[], restart: boolean}`,
  `Outbox`, `outboxReducer(box, ev: {type:"send", msg} | {type:"ready"} | {type:"unload"}) → {box, post: string[], restart: boolean}`.
- `layout.ts`: `xtermLayout({mode, width, height, cell: {w, h} per pt, pane?: {cols, rows}, base})
  → {fontSize, drive: {cols, rows} | null}`; `nextXtermMode(mode, phone)`.
- `theme.ts`: `xtermTheme(c)`; `search.ts`: `searchOp(prev, next)`.
- [ ] Tests for each: stale gen, seq gap → restart, epoch per reset, outbox order and overflow,
  base64 chunks on 4-char bounds, Fit clamp (Review Focus 5), phone grid clamp, theme has 16 colors.
- [ ] Commit "terminal: add the pure rules of the xterm bridge".

### Task 5: `useVtStream`, `XtermView`, the renderer choice and Settings

- `renderer.ts`: zustand persist `useTerminalRenderer {renderer: "terminal" | "classic", set}`,
  `chooseRenderer(pref, hello, hasWebView)`.
- `useVtStream(hostId, paneId, enabled, {size?, onDrive?, lines}, onMsg)` →
  `{phase: "connecting" | "live" | "unsupported" | "failed", error?, restart}`.
- `XtermView` props: `hostId, paneId, enabled, mode, size, onDrive, search, onSearchCount,
  onBuffer, onUnsupported, onText, controlsRef` (scroll, page).
- `TerminalView`: when `chooseRenderer` gives "terminal" and no fallback happened, the body is
  `XtermView` and `useTerminalText` is off.
- [ ] Tests: `chooseRenderer` cases; `TerminalView` test: a host with `watch_formats` and a mocked
  web view renders the xterm branch and calls `pane.watch` with `format: "vt"`; with no
  `watch_formats` it uses the classic stream; Settings row toggles the pref.
- [ ] Commit "terminal: show Herdr 2 panes in an xterm.js terminal".

### Task 6: Docs and checks

- `docs/protocol.md` (`format: "vt"`, events, `hello.watch_formats`), `CHANGELOG.md`, `AGENTS.md`
  map (`core/vt.rs`, `terminal/xterm/`), `THIRD_PARTY_NOTICES.md` (xterm.js MIT, addons MIT).
- Privacy scan of the diff. Full checks. Read-only live check: a debug `herdlingd rpc` with
  `hello`, then `pane.watch {format: "vt"}` without `cols`/`rows` on an existing pane for a few
  seconds: `reset` and `data` events arrive; the attach has `observe: true`.
- [ ] Commit "docs: the raw terminal stream and the xterm.js view".
