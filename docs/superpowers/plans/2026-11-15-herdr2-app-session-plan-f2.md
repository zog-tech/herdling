# Herdr 2 session screen and suggested computers (plan F2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** The session screen gets the patterns of a terminal remote (pages for the panes of a tab, a tab map, an in-app banner, a key bar with modifiers, a drag pad, custom keys and text macros, terminal themes), and Add computer suggests more computers from a paired one (`machines.suggest`).

**Architecture:** Each rule is a pure module with tests: `herdr/tabPanes.ts`, `push/banner.ts`, `terminal/keyRules.ts`, `terminal/customKeys.ts`, `hosts/suggest.ts` in the app, and `suggest.rs` in the companion. Thin hooks and components use them. Async flows (the banner queue, the suggestion load) are reducers with effects and generation numbers. The companion method only reads: the core `machine.list`, the Host entries of `~/.ssh/config` and `tailscale status --json`.

**Tech Stack:** Expo SDK 58, React 19.3, TypeScript strict, zustand persist (`secureJSONStorage`), react-native-gesture-handler and reanimated (already in the build). Rust (tokio, serde_json) for `herdlingd`.

**Spec:** The task brief of plan F2 and notes on the public Herdr mobile app page (session screen, "after the first computer connects"). Earlier plans: A (groups), C (actions, `docs/superpowers/plans/2026-11-15-herdr2-actions-plan-c.md`). Parallel: F1 (inbox, spaces tab, search, New session, Move to group: `app/src/board/`, `app/src/newSession/`, `app/src/herdr/backend.ts`, tab layout). Later: D (terminal view in the companion with a column count).

## Global Constraints

- Branch `herdr2-app-session`. Do not push. No OTA, no build, no store action, no `herdlingd install`.
- Do not edit `app/src/board/`, `app/src/newSession/`, `app/src/herdr/backend.ts` or `app/src/app/(tabs)/_layout.tsx` (F1). Importing from them is allowed.
- JS only in the app: no new dependency. Every feature works on iOS and Android, compact and regular width.
- Old `herdlingd`: gate the suggestions on `listsMethod(hello, "machines.suggest")`. Add methods and fields only.
- State machines: a discriminated union and a pure `reducer(state, event) → { state, effects }`; each async attempt has a generation number.
- Tokens only (`app/src/theme/tokens.ts`); gold only for the primary action, working and selected.
- `machines.suggest` returns names, host names, addresses, users and ports only. Never keys, `IdentityFile`, `ProxyCommand` or other file content.
- Companion tests never read the real `~/.ssh/config` or run the real `tailscale`: `Ctx` carries the paths.
- Builds: `nice -n 15 cargo test -j 2`, `nice -n 15 cargo clippy -j 2 --all-targets -- -D warnings`; in `app/`: `pnpm exec tsc --noEmit`, `nice -n 15 pnpm test --maxWorkers=2`. No `cargo fmt` over the crate.
- Test data: `sam`, `studio.local`, `/home/sam/proj`, IP ranges 192.0.2.0/24 and 100.64.0.0/10 (`100.64.0.x`). ASD-STE100 for comments, docs and UI text.
- Commits: `zog-tech`, prefix `thread:`, `terminal:`, `companion:`, `app:`, `docs:`; a blank line, the reason, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions

- **Key names.** Both backends accept `esc`, `tab`, `enter`, `backspace`, the arrows and `ctrl+<letter>` (the app sends them now). The core also accepts `shift+tab`, `alt+x`, `home`, `pageup`, `f5` (`hc schema`, `terminal.keys`; herdr-core `keys.rs`). herdr 1 knows `shift+tab` (the name is in its binary); other names are not known. So:
  - Alt + a character goes as the text `ESC` + character. herdr 1 types it literally; herdlingd turns it into the core keys `esc`, `<char>` (`core/route.rs` `text_keys`). The same bytes reach the program in both cases.
  - Alt + a named key goes as the keys `esc`, `<name>`.
  - Ctrl + a letter goes as `ctrl+<letter>`. Ctrl + a named key goes as `ctrl+<name>`. Ctrl + another character sends the character without Ctrl.
  - Named keys that herdr 1 may not know (`shift+tab`, `home`, `end`, `pageup`, `pagedown`, `delete`, `f1`–`f12`) have an xterm text fallback. A herdr 1 pane that refuses the key name gets the text. A core pane never uses the fallback.
- **Modifiers.** Ctrl and Alt are one-shot: a tap arms the modifier, the next key from the bar or the keyboard uses it, then it turns off. A second tap turns it off. A long press locks it until the next tap. A text macro clears the modifier and is sent as plain text.
- **Drag pad.** One arrow key per 18 pt of drag, on the axis with the larger move since the last key. Haptic tick per key.
- **Key bar pages.** The bar is a horizontal paged scroll view. Page dots show when the content is wider than the view.
- **Custom keys and macros.** Settings, "Key bar": a list (most 16) of items `{ kind: "text", text, enter }` or `{ kind: "key", key }` (keys from a fixed list). Defaults: `/new` + Enter, `yes` + Enter, `1`. Persisted on the phone (keychain, zustand persist), like saved prompts.
- **Terminal themes.** `ThemeChoice` gets an optional `terminal: "app" | "paper"`. `app` keeps the theme's terminal colors. `paper` is a light terminal: `terminal.bg`, `terminal.fg` and `ansi` only. `buildColors` applies it, so the colors stay tokens and a change mounts the screens again. The Theme screen gets a "Terminal" section.
- **Panes of a tab.** `tabPanes(snapshot, paneId)` lists the panes of the tab in snapshot order. With more than one pane, a strip under the header shows page dots; a swipe on the strip or a tap on a dot opens the next, previous or tapped pane; a tab map button opens a sheet with one tile per pane. The snapshot has no pane geometry, so the map is a grid in pane order, not the real layout. The existing swipe on the thread (agents of the workspace) stays.
- **In-app banner.** Two sources: (1) status changes in `useSnapshots` (an agent goes to `blocked`, or from `working` to `idle`/`done`); (2) foreground pushes (`setNotificationHandler`), which also cover shell pushes. A key `hostId:paneId:kind` within 30 s is shown once. The banner respects the "Finished" and "Needs you" push prefs. No banner for the open session (`showBannerFor`). While the banner host is mounted, a foreground push shows the in-app banner, not the system banner. The banner stays 5 s; a tap opens the session (compact: the session route; regular: the detail column); a swipe up or the close button hides it; the next banner in the queue follows.
- **Suggested computers.** `machines.suggest {}` → `{ suggestions: [{ name, address, user?, port?, sources: ("core"|"ssh_config"|"tailscale")[], online? }] }`. Sources:
  - core `machine.list`: `name`; `target` parsed as `[user@]host[:port]`; a `via` target (a command) gives `host` only.
  - `~/.ssh/config` (at most 256 KiB): each `Host` alias without `*`, `?` or `!`; `HostName`, `User`, `Port`. `Match` blocks and `Include` are skipped. An entry with `ProxyJump` or `ProxyCommand` is skipped: the phone cannot use it.
  - `tailscale status --json` (3 s limit; binary from `PATH`, `/usr/local/bin`, `/opt/homebrew/bin`, `/Applications/Tailscale.app/Contents/MacOS/Tailscale`): each peer, `HostName` as the name, the MagicDNS name (no last dot) as the address, else the first IPv4. `Online` passes through.
  - Merge by lower-case address; the first name wins; sources join. The computer itself (its host name) is dropped. A failed source is skipped silently.
- **App side.** Add computer shows "Suggested" when a paired, online host lists the method. The list merges all hosts and drops saved hosts (same address). A tap opens "Set up with password" with name, address, port and user filled in (new optional route params).
- **Plan D hook.** `TerminalView` calls `useTerminalText(hostId, paneId, focused, { format: "ansi" })`. Plan D adds an optional `cols` to that options object (from the view width and the font size of `fit.ts`) and to `pane.read`/`pane.watch` for a core pane. No code for it here; a comment marks the call.

## Review Focus

1. Ctrl armed, then the user types a capital letter or a symbol on the keyboard: a letter sends `ctrl+<lower>`, a symbol goes as plain text, and Ctrl turns off — test in Task 5.
2. A snapshot refetch that brings a status change for the open session, or the first snapshot of a host: no banner — test in Task 8.
3. An `~/.ssh/config` with `Host *`, `Host a b`, comments, `=` separators, upper-case keywords and a `Match` block: only real aliases come back, and no `IdentityFile` value ever shows — test in Task 1.
4. A tab with one pane, or a pane that the snapshot does not hold yet: no dots, no map button — test in Task 7.
5. A herdr 1 pane that refuses `shift+tab`: the fallback text goes once; a network error does not send the fallback — test in Task 5.

---

### Task 1: Companion pure rules for suggestions

**Files:** Create `companion/src/suggest.rs`; modify `companion/src/lib.rs`. Test: `companion/tests/machines_suggest.rs`.

**Interfaces (`herdlingd::suggest`):**
- `#[derive(Serialize, Clone, Debug, PartialEq)] pub struct Suggestion { pub name: String, pub address: String, pub user: Option<String>, pub port: Option<u16>, pub sources: Vec<&'static str>, pub online: Option<bool> }` (serde skips `None`).
- `pub fn from_ssh_config(text: &str) -> Vec<Suggestion>`
- `pub fn from_tailscale(status: &Value) -> Vec<Suggestion>`
- `pub fn from_core(machines: &Value) -> Vec<Suggestion>`
- `pub fn parse_target(target: &str) -> (Option<String>, String, Option<u16>)`
- `pub fn merge(lists: Vec<Vec<Suggestion>>, own_names: &[String]) -> Vec<Suggestion>`

- [x] **Step 1: Failing tests**: `ssh_config_keeps_only_real_aliases` (Review Focus 3; `IdentityFile` text never in the JSON), `ssh_config_skips_proxy_entries`, `tailscale_peers_use_magic_dns`, `tailscale_without_dns_uses_ipv4`, `core_machines_parse_targets` (`sam@studio.local:2222`, a `via` target gives `host`), `merge_joins_sources_and_drops_self`.
- [x] **Step 2: Run** `nice -n 15 cargo test -j 2 --test machines_suggest` — FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** — PASS.
- [x] **Step 5: Commit** — "companion: add pure rules for suggested computers"

### Task 2: `machines.suggest` method

**Files:** Modify `companion/src/rpc.rs` (`Ctx.ssh_config: PathBuf` = `home/.ssh/config`, `Ctx.tailscale: Option<PathBuf>` None in `Ctx::new`, `METHODS`, `dispatch`), `companion/src/main.rs` (finds tailscale), `companion/tests/support/fake_core.rs` (`machine.list`), `protocol/src/index.ts` (`Suggestion`, `MachinesSuggest`), `app/src/hosts/methods.ts`, `app/src/demo/DemoTransport.ts`, `docs/protocol.md`. Test: `companion/tests/machines_suggest.rs`, `app/src/demo/DemoTransport.test.ts`.

- [x] **Step 1: Failing tests**: `suggest_reads_the_given_config_and_tailscale` (a temp home with `.ssh/config`, a fake `tailscale` shell script that prints JSON), `suggest_without_sources_is_empty`, `suggest_adds_core_machines` (fake core). Demo: `machines.suggest` gives two suggestions.
- [x] **Step 2–4:** run, implement, run. The rpc-basic method list test stays green.
- [x] **Step 5: Commit** — "companion: add machines.suggest"

### Task 3: Suggested computers in Add computer

**Files:** Create `app/src/hosts/suggest.ts` (pure: `mergeSuggestions(perHost, hosts) → SuggestedHost[]`, `suggestReducer`), `app/src/hosts/useSuggestions.ts`; modify `app/src/app/hosts/discover.tsx`, `app/src/app/hosts/password.tsx` (params `name`, `address`, `port`, `user`). Test: `app/src/hosts/suggest.test.ts`.

- `type SuggestedHost = Suggestion & { from: string /* host name */ }`
- `suggestReducer(state, event)`: states `idle | loading{gen} | ready{list} | failed{error}`; events `load{gen}`, `loaded{gen, list}`, `failed{gen, error}`; an old `gen` is ignored.

- [x] Tests: `drops_saved_hosts_by_address`, `merges_the_same_address_from_two_hosts`, `old_generation_is_ignored`. Run, implement, run. Commit — "app: suggest more computers in Add computer"

### Task 4: Terminal themes

**Files:** Modify `app/src/theme/palettes.ts` (`TerminalThemeId`, `TERMINAL_THEMES`, `ThemeChoice.terminal?`), `savedChoice.ts` (`parseChoice`), `themePrefs.ts` (`setTerminal`), `app/src/app/theme.tsx` ("Terminal" section), `thread/TerminalView.tsx` (loading text in `terminal.fg`), `design-system/herdling/MASTER.md`. Test: `palettes.test.ts`, `themePrefs.test.ts`.

- [x] Tests: `paper_terminal_passes` (fg on bg ≥ 7; every ANSI entry but white ≥ 4 on the paper bg), `paper_changes_only_the_terminal`, `parse_choice_reads_the_terminal_theme`. Run, implement, run. Commit — "terminal: add a light terminal theme"

### Task 5: Key bar rules and key fallback

**Files:** Create `app/src/terminal/keyBar.ts`; modify `app/src/terminal/keys.ts`. Test: `keyBar.test.ts`, `keys.test.ts`.

**Interfaces:**
- `type Mod = "ctrl" | "alt"`; `type ModState = { mod: null } | { mod: Mod; locked: boolean }`; `modReducer(s, e: { type: "tap" | "hold"; mod: Mod } | { type: "used" }) → ModState`.
- `type BarInput = { kind: "key"; key: string } | { kind: "char"; ch: string } | { kind: "text"; text: string; enter: boolean }`.
- `encode(s: ModState, input: BarInput) → { op: SendOp; state: ModState }`.
- `padStep(acc: { x: number; y: number }, dx: number, dy: number, step?: number) → { acc; keys: string[] }`; `PAD_STEP = 18`.
- `pageCount(content: number, view: number): number`, `pageOf(offset: number, view: number): number`.
- `keys.ts`: `KEY_FALLBACK_TEXT: Record<string, string>`, `sendInputWithFallback(rpc, paneId, op)`.

- [x] Tests: each `modReducer` state and event; `encode` for ctrl+letter, ctrl+capital, ctrl+symbol (Review Focus 1), alt+char, alt+named key, a locked mod stays, a macro clears; `padStep` per axis and the remainder; pages; fallback on `RpcError` refusal, no fallback on network error or core pane (Review Focus 5). Run, implement, run. Commit — "terminal: add key bar rules and key name fallbacks"

### Task 6: Custom keys and the Key bar settings

**Files:** Create `app/src/terminal/customKeys.ts` (store and pure list rules), `app/src/app/key-bar.tsx`; modify `app/src/app/_layout.tsx` (one `Stack.Screen`), `app/src/app/theme.tsx` or Settings (a "Key bar" row). Test: `customKeys.test.ts`.

- `type CustomKey = { kind: "text"; text: string; enter: boolean } | { kind: "key"; key: string }`; `CUSTOM_KEY_CAP = 16`; `DEFAULT_CUSTOM_KEYS`; `addKey`, `editKey`, `removeKey`, `moveKey`, `keyLabel`; `KEY_CHOICES`.
- [x] Tests for each list rule and `keyLabel`. Run, implement, run. Commit — "terminal: add custom keys and text macros"

### Task 7: The key bar component and the pane pager

**Files:** Create `app/src/terminal/KeyBar.tsx` (replaces `KeyRow` in `TerminalControls`), `app/src/herdr/tabPanes.ts`, `app/src/thread/PanePager.tsx`; modify `thread/TerminalView.tsx` (mods with the keyboard, fallback sender), `thread/SessionDetail.tsx`. Test: `tabPanes.test.ts`, `KeyBar.test.tsx`, `TerminalView.test.tsx`.

- `tabPanes(s: Snapshot | undefined, paneId: string) → { tabId: string; panes: TabPane[]; index: number } | null`, `TabPane = { pane_id; title; kind?; status?: AgentStatus; terminal: boolean }`.
- [x] Tests: two panes in order, one pane → null, unknown pane → null (Review Focus 4); KeyBar: Ctrl then "c" from the bar sends `ctrl+c`; TerminalView: Ctrl then a typed "d" sends `ctrl+d` and leaves the box empty. Run, implement, run. Commit — "thread: page through the panes of a tab and add the key bar"

### Task 8: In-app banner

**Files:** Create `app/src/push/banner.ts`, `app/src/push/BannerHost.tsx`; modify `app/src/app/_layout.tsx` (mount, handler). Test: `banner.test.ts`.

- `bannerItems(hostId, hostName, prev?: Snapshot, next: Snapshot) → BannerItem[]`; `BannerItem = { key; hostId; paneId; title; detail; kind: "blocked" | "done" | "shell" }`.
- `bannerReducer(state, event)`: state `{ current?: BannerItem & { gen }; queue; recent: Record<string, number> }`; events `arrive{items, now, allowed(item)}`, `dismiss{gen}`, `timeout{gen}`; effects `{ type: "timer"; gen; ms }`.
- [x] Tests: blocked and finished transitions, first snapshot gives none, open session filtered (Review Focus 2), dedupe within 30 s, stale timeout ignored, queue order. Run, implement, run. Commit — "app: show an in-app banner when another agent needs you"

### Task 10: Herdr 2 on the host screen (after the merge of plan B)

**Files:** Create `app/src/hosts/coreInstall.ts` (pure), `app/src/hosts/CoreCard.tsx`; modify `hosts/HostForm.tsx`, `hosts/UpdateCard.tsx`, `hosts/updates.ts`, `hosts/store.ts` (`UpdateCache.core?`), `hosts/methods.ts` (`core.status`, `core.install`), the demo host. Test: `coreInstall.test.ts`, the demo test.

- The card shows when the host lists `core.status`; the button when it lists `core.install`, the core is not managed and `update_available`. Install: idle → running → done | failed, with a generation; `core.install` with a 3 minute limit; the status loads again after it.
- Before a herdlingd update: `coreUpdateNote(update.check core)` ("installs first" and `notice`) in the card and in the confirmation; `update.apply` `notice` in the result.
- `APP_METHODS` gets both methods: the app calls them. An older herdlingd shows the usual "Update herdlingd" hint and keeps working, because each call is gated on `listsMethod`.
- [x] Tests, implement, commit — "app: show Herdr 2 on the host screen and install it"

### Task 11: "Phone width" (after the merge of plan D)

**Files:** `terminal/fit.ts` (`WidthMode` + `"phone"`, `nextWidthMode(mode, phone)`, `phoneGrid`), `terminal/widthMode.ts` (`phoneNoteSeen`, `markNoDrive`, `canDrive`), `rpc/RpcClient.ts` (`stream` gets an optional `onResult`), `thread/useTerminalText.ts` (`size`, `onDrive`), `thread/TerminalView.tsx`.

- Offered only in the session terminal of a core pane (`hc:`) whose host lists `pane.watch`, after scroll in the cycle. Off by default.
- The grid comes from the view size and the normal font, debounced 400 ms as a `"<cols>x<rows>"` key; a new grid starts a new watch.
- A reply without `drive: true` marks the connection and shows "fit". A one-time note: "The pane on your computer gets the phone's size while you watch it here."
- [x] Tests, implement, commit — "terminal: add a Phone width mode for Herdr 2 panes"

### Task 9: Docs and checks

- [x] `CHANGELOG.md`, `docs/protocol.md` (`machines.suggest`), `AGENTS.md` map (`suggest.rs`, new app modules), `MASTER.md` (terminal themes, key bar, banner).
- [x] Full checks: tsc in `app/` and `protocol/`, Jest, clippy, cargo test.
- [x] Privacy scan of `git diff herdr2-only`.
- [x] Live read-only check: a debug build, `{"id":1,"method":"machines.suggest"}` piped into `herdlingd rpc`; output kept in the scratchpad only.
- [x] Commit — "docs: plan F2 session screen and suggested computers"
