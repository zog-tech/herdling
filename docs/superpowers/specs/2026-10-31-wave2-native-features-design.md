# Wave 2: iPad, fast typing, browser preview, share sheet, Live Activities

Date: 2026-10-31. Status: proposed. Design only. No code is part of this document.

This document designs five features. Each section gives the goal, the user flow, the architecture,
the native and Expo parts, the protocol changes, the security model, the OTA or build decision,
Android, risks, size, tests and a task list. The last section gives the build order.

## 0. Fixed constraints and current state

These rules apply to every feature. They come from `AGENTS.md` and the code.

- The phone connects directly to the user's computers over SSH. There is no Zog Tech server and no relay.
- The phone key line in `authorized_keys` is
  `command="<exe> rpc",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty <key> herdling:<name>`
  (`companion/src/pair.rs`, `KEY_OPTIONS`). No feature in this document weakens these options.
- Pushes go herdlingd → Expo push service → APNs/FCM. herdlingd holds no secret. Expo push tokens are not secrets in this sense, and herdlingd never logs them.
- One persistent SSH connection per host. One exec channel runs `herdlingd rpc` (NDJSON). A ping goes every 15 s (`app/src/hosts/connection.ts`).
- `herdlingd rpc` opens a new herdr unix-socket connection for each `herdr.call` (`companion/src/rpc.rs`, `herdr_call`). This costs less than 1 ms on the computer.
- iOS deployment target 17.0. Expo SDK 58, React Native 0.88, expo-router 58.0.28, react-native-screens 4.30.
- `runtimeVersion.policy` is `appVersion`. Every OTA update goes to every build with the same `version`.
  A JS import of a native module that an old build does not have crashes that build at launch.
  So every new native module in this wave loads through `requireOptionalNativeModule` (the pattern of `app/modules/paste/index.ts`),
  and the JS hides the feature when the module is missing.
- Protocol rules (`docs/protocol.md`): add methods and fields only, check `hello.methods`, add each new method to
  `METHODS`, `APP_METHODS`, `protocol/src/index.ts` and the demo host.

New herdr API facts that this design uses (from `herdr api schema --json`, herdr protocol 22):

| herdr item | What it gives |
|---|---|
| `pane.read` result `revision` (u64) | A number that changes when the screen changes. herdlingd can skip unchanged screens |
| `pane.send_input {pane_id, text?, keys?}` | Text and keys in one call |
| `pane.process_info {pane_id}` | `shell_pid`, `foreground_processes[] {pid, name, argv, cwd}` |
| `pane.output_matched` subscription | An event with a full `read` when a pattern matches. herdr has no raw output stream |
| `pane.read` | Has no cursor position |

---

## 1. iPad layout (and large phones in landscape)

### 1.1 Goal

Herdling runs on iPad as a real iPad app: a board on the left, the selected session on the right,
keyboard shortcuts, pointer hover, and every Stage Manager window size. The same layout shows on
any window that is wide enough, which includes Android tablets, foldables and large phones in landscape.

### 1.2 User flow

1. The user opens Herdling on iPad. The sidebar (iPadOS 18+) or the floating Liquid Glass tab bar (iPadOS 26) shows Overview, Usage, Automations, Settings.
2. Overview shows two columns: the board (about 380 pt) and the session detail.
3. A tap on an agent row selects it. The detail column shows the chat or the terminal. The board stays.
4. With a hardware keyboard, ⌘1–⌘4 change tabs, ⌘[ and ⌘] move to the previous or next agent, ⌘↩ sends the prompt, ⌘. sends Ctrl-C, ⌘T toggles chat and terminal.
5. The user holds ⌘. iPadOS shows the shortcut list. On iPadOS 26, the same commands show in the menu bar.
6. The user makes the window narrow (Stage Manager or Split View). Below the breakpoint, the app changes to the phone layout. The selected session stays open as a pushed screen.

### 1.3 Architecture

**Breakpoint by window width, not by device.** Stage Manager gives arbitrary window sizes. The layout reads
`useWindowDimensions().width`:

| Width | Layout |
|---|---|
| < 700 pt | Phone layout (today) |
| ≥ 700 pt | Two columns: board + detail |

One hook, `useLayoutClass()` in `app/src/ui/layout.ts`, returns `"compact" | "regular"`. Pure function plus a test.

**Two columns in JS, not the native SplitView.** expo-router has `SplitView` (`expo-router/unstable-split-view`).
Its docs say it is "an alpha API available on iOS only", "not ready for production usage", it "must be used at the root layout level"
and "cannot be used inside another navigator (except for Slot)" [E1]. Herdling has `NativeTabs` at the root, and the
board belongs inside the Overview tab. So the native SplitView does not fit now. Decision: build the two columns
as React views inside the Overview tab. Revisit when SplitView is stable and can sit inside a tab.

**Selection lives in the URL.** The Overview route takes search params `?host=<id>&pane=<id>`.
- Regular width: a row tap does `router.setParams({host, pane})`. The detail column renders `<SessionDetail hostId paneId />`.
- Compact width: a row tap pushes `session/[hostId]/[paneId]` (today).
- Width changes from regular to compact with a selection: push the session route. From compact to regular while a session route is on top: pop it and set the params.
- Push routing (`app/src/push/useNotificationRouting.ts`) and deep links use the same rule.

**Refactor the session screen into a component.** `app/src/app/session/[hostId]/[paneId].tsx` (409 lines) becomes a thin route over
`app/src/thread/SessionDetail.tsx`. The component must not depend on route-only hooks:
- `useIsFocused()` gates polling today. In the detail column, "focused" means "Overview tab focused and this pane selected". Pass `active` as a prop.
- Header items (`Stack.Screen options`) move into a `SessionHeader` component that the route puts in the native header, and the column renders as a plain row.

**NativeTabs.** Add `sidebarAdaptable` to `<NativeTabs>` in `app/src/app/(tabs)/_layout.tsx`. The type docs in expo-router 58 say:
"When set to `true`, the tab bar can turn into a sidebar. The sidebar shows only on iPad, and on iOS 27 and later on larger iPhone models in landscape orientation" (`@platform iOS 18+`).
`preferredPlacement` (iOS 27+) can force sidebar or tab bar. UIKit puts the tab bar at the top on iPad and shows the
sidebar on the leading edge; in compact width it shows the regular tab bar [A1]. On iPadOS 26, the system draws the bar (Liquid Glass);
`blurEffect` has no effect there (expo-router type docs).

**Keyboard shortcuts.** React Native has no `UIKeyCommand` API. The libraries found (react-native-key-commands and others) are old and
need AppDelegate edits [W1]. Decision: a small local module `app/modules/keys` (Swift and Kotlin):
- iOS: register `UIKeyCommand`s with `discoverabilityTitle` and send `onKeyCommand {id}` events. The commands must work while a `TextInput` is first responder (⌘↩ in the composer). Spike first: the two candidate hooks are (a) `buildMenu(with:)` with `UIMenuBuilder` on the app delegate (gives the iPadOS 26 menu bar and the ⌘ hold list), (b) key commands on the root view controller through a config plugin. Choose (a) if `ExpoAppDelegate` lets a subscriber or a plugin add `buildMenu`.
- Android: `onKeyDown`/`onKeyShortcut` through an Expo `ReactActivityHandler` or `ReactActivityLifecycleListener`. Verify the hook in expo-modules-core 58 during the spike.
- JS: `useKeyCommand(id, handler, {enabled})`. The module is optional; without it, nothing happens.

Shortcut list (one source in `app/src/ui/shortcuts.ts`):

| Keys | Action |
|---|---|
| ⌘1 … ⌘4 | Tabs |
| ⌘[ / ⌘] | Previous / next agent on the board |
| ⌘↩ | Send the prompt |
| ⌘. | Ctrl-C to the pane |
| ⌘T | Chat or terminal |
| ⌘N | New session |
| ⌘R | Refresh |
| Esc | Esc to the pane (terminal mode only) |

**Hardware keyboard in the terminal.** See feature 2, "direct keys". With a hardware keyboard, the terminal sends keys as the user types.

**Pointer.** `Pressable` has `onHoverIn`/`onHoverOut` on iPadOS. Board rows, chips and buttons get a hover fill
(`state.hoverFill`, a new token in `theme/tokens.ts`). Use the `cursor: "pointer"` style on iOS 17+ where React Native supports it.

**Orientation and multitasking.** `app.json` has `"orientation": "portrait"`. An iPad app that supports multitasking must allow all four orientations.
Set `ios.infoPlist.UISupportedInterfaceOrientations~ipad` to all four. Keep iPhone in portrait for the first release.
Landscape on large iPhones is a second step: set `orientation` to `default`, then test every screen at landscape width. A Pro Max in landscape is
wider than 700 pt, so it gets the two-column layout with no extra code.

**App Store.** With iPad support on, App Store Connect needs "At least one screenshot for iPad 13-inch display" (2064 × 2752 or 2048 × 2732) [A2].
Add iPad screens to `store/` and to the screenshot pipeline. App Review tests the iPad layout, so the iPad layout must be correct before the build goes to review.

### 1.4 Native and Expo parts

| Part | Change |
|---|---|
| `app/app.json` | `ios.supportsTablet: true`; `ios.infoPlist["UISupportedInterfaceOrientations~ipad"]` with four values |
| `app/modules/keys` | New local module (Swift `UIKeyCommand`/`UIMenuBuilder`, Kotlin key events) |
| NativeTabs | `sidebarAdaptable` (JS prop, the native code is in react-native-screens already) |
| No new entitlement, no App Group |

### 1.5 Protocol and herdlingd

None.

### 1.6 Security

No change. The key item is `ThisDeviceOnly`, so an iPad gets its own key and its own pairing, like a second phone. The pairing flow already handles this.

### 1.7 OTA or native build

| Piece | Ships as |
|---|---|
| `supportsTablet`, the iPad orientations | Native build (Info.plist) |
| `keys` module | Native build |
| Two-column layout, `sidebarAdaptable`, hover | OTA, but it shows on iPad only after the build with `supportsTablet` (before that, iPad runs the iPhone app in compatibility mode). On Android tablets it shows at once |

### 1.8 Android

Android 16 (API 36) ignores `screenOrientation` and resizability limits on displays with smallest width ≥ 600 dp [G1].
So on Android tablets the portrait lock is already ignored when the app targets API 36, and the opt-out goes away with API 37.
The width breakpoint gives Android tablets and foldables the two-column layout. Key shortcuts come from the `keys` module.
There is no Android equivalent of the iPad sidebar; the Material bottom bar stays (a navigation rail is a later polish item).

### 1.9 Risks

- The session screen has focus-dependent polling and voice code. A wrong `active` flag means two panes poll or speak. Test with two quick selections.
- `UIKeyCommand` and `TextInput` can fight for the first responder. The spike must prove ⌘↩ works inside the composer.
- Stage Manager can resize the window during a keyboard animation. Test the composer at each size.
- App Review rejects broken iPad layouts (guideline 2.4.1, apps that run on iPad must work there).

### 1.10 Size

M–L: 6–8 days (layout and refactor 3–4, keys module 2, App Store and polish 1–2).

### 1.11 Test plan

- Unit: `useLayoutClass` breakpoints; the selection rule on width change (pure function); the shortcut table maps to actions.
- Component: `SessionDetail` with `active=false` starts no polling (mock `useTerminalText`, `useChoices`).
- Device: iPad simulator 13" and 11", Split View 1/3, 1/2, 2/3, Stage Manager with free resize, portrait and landscape, iPadOS 18 and 26. Magic Keyboard: every shortcut, ⌘ hold list, menu bar on 26. Pointer hover.
- Android tablet emulator (API 36) and a foldable emulator, folded and unfolded.

### 1.12 Tasks

1. Add `useLayoutClass` and its test.
2. Extract `SessionDetail` and `SessionHeader` from the session route. Add the `active` prop. Keep the route behavior the same (tests pass).
3. Add the selection search params to Overview. Render two columns at regular width. Add the width-change rule and its test.
4. Route pushes and deep links through the same rule.
5. Add `sidebarAdaptable` to NativeTabs.
6. Spike the `keys` module (iOS hook choice, Android hook). Then build it with `requireOptionalNativeModule`.
7. Add `useKeyCommand` and the shortcut table. Wire the shortcuts.
8. Add hover fills and the token.
9. Set `supportsTablet` and the iPad orientations. Prebuild and run on the iPad simulator.
10. Make iPad 13" screenshots. Update `store/`.

---

## 2. Faster typing over cellular

### 2.1 What is slow today (measured from the code)

- The terminal input is a local `TextInput` (`app/src/thread/TerminalView.tsx`, `TerminalControls`). Typing in the box has no network delay.
- **Send** (`sendLine` in `app/src/terminal/keys.ts`) does two sequential RPCs: `pane.send_text`, then `pane.send_keys ["enter"]`. Then `onSent` calls `refresh()`, a third RPC (`pane.read`). So a line costs 3 round trips before the output can show.
- **Output** comes from polling: `useTerminalText` calls `pane.read` (200 lines) every 1 s. New output shows up to 1 s + 1 RTT late. Each poll sends the full 200 lines even when nothing changed (the app compares strings after the transfer).
- **Key row** buttons (`sendKey`) cost 1 RTT each, then a refresh.
- **Chat** already shows the user bubble at once (`app/src/thread/pending.ts`) and sends one `agent.prompt`. It follows the log with the `thread.follow` stream. Chat is not the problem.
- On cellular, RTT is 60–200 ms, and higher on a weak signal. So "type a command and see the result" costs about 0.4–1.6 s today.
- The SSH connection and the rpc channel are already warm. "Keep one warm channel" gives nothing new.

### 2.2 Goal

1. Output shows within one half RTT plus 100 ms after the computer prints it.
2. A sent line costs one RPC.
3. The user sees the sent text at once, before the computer confirms it.
4. With a hardware keyboard (iPad), the terminal works key by key, with mosh-style prediction.
5. The user can see the current latency.

### 2.3 Options considered

| Option | Result | Decision |
|---|---|---|
| Combine text and Enter in `pane.send_input` | 3 RTT → 1 RTT per line | Yes |
| Pipeline sends (do not await between keys) | Key row taps no longer wait for each other | Yes, with an ordered queue per pane |
| Streaming screen RPC (`pane.watch`) in herdlingd | Replaces 1 s polling; output pushed when the `revision` changes | Yes |
| Local echo of the sent line | Instant feedback | Yes |
| Full mosh prediction (cell-level, cursor-aware) | Needs the cursor position; `pane.read` has none | Partial: "direct keys" mode with an end-of-line heuristic; ask herdr for the cursor |
| A second SSH channel per pane | No gain: SSH multiplexes channels on one TCP connection, and head-of-line blocking stays | No |
| Mosh/UDP transport | Needs a UDP port and a server process outside the forced command | No |

### 2.4 Chosen design

**A. `pane.watch` stream (herdlingd).** New streamed method:

```json
{"id": 7, "method": "pane.watch", "params": {"pane_id": "w1:p2", "lines": 200, "format": "ansi", "interval_ms": 80}}
→ {"id": 7, "result": {"stream": "s9"}}
→ {"method": "event", "params": {"stream": "s9", "data": {"revision": 4182, "text": "...", "truncated": false}}}
```

- herdlingd keeps one herdr connection open and calls `pane.read` every `interval_ms` (clamped to 50–1000, default 80). It sends an event only when `revision` changes. The unix socket call is cheap; the network carries only changes.
- The first event is sent at once (the current screen).
- Rate cap: at most 20 events per second per stream. A burst (a build log) sends the latest screen, not every screen.
- Optional later field `"diff": true`: the event carries `{"base": <rev>, "ops": [...]}` line operations. Start without it; measure the bytes first.
- The app cancels with `rpc.cancel` when the view is not active (the same gates as today: focused, mounted, app active).
- Fallback: when `hello.methods` has no `pane.watch`, the app polls as today.

**B. One RPC per line.** `sendLine` uses `herdr.call` `pane.send_input {pane_id, text, keys: ["enter"]}` when herdr supports it.
Task 1 checks the order in herdr (text first, then keys). If herdr rejects the call (`unknown method` or bad params), fall back to the two calls and remember the result per host.

**C. Ordered send queue per pane.** `app/src/terminal/sendQueue.ts`: every key and line goes into a FIFO. The queue sends without waiting for the previous reply (RpcClient already matches ids), but it keeps the order. An error stops the queue, shows the error, and drops the rest of the queue (so a later Enter does not run a half-typed command).

**D. Local echo of the sent line.** After Send, the terminal shows the sent text dimmed at the end of the last non-empty line, until a `pane.watch` event with a newer `revision` contains the text, or 2 s pass. Pure function `overlayEcho(lines, pending)` with tests.

**E. Direct keys mode (hardware keyboard, opt-in on touch).** A toggle in the terminal header: "Type directly".
- Each keystroke goes into the send queue at once. Printable characters in one 16 ms window are coalesced into one `pane.send_input {text}`.
- Prediction follows mosh [M1][M2]: show predictions only when the smoothed RTT is above 30 ms (mosh `SRTT_TRIGGER_HIGH = 30`, clears at 20 ms); underline unconfirmed predictions when the RTT is above 80 ms (mosh `FLAG_TRIGGER_HIGH = 80`, clears at 50 ms). Mosh reports a median keystroke response under 5 ms against 503 ms for SSH on 3G [M1].
- Herdling cannot place predictions as precisely as mosh, because `pane.read` has no cursor. Heuristic: a printable key appends to the end of the last non-empty line; Backspace removes the last predicted character only. Enter, arrows, Tab, Ctrl keys and Esc end the prediction "epoch": all predictions clear and the next snapshot is the truth.
- Confirmation: each `pane.watch` snapshot clears the predicted characters that now appear at the end of that line. A prediction older than 1 s without confirmation clears, and prediction turns off until 10 good confirmations (mosh "glitch" rule, simplified).
- Upstream: open a herdr issue to add `cursor {row, col}` to `pane.read`. With it, prediction becomes cell-accurate, and the heuristic goes away.

**F. Latency display.** `RpcClient` records the RTT of each `ping` and of each small call. `HostConn` gets `srttMs` (EWMA, α = 1/8). The terminal header shows a small mono badge ("84 ms"). It turns `status.blocked` color above 300 ms. The connection badge in host screens shows it too.

**G. Faster recovery on a network change.** iOS: `NWPathMonitor` in the ssh module sends `onPathChange`. On a path change (Wi-Fi ↔ cellular), the app pings at once with a 2 s timeout and reconnects when it fails, instead of waiting for the next 15 s ping. Android: `ConnectivityManager.NetworkCallback`. This is a native change; it can ship in the wave 2 build. The JS reacts only when the event exists.

### 2.5 Native and Expo parts

None for A–F. G adds one event to the ssh module (native build, optional).

### 2.6 Protocol and herdlingd

- New method `pane.watch` (streamed). `companion/src/rpc.rs`: dispatch, `METHODS`; `docs/protocol.md`; `protocol/src/index.ts` (`PaneWatchEvent`); `APP_METHODS`; demo host answers with a scripted screen.
- `pane.send_input` goes through the existing `herdr.call`. `phone_input::input_pane` must also mark `pane.send_input` as phone input (today it knows `send_text`/`send_keys`; check and extend).
- No other change.

### 2.7 Security

No new capability. `pane.watch` reads what `pane.read` reads today. Rate caps protect the phone's data plan and the computer.

### 2.8 OTA or native build

OTA for the app (A–F) plus a herdlingd release for `pane.watch`. G needs a native build.

### 2.9 Android

Same JS. Hardware keyboards on Android tablets use direct keys mode through the `keys` module (feature 1) or the `TextInput` key events.

### 2.10 Risks

- A pane with a fast-changing screen (a spinner) makes `pane.watch` send 20 events per second. Mitigation: the rate cap; later the diff mode; the app parses only the latest event per frame.
- Wrong predictions in full-screen programs (vim, TUI agents). Mitigation: no prediction when the last line does not look like a prompt line? Too fragile; instead, prediction is off by default on touch, and the epoch rule clears it on every non-printable key.
- `pane.send_input` semantics may differ from `send_text` + `send_keys` (for example bracketed paste). Task 1 verifies it against a real herdr.

### 2.11 Size

M: 4–6 days (herdlingd 1.5, app 3, tests and tuning 1).

### 2.12 Test plan

- Rust: `pane.watch` sends the first screen, skips equal revisions, respects the rate cap, ends on `rpc.cancel` and on a herdr close. Use the existing fake herdr socket in `companion/tests/`.
- Jest: send queue order and error stop; `overlayEcho`; prediction state machine (append, backspace, epoch end, confirm, glitch timeout); SRTT EWMA; fallback to polling without `pane.watch`.
- Manual: Network Link Conditioner "3G" and "Very Bad Network" on iOS, Android emulator network throttle. Measure "Enter to first output" before and after. Target: below 1.5 × RTT + 100 ms.

### 2.13 Tasks

1. Verify `pane.send_input` with text and keys on herdr (order, Enter handling). Record the result in `docs/protocol.md`.
2. herdlingd: `pane.watch` with the revision check and the rate cap. Tests. Docs.
3. herdlingd: mark `pane.send_input` as phone input.
4. App: `useTerminalText` uses `pane.watch` when available.
5. App: send queue; `sendLine` and `sendKey` use it and `pane.send_input`.
6. App: `overlayEcho` for the sent line.
7. App: SRTT in `RpcClient`/`HostConn`; latency badge.
8. App: direct keys mode with the prediction state machine.
9. Demo host: `pane.watch` answer.
10. Open the herdr issue for the cursor position.
11. (Native build) ssh module `onPathChange`; quick reconnect.

---

## 3. Browser preview through port forwarding

### 3.1 Goal

The user opens an agent's dev server (for example `localhost:5173` on the computer) in the app. Hot reload (HMR) works.
Only ports on the computer's own loopback, only when the user asks, only one port at a time.

### 3.2 User flow

1. In a session, the header menu shows "Preview" with a badge when the computer has a listening dev port.
2. The sheet lists ports: "5173 · vite · this pane", "3000 · next-server", "8080 · python".
3. The user taps a port. A browser screen opens with a toolbar: back, reload, address (`localhost:5173/...`), close.
4. The page loads. File saves on the computer reload the page through HMR.
5. The user closes the screen or leaves the app. The tunnel closes.

### 3.3 Options considered

| Option | Verdict |
|---|---|
| SSH local forwarding (`direct-tcpip` channels) | Blocked by `no-port-forwarding` ("Forbids TCP forwarding when this key is used for authentication") [O1]. A forced command alone does not stop forwarding [O1], so the option must stay. Rejected |
| Per-port `permitopen="localhost:<port>"` | `permitopen` only narrows `-L` forwarding; it needs forwarding on. herdlingd would rewrite `authorized_keys` for each port, and removing `no-port-forwarding` also opens remote forwarding unless `permitlisten` is set too. It weakens the key line, which `AGENTS.md` forbids. Rejected |
| HTTP proxy as JSON RPC over the rpc channel + `WKURLSchemeHandler` custom scheme | No WebSocket through a scheme handler, so no HMR; a custom scheme breaks the page origin (`location.host`), cookies and absolute URLs; base64 bodies in NDJSON add 33 % and block the rpc channel during big downloads. Rejected (it stays a possible fallback for static pages) |
| **Raw TCP pipe over a separate exec channel + a loopback proxy in the app** | Works with the forced command, keeps every key option, carries HTTP/1.1 and WebSocket bytes as they are. Chosen |

### 3.4 Chosen architecture

```
WebView ──http://localhost:5173──▶ app loopback listener (127.0.0.1:5173 on the phone)
   each accepted TCP connection ──▶ new SSH exec channel on the existing connection
        sshd forced command "<exe> rpc", SSH_ORIGINAL_COMMAND="herdlingd proxy 5173 <grant>"
        herdlingd: check grant ──▶ TCP connect 127.0.0.1:5173 (then ::1) ──▶ copy bytes both ways
```

**The forced command still runs `herdlingd rpc`.** sshd sets `SSH_ORIGINAL_COMMAND` to the command the client asked for.
`herdlingd rpc` reads it at start:
- Absent, or `herdlingd rpc`, or any other text: the normal RPC loop (today's behavior).
- Exactly `<anything>herdlingd proxy <port> <grant>` (strict parse: port 1–65535, grant 32 hex characters): proxy mode.
- herdlingd never passes `SSH_ORIGINAL_COMMAND` to a shell.

A host added by hand without a forced command runs the client command in the user's shell. So the app sends the host's
`command` with the trailing `rpc` replaced by `proxy <port> <grant>`, and herdlingd gets a real `proxy` subcommand too. Both paths end in the same code.

**Grants (`preview.open`).** The proxy process is a new process, so it cannot see the memory of the rpc process. The grant goes through a file:
- `preview.open {port}` (on the rpc channel): herdlingd checks that a process of the same user listens on that port on loopback or on the wildcard address. It writes `{grant, port, expires}` to `~/.local/state/herdling/preview-grants.json` (mode 0600, atomic rename) and returns `{grant, expires_at}`. TTL 30 minutes; each proxy connection extends it.
- `preview.close {grant}` removes it. Expired grants are dropped on each write.
- The proxy mode accepts a connection only for a live grant with the same port.

**Port discovery (`ports.list`).**

```json
{"method": "ports.list", "params": {"pane_id": "w1:p2"}}
→ {"ports": [{"port": 5173, "addr": "::1", "pid": 4411, "process": "node", "cmd": "vite", "pane_id": "w1:p2"},
             {"port": 3000, "addr": "127.0.0.1", "pid": 3900, "process": "node", "cmd": "next-server"}]}
```

- Pane attribution: `pane.process_info` gives `shell_pid`; herdlingd walks the process tree (macOS `ps -axo pid,ppid,comm`, Linux `/proc/*/stat`) and marks ports whose PID descends from the pane shell.
- Listening sockets of the user: macOS `lsof -nP -iTCP -sTCP:LISTEN -a -u <uid> -F pcn`; Linux `/proc/net/tcp` and `/proc/net/tcp6` (state `0A`), socket inode → PID through `/proc/<pid>/fd`. No root.
- Only loopback (`127.0.0.0/8`, `::1`) and wildcard (`0.0.0.0`, `::`) listeners. herdlingd's own pairing port (7790) is never listed or granted.
- Ports of the pane come first. All other user ports follow, so a dev server started in another pane also shows.

**App side (native, no JS in the data path).** New functions in the ssh module:
- `startPreview(hostId, port, proxyCommand, cookie) → {localPort}`. iOS: `NWListener` bound to `127.0.0.1`, first on the same port number (so the origin is `http://localhost:5173`, the same as on the desk), else a random port. Android: `ServerSocket(port, 50, InetAddress.getByName("127.0.0.1"))`.
- For each accepted connection, open an exec channel with `proxyCommand` on the existing SSH client and copy raw bytes both ways. iOS: Citadel `withExec` with `ByteBuffer`s (no UTF-8 decode; the current `Utf8Carry` path is only for the rpc channel). Android: sshj `Session.exec`, two copy threads [J1].
- `stopPreview(localPort)`. The app stops the preview on screen close and on app background.
- Limit: at most 6 proxy channels at once per host; extra connections wait in a queue. OpenSSH `MaxSessions` (default 10) counts exec sessions per connection, and the rpc channel uses one. If the limit is hit (channel open fails), the native layer opens a second SSH connection for preview only.

**Local access gate.** Any app on the phone can connect to a loopback port while Herdling runs (on Android this is a real risk). The native proxy reads the HTTP request head of each new connection (up to 16 KiB) and requires the cookie `herdling_preview=<random 128-bit>`. The app sets this cookie for `localhost` in the WebView cookie store before the first load (iOS `WKHTTPCookieStore`, Android `CookieManager`). A connection without the cookie gets `403` and closes. WebSocket upgrade requests carry cookies, so HMR passes. The head is forwarded as is (the dev server ignores the extra cookie).

**WebView.** Add `react-native-webview` (new native dependency). Route `app/src/app/preview/[hostId]/[port].tsx`. Toolbar: back, forward, reload, address, close, "copy URL". ATS already allows `NSAllowsLocalNetworking`; Android already has `usesCleartextTraffic`.

**Dev server compatibility.**
- Vite HMR connects to `location.host`, so it reaches the proxy. A project that sets a fixed `server.hmr.host` or `clientPort` breaks; the screen shows a hint.
- The Host header is `localhost:<port>` when the same port number was free. Vite (`server.allowedHosts`) and webpack-dev-server allow `localhost` by default. With a random local port, the Host is `localhost:<random>`; most dev servers accept any port on `localhost`.
- A server that binds only `::1` (Node 17+ resolves `localhost` to `::1` on some systems): herdlingd tries `127.0.0.1`, then `::1`.

### 3.5 Native and Expo parts

| Part | Change |
|---|---|
| `react-native-webview` | New dependency (native build) |
| ssh module | `startPreview`, `stopPreview`, raw byte exec channels, cookie gate (Swift + Kotlin) |
| No entitlement, no App Group | Loopback needs no Local Network permission |

### 3.6 Protocol and herdlingd

- New methods: `ports.list`, `preview.open`, `preview.close`. New error codes: `port_not_listening`, `grant_invalid`.
- New proxy mode through `SSH_ORIGINAL_COMMAND` and a `proxy` subcommand. Documented in `docs/protocol.md` under "Transport" as a second channel type.
- Old herdlingd ignores `SSH_ORIGINAL_COMMAND` and would start the RPC loop on the proxy channel. The app uses preview only when `hello.methods` has `preview.open`.

### 3.7 Security model

- The phone key can already type into any pane (`pane.send_text`), which is shell access as the user. Preview does not add power the key does not have; it adds a narrower, safer path for one use.
- `authorized_keys` options do not change. No SSH forwarding is enabled.
- herdlingd connects only to `127.0.0.1` or `::1`, only to a port that a process of the same user listens on, only with a live grant from `preview.open`. It never connects to another host, so the phone cannot use the computer to reach the user's LAN.
- Grants are user-initiated (a tap), per port, with a TTL, in a 0600 file.
- On the phone, the listener binds `127.0.0.1` only, runs only while the preview screen is open, and requires the per-session cookie.

### 3.8 OTA or native build

Native build (WebView, ssh module functions). herdlingd release for the methods and proxy mode. The port list UI can ship OTA after the build.

### 3.9 Android

Same design: sshj exec sessions, `ServerSocket` on `127.0.0.1`, `CookieManager`, react-native-webview. Android localhost is shared by all apps, so the cookie gate is required, not optional.

### 3.10 Risks

- `MaxSessions` on the computer may be lower than 10 (hardened sshd). Mitigation: the second connection; a clear error.
- Each new TCP connection costs one RTT for the channel open. A page with many parallel requests loads slower over cellular than on the desk. Keep-alive in the WebView reuses connections.
- Large downloads share the TCP connection with the rpc channel (head-of-line blocking). Mitigation: preview on its own SSH connection by default if tests show RPC stalls.
- A dev server that checks `Origin` strictly, or uses OAuth callbacks to another port, may fail. Document it.
- `lsof` is slow on some Macs (1–2 s). Cache the result for 5 s.

### 3.11 Size

L: 8–10 days (herdlingd 3, iOS native 2.5, Android native 2, UI 1.5, tests 1).

### 3.12 Test plan

- Rust: `SSH_ORIGINAL_COMMAND` parse (valid, extra spaces, bad port, bad grant, injection attempts like `;`, `$( )`); grant file write, expiry, port check; port discovery parsers with fixture output of `lsof` and `/proc/net/tcp6`; proxy byte copy with a local echo server; refusal for a non-loopback address and for port 7790.
- Native unit (XCTest / JUnit where possible): cookie gate accepts and rejects; the channel limit queue.
- Integration: Vite + React app with HMR on macOS and Linux; Next.js dev; a WebSocket echo server; a server bound only to `::1`.
- Manual: cellular, app background during load (preview stops cleanly), two previews on two hosts.

### 3.13 Tasks

1. herdlingd: `ports.list` (macOS and Linux parsers, process tree, pane attribution). Tests with fixtures.
2. herdlingd: grants file and `preview.open`/`preview.close`.
3. herdlingd: proxy mode (`SSH_ORIGINAL_COMMAND` and `proxy` subcommand), loopback connect, byte copy. Tests.
4. Docs and types; `APP_METHODS`; demo host answers (the demo preview shows a static local page).
5. iOS ssh module: raw exec channels, `NWListener`, cookie gate, channel limit, second connection fallback.
6. Android ssh module: the same with sshj.
7. Add `react-native-webview`. Preview route and toolbar.
8. Port sheet in the session header; badge when ports exist.
9. Stop on background and on close.

---

## 4. Share sheet extension

### 4.1 Goal

From any app, the user shares a link, text, image or file to an agent: "Send to agent". The content arrives as a prompt
(text and URLs inline, files uploaded with `files.put`, their paths at the end of the prompt, the same as photo attachments today).

### 4.2 User flow (iOS)

1. In Safari, Photos or Files, the user taps Share → Herdling.
2. A sheet shows recent agents (cached list), each with host, name and state. A text field: "Add a note".
3. The user picks an agent and taps Send.
4. A progress line shows uploads. On success the sheet closes with a haptic tick.
5. On failure (host offline, timeout), the sheet says "Saved. Herdling sends it when the host is online." and closes. The main app sends it later and posts a notification with the result.

### 4.3 Options considered (iOS)

| Option | Verdict |
|---|---|
| `expo-share-intent` (SDK 58 supported, v9) [S1] | Its iOS part hands the payload to the main app through the URL scheme. Opening the containing app from a share extension has no public API (only `NSExtensionContext.open` for widgets); such tricks risk review. It also brings React Native into the flow for no gain on iOS. Use it for Android only (`disableIOS: true`) |
| `expo-share-extension` [S2] | Runs a separate React Native bundle inside the extension. Its README lists SDK 54 as the newest. RN in an extension costs memory and start time; our SSH stack is native anyway. Rejected |
| **Native SwiftUI share extension with SSH inside it** | Small memory, fast start, no hand-off. Chosen |

Memory: app extensions get much less memory than apps; developers report about 120 MB before jetsam, and a 48 MP photo decodes to about 185 MB [S3]. Apple does not publish the number. Citadel (SwiftNIO) needs a few MB. So SSH inside the extension fits, if files are streamed and never decoded as images.

### 4.4 Architecture (iOS)

**Target.** `@bacons/apple-targets` (Expo config plugin, supports `share` targets, writes entitlements, mirrors App Groups from `app.json`) [S4].
`app/targets/share/` with `expo-target.config.js`, `ShareViewController.swift` (SwiftUI host), `Info.plist` activation rules
(`NSExtensionActivationSupportsWebURLWithMaxCount 1`, `…Text`, `…ImageWithMaxCount 5`, `…FileWithMaxCount 5`).

**Shared Swift code.** Move the reusable parts of `app/modules/ssh/ios` into a shared source folder linked into both the app module and the extension:
`Keys.swift` (read only in the extension), a new `HostManifest.swift`, a new `QuickRPC.swift` (connect with a pinned fingerprint, open the rpc exec channel, send N requests, read replies, close).
Citadel must link into the extension target. Spike: add the SPM package to the extension target through the plugin's target config. If that fails, build a small local Swift package `HerdlingCore` that both targets depend on.

**Key sharing without changing the default Keychain group.** Today the key item has no access group, so it is in the app's default group (`<team>.com.zogtech.herdling`), which an extension with another bundle ID cannot read.
Apple: an app group name can be used as a Keychain access group, and "An app group can't ever be the default" group [A3]. So:
- Add the App Group `group.com.zogtech.herdling` to the app and the extension (`ios.entitlements["com.apple.security.application-groups"]`).
- Migration in `Keys.swift`, once: read the key from any group; if it is not in `group.com.zogtech.herdling`, add a copy with `kSecAttrAccessGroup = group.com.zogtech.herdling` and the same `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`; read it back and compare bytes; only then delete the old item. The raw key bytes do not change, so the public key and every pairing stay valid.
- Reads afterwards name the group explicitly.
- No `keychain-access-groups` entitlement is added. That entitlement would change the default group for every new item, including expo-secure-store items.

**Host manifest.** The extension needs host address, port, user and the pinned fingerprint. The main app writes them, on every change of the host store, through a new ssh module function `setQuickHosts(json)`. The native side stores the JSON as a Keychain item in the App Group access group (it is connection metadata, but it names the user's computers, so it does not go into plain files). Demo hosts are left out.

**Agent cache.** The main app writes a small `agents.json` to the App Group container (`FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`) after each snapshot: host id, pane id, display name, agent kind, state, last seen. No screen text, no prompts. The extension shows it at once and refreshes it live with `QuickRPC` (`herdr.call workspace/pane list`, the same calls as `useHostSnapshot`) for hosts that answer within 3 s.

**Send.** For the chosen agent:
1. For each file or image: stream it from its file URL; encode base64 in 48 KiB blocks; write the `files.put` JSON line to the channel in pieces, so the whole line is never in memory. Size limit per file 24 MiB (the request line limit is 34 MiB). Images are sent as the original file (no decode). An option "Reduce size" uses ImageIO thumbnail downsampling (`CGImageSourceCreateThumbnailAtIndex`, 2048 px), which does not decode the full bitmap.
2. `herdr.call agent.prompt {target, text}` with: the note, then the URL or text, then one uploaded path per line (the format that `pending.ts` already recognizes for uploads).

**Outbox.** On failure, the extension writes the payload (files copied into the container) to `outbox/<uuid>/` in the App Group and schedules a local notification "Herdling will send this when <host> is online." The main app drains the outbox on launch and when the host comes online, then removes the folder and posts the result. Items older than 24 hours are dropped with a notification.

### 4.5 Android

- `expo-share-intent` with `disableIOS: true` adds intent filters (`ACTION_SEND`, `ACTION_SEND_MULTIPLE`) for `text/*`, `image/*`, `application/pdf` and `*/*` on the main activity [S1][G2].
- The main app opens a `share` route (the full app runs; no extension limits). The route reads `EXTRA_TEXT` and `EXTRA_STREAM` URIs, copies streams to the cache at once (the URI read grant ends with the activity), and shows the same agent picker. Sending uses the existing JS `RpcClient` and `files.put`.
- Later: Direct Share targets per agent [G2].

### 4.6 Protocol and herdlingd

None. `files.put` and `agent.prompt` exist. If streaming many large files is slow, a later `files.put_chunk` can come; not in this wave.

### 4.7 Security model

- The private key stays in the Keychain, readable only by Zog Tech-signed targets in the App Group. It never goes to a file.
- The extension uses the same pinned fingerprint as the app; a host key mismatch stops the send.
- The host manifest is in the Keychain. The agent cache holds names and states only.
- Nothing leaves the phone except to the user's own computers over SSH.

### 4.8 OTA or native build

Native build: new extension target, new App Group capability on the App ID and in the provisioning profiles (EAS must manage the extension's bundle ID `com.zogtech.herdling.share`; check that EAS credentials create the profile with the App Group). Android intent filters: native build too.

### 4.9 Risks

- **Key migration is the highest risk in this wave.** A bug can lose the key, and every pairing breaks. Mitigation: copy, verify, then delete; never delete when the copy fails; unit tests with a Keychain test harness; a TestFlight round with existing installs before release.
- Linking Citadel into the extension through the plugin (spike).
- Memory with large files (stream; test a 24 MiB PDF and a 48 MP HEIC).
- The share sheet shows no agents when the main app never ran after the update (no cache, no manifest). Message: "Open Herdling once to set up sharing."

### 4.10 Size

L: iOS 6–8 days, Android 2–3 days.

### 4.11 Test plan

- Swift unit: key migration (no item, item in default group, item already in app group, copy failure); manifest round trip; base64 chunk writer produces the same line as a one-shot encoder; outbox write and drain.
- Jest: Android share route parsing; prompt text format; outbox drain logic in JS.
- Device: share from Safari (URL), Notes (text), Photos (1 and 5 images, HEIC 48 MP), Files (PDF 24 MiB); host offline → outbox → online → sent; host key changed → refused. Instruments memory trace of the extension: peak below 60 MB.
- Upgrade test: install the current App Store build, pair, update to the new build, verify every host still connects and sharing works.

### 4.12 Tasks

1. Spike: apple-targets share target with Citadel linked; print a `hello` from the extension.
2. Add the App Group to `app.json`. Configure EAS credentials for the extension.
3. Key migration in `Keys.swift` with tests. Explicit group on reads.
4. `setQuickHosts` and the manifest item. JS calls it on host store changes.
5. Agent cache writer in JS (through a native `writeShared(name, json)`).
6. Shared `QuickRPC` code.
7. Share extension UI (SwiftUI): agent list, note, progress, errors.
8. Streaming `files.put` writer; `agent.prompt`.
9. Outbox in the extension and drain in the app.
10. Android: `expo-share-intent` (`disableIOS`), share route, picker, send.

---

## 5. Live Activities, Dynamic Island, Apple Watch approvals

### 5.1 Goal

The user sees "agent working → needs you" without opening the app, and answers a "needs you" choice
(for example "Yes" / "No" of a Claude Code permission menu) from the Lock Screen, the notification, or the Apple Watch.

### 5.2 Findings

**(a) Local updates while the app holds SSH in the background.** Apple: "You can update or end a Live Activity from your app while it runs in the background — for example, by using BackgroundTasks" [A4].
But Herdling has no background mode that keeps it running: no audio, location or VoIP use fits, and App Review rejects such misuse.
After the app goes to the background, iOS suspends it within seconds (about 30 s with a background task). The SSH connection stops.
So the app cannot keep a Live Activity in sync from SSH while in the background. **Not feasible as a live tracker.**

**(b) Expo push service and Live Activity tokens.** The Expo push API message fields are `to`, `title`, `body`, `data`, `sound`, `badge`, `ttl`, `priority`, `interruptionLevel`, `categoryId`, `mutableContent`, `contentAvailable`, `collapseId`, `threadId` and others; none sets `apns-push-type: liveactivity` or a Live Activity topic [E2].
Expo's own Live Activity material (expo-widgets docs and the 2026-10-01 blog post) sends updates directly to APNs with a JWT signed by your own `.p8` key [E3][E4].
Apple requires `apns-push-type: liveactivity` and `apns-topic: <bundleID>.push-type.liveactivity` over a token-based connection [A5].
I found no Expo statement of support as of 2026-10-31. So herdlingd cannot send Live Activity pushes without a key, and a key cannot ship in herdlingd.
A "bring your own key" option does not work either: the APNs topic is the Herdling bundle ID, which only the Zog Tech team can sign for. **Not feasible without a server.**

**(c) Push-to-start (iOS 17.2+).** Same transport as (b): APNs `liveactivity` push with a key [A5]. **Not feasible.**

**(d) Interactive buttons through App Intents.** A Live Activity button takes an App Intent. "If you adopt the `LiveActivityIntent` … protocol, the system runs the app intent in the app's process" [A6].
So `perform()` runs our code in the app process in the background, and that code can connect over SSH with Citadel. It does not need to open the app.
On a locked device "buttons and toggles are inactive … unless a person authenticates and unlocks their device" [A6]. The key is `AfterFirstUnlockThisDeviceOnly`, so it is readable then.
**Feasible**, but only useful when the Live Activity shows current state (see (a)–(c)).

**(e) Apple Watch.** Live Activities appear on a paired Apple Watch [A4]. Actionable notifications also show on the Watch; tapping an action "sends the selected action to the app, which then processes the action in the background" [A7]. On Series 9 and Ultra 2, Double Tap runs the first nondestructive action [A7].
A watch app is not needed for approvals. **Actionable notifications give Watch approvals with no watch target.**

**Extra paths checked:**
- Background pushes (`contentAvailable` through Expo) wake the app for 30 s, and the app could update the Live Activity from the push data. Apple: delivery is not guaranteed, "don't try to send more than two or three per hour", and a force-quit app gets none [A8]. Usable only as a best effort.
- A Notification Service Extension runs for each visible push with `mutableContent`. Apple documents Live Activity updates from "your app" or ActivityKit pushes only [A4]; I found no source that ActivityKit works in a service extension. Treat as unverified; a spike can test it.

### 5.3 Decision: stage the work

**Stage 1 — actionable "needs you" notifications (the main win).** Yes/No buttons on the push, on iPhone, Lock Screen and Watch; Android notification actions.

**Stage 2 — Live Activity, best effort, only after a spike passes.** A Lock Screen and Dynamic Island card for agents the user follows, with a live elapsed timer that needs no updates (`Text(timerInterval:)`), a `staleDate`, and an Approve button (`LiveActivityIntent`). It updates while the app runs, and on background pushes when iOS delivers them. It must never be the only signal: the regular push stays.

### 5.4 Stage 1 design

**herdlingd (`serve`).** When a pane changes to "needs you" (today's `Notice::NeedsYou`):
1. Read the visible screen (`pane.read`, source visible) and parse the choices with a Rust port of `parseChoices` (`app/src/thread/choices.ts`; same rules: last block of `1.`…`n.`, n ≥ 2, one selection marker).
2. If the menu has a first option that starts with "Yes" and a last option that starts with "No", add to the push:
   `categoryId: "herdling_choice"` and `data.choice = {yes: {key: "1", label: "Yes"}, no: {key: "3", label: "No, and tell Claude…"}, revision: <pane.read revision>}`.
   Labels are cut to 60 characters. The question text is not sent (data minimization: the payload passes Expo and Apple/Google).
3. Only devices that registered `capabilities: ["choice_actions"]` in `push.register` get the category. (iOS shows no buttons for an unknown category anyway, but Android behavior differs; the flag keeps old apps clean.)

**New RPC `pane.answer` (herdlingd).** All checks in one place, in Rust:

```json
{"method": "pane.answer", "params": {"pane_id": "w1:p2", "key": "1", "expect_label": "Yes"}}
→ {"answered": true}
→ error {"code": "stale", "message": "the menu changed"}
```

herdlingd reads the visible screen, parses the choices, checks that the pane still waits on input and that the option at `key` has `expect_label`, then sends `pane.send_keys [key]`. It marks phone input. New error code `stale`. The app's in-app buttons (`answerChoice`) can move to this method later, so there is one rule.

**App categories.** At start, register category `herdling_choice` with two actions:
- `choice_yes`: title "Yes", option `authenticationRequired` (Face ID or passcode on a locked phone; nobody approves from a phone lying on a desk), not foreground.
- `choice_no`: title "No", options `destructive`, `authenticationRequired`.
The notification body already names the agent. Titles stay "Yes"/"No" because categories are static; the notification body shows the full labels ("Yes · No, and tell Claude…") so the user knows the exact meaning.

**Stage 1a (OTA, works on current builds).** Actions with `opensAppToForeground: true` (expo-notifications `setNotificationCategoryAsync`). The tap opens the app; JS gets the response (`addNotificationResponseReceivedListener`), connects, calls `pane.answer`, shows the result, and stays on the session. This is already a gain: one tap from the Lock Screen instead of open → find → scroll → tap. On Apple Watch a foreground action does not help (it would need the phone), so Stage 1b matters for the Watch.

**Stage 1b (native build, no app opening).** Expo docs say a background notification task runs on an action tap "Only on Android" [E5], so iOS needs native handling:
- In the ssh module, register an `expo-notifications` `NotificationDelegate` through `NotificationCenterManager.shared.addDelegate` (public in expo-notifications 58, `ios/ExpoNotifications/Notifications/NotificationCenterManager.swift`).
- On `choice_yes`/`choice_no`: start `UIApplication.beginBackgroundTask`, read the host manifest (from feature 4) and the key, `QuickRPC` → `hello` → `pane.answer`, then call the completion handler. Timeout 20 s.
- Result: on success, remove the delivered notification and post a quiet local notification "Answered Yes for <agent>" (it also confirms the action on the Watch). On `stale`: "The question changed. Open Herdling." On failure: "Couldn't reach <host>." with the normal open action.
- JS ignores `choice_*` responses when the native handler is present (it checks a module constant), so the answer is never sent twice.
- Android: a small Kotlin `BroadcastReceiver` for the action `PendingIntent` does the same with sshj on a worker thread (`goAsync()`), or the expo-notifications background task with `expo-task-manager` (also a new native dependency). Prefer the Kotlin receiver: it does not depend on a headless JS start.

**Apple Watch.** Nothing more. The Watch shows the mirrored notification with Yes/No; the action runs on the iPhone in the background (Stage 1b).

### 5.5 Stage 2 design (after a spike)

**Spike questions (1–2 days, on a device):**
1. Does a visible push with `contentAvailable: true` (sent through Expo) wake a backgrounded, not force-quit app often enough to update a Live Activity within 10 s? Measure 50 pushes over a day.
2. Can a Notification Service Extension call `Activity<…>.activities` and `update`? (Unverified; if yes, every visible push can update the card.)
3. Does a `LiveActivityIntent` with SSH finish reliably within the time iOS gives?

Ship Stage 2 only if (1) or (2) gives an update within 10 s in at least 80 % of tries. Otherwise drop the live state and keep only a "following" card that the app updates in the foreground, or drop Stage 2.

**Parts if it ships:**
- Widget extension target through `@bacons/apple-targets` (`widget` type), SwiftUI. `HerdlingActivityAttributes` (static: host id, pane id, agent name, kind; content state: `phase` working | needs_you | finished, `since` date, optional `choice {yesLabel, noLabel, yesKey, noKey}`) in a `_shared` folder so the app and the extension compile the same type. Total data ≤ 4 KB [A4].
- `expo-widgets` was considered: it builds Live Activities from JSX and supports buttons, but a button's code returns new props inside the widget and reports taps to the running app [E3]. It cannot run our SSH answer in the background. So SwiftUI plus our own `LiveActivityIntent` is required.
- `ApproveIntent: LiveActivityIntent` (in the app target and the extension) runs `QuickRPC pane.answer`. Same code as Stage 1b.
- Local module `app/modules/live`: `start(attrs, state)`, `update(id, state)`, `end(id)`, `list()`. JS starts a card when the user taps "Follow on Lock Screen" in a session, or (setting) when the app goes to the background with working agents. Start needs the foreground [A4].
- `Info.plist`: `NSSupportsLiveActivities = YES`. No `NSSupportsLiveActivitiesFrequentUpdates` (no ActivityKit pushes).
- herdlingd: for devices with `capabilities: ["live_activity"]`, add `contentAvailable: true` and `data.live = {pane, phase, since}` to "needs you" and "finished" pushes. No extra pushes, so the 2–3 per hour budget is not hit by design.
- The app on wake: update the matching activity from `data.live`; on "finished", end it with the final state.
- `staleDate` = last update + 20 minutes. The card shows "Open Herdling to refresh" when stale.

**Android equivalent.** Android 16 Live Updates: a promoted ongoing notification (`setRequestPromotedOngoing`, `POST_PROMOTED_NOTIFICATIONS`, ProgressStyle or standard style) [G3]. Rules: only for ongoing, user-initiated, time-sensitive activities. A high-priority FCM data message can wake the app to update it. This needs native Kotlin and a data-only push from herdlingd (`data` without `title`/`body` through Expo). It fits "agent run I started". Plan it with Stage 2; not before.

### 5.6 Protocol and herdlingd

- `push.register` gets optional `capabilities: string[]`. Stored per device in the config.
- Push message: optional `categoryId`, `data.choice`, later `contentAvailable` and `data.live`. `PushMessage` in `companion/src/push.rs` gets optional fields with `skip_serializing_if`.
- New RPC `pane.answer`, error code `stale`.
- Rust `choices.rs`: port of `parseChoices` with the same test cases as `choices.test.ts` (copy the fixtures so both sides stay equal).

### 5.7 Security model

- `authenticationRequired` on both actions: a locked phone asks for Face ID or the passcode before the action runs.
- `pane.answer` re-checks the menu on the computer at answer time; a changed or gone menu gets `stale`, never keys.
- The push carries only the two option labels and ids, no question text, no command text. No secret is involved; herdlingd still holds no key.
- The background handler uses the same pinned host key and the restricted key as the app.

### 5.8 OTA or native build

| Piece | Ships as |
|---|---|
| herdlingd choice detection, `categoryId`, `pane.answer` | herdlingd release |
| Stage 1a (foreground actions) | OTA (expo-notifications is in the current build) |
| Stage 1b iOS delegate, Android receiver | Native build (needs the host manifest of feature 4) |
| Stage 2 widget target, `live` module, `NSSupportsLiveActivities` | Native build, after the spike |

### 5.9 Risks

- Choice parsing on the computer can miss menus of other agents. Then the push has no buttons, as today. No harm.
- iOS may kill the background handler before SSH finishes on a weak network. The handler posts "Couldn't reach…" only if it gets time; otherwise the user sees no confirmation. Mitigation: the quiet confirmation notification on success, so no confirmation means "check the app".
- Stage 2 may not pass the spike. That is an acceptable outcome; Stage 1 carries the value.

### 5.10 Size

Stage 1: M, 4–5 days (herdlingd 2, app 1a 1, native 1b 2). Stage 2: spike 1–2 days, then L, 6–8 days.

### 5.11 Test plan

- Rust: `choices.rs` with the shared fixtures; push message with and without category; `pane.answer` ok, stale (changed label), stale (no menu), unknown key.
- Jest: category registration; response routing (1a); JS ignores `choice_*` when the native handler exists.
- Device: locked phone → Yes → Face ID → answered; Watch → Yes → answered (Stage 1b); menu changed before tap → "question changed"; host offline → "Couldn't reach". Android: action from the shade, app killed.
- Stage 2 spike protocol as in 5.5.

### 5.12 Tasks

1. herdlingd: `choices.rs` (port and shared fixtures).
2. herdlingd: `pane.answer`, error `stale`, docs, types, `APP_METHODS`, demo host.
3. herdlingd: `capabilities` in `push.register`; `categoryId` and `data.choice` in needs-you pushes.
4. App 1a: register `herdling_choice` (foreground actions); handle responses with `pane.answer`; send `capabilities`.
5. Native 1b iOS: `NotificationDelegate` in the ssh module, background task, `QuickRPC`, result notifications. Switch the actions to background.
6. Native 1b Android: action receiver with sshj.
7. Stage 2 spike (5.5). Decide.
8. (If go) widget target, attributes, `ApproveIntent`, `live` module, herdlingd `contentAvailable` + `data.live`.

---

## 6. Build order and native builds

### 6.1 Order

| Step | Work | Ships as |
|---|---|---|
| 1 | Feature 2 A–F (fast typing) + herdlingd `pane.watch` | OTA + herdlingd release |
| 2 | Feature 5 Stage 1a + herdlingd `pane.answer`, choice push | OTA + herdlingd release |
| 3 | **Native build A** (main app target only, no new capability): feature 1 (iPad), feature 3 (WebView + preview proxy), feature 2 G (path change), ssh module raw channels | One build, one review with iPad screenshots |
| 4 | **Native build B** (new targets and capability): App Group, key migration, host manifest, feature 4 share extension, feature 5 Stage 1b (uses the manifest and `QuickRPC`), Android share intent and action receiver | One build |
| 5 | Feature 5 Stage 2 spike, then (if it passes) **native build C** with the widget target | Later build |

Why this order:
- Steps 1–2 need no build and give the largest daily gain (typing on cellular, one-tap answers).
- Build A changes only the main target. It has no signing risk, so the iPad review is about the layout alone.
- Build B holds everything that needs the App Group and the key migration. The migration is the riskiest change; it goes out in one build with a TestFlight round on upgraded installs. Stage 1b depends on the same shared code (`QuickRPC`, host manifest), so it belongs here.
- Build C is separate because Stage 2 may not ship.

### 6.2 Features that share one native build

- Build A: iPad (`supportsTablet`, `keys` module), browser preview (`react-native-webview`, ssh module proxy), path change event.
- Build B: share extension (iOS target + Android intent filters), actionable notification background handlers (iOS delegate + Android receiver), App Group, key migration.
- Build C: Live Activity widget target and `live` module.

If only one build is possible, A and B can merge; the cost is that a signing or migration problem then also delays the iPad release.

### 6.3 Rules for every build in this wave

- Load every new native module with `requireOptionalNativeModule` and hide the feature without it. Old builds keep getting OTA updates without crashes.
- Before each `eas update`, diff `app/package.json` against the oldest live build (the expo-shipping rule).
- Keep `version` unchanged under the `appVersion` policy, so existing installs keep getting updates; the optional loading above is what makes this safe.
- Every new RPC is gated by `hello.methods`; every new push field is optional and ignored by old apps.

## 7. What is not feasible, stated plainly

- Live Activities that stay in sync while the app is in the background: no background mode fits, ActivityKit pushes need an APNs key, and the Expo push service does not send them (no support found as of 2026-10-31). Stage 2 is best effort and may be dropped.
- Push-to-start Live Activities: same reason.
- SSH port forwarding: blocked by design (`no-port-forwarding` stays). The proxy channel replaces it.
- Cell-accurate mosh prediction: needs the cursor position, which herdr does not expose yet.
- A watch app: not needed; mirrored actionable notifications cover approvals.

## 8. Sources

- [A1] Apple, Elevating your iPad app with a tab bar and sidebar. https://developer.apple.com/documentation/uikit/elevating-your-ipad-app-with-a-tab-bar-and-sidebar
- [A2] Apple, App Store Connect screenshot specifications. https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- [A3] Apple, Sharing access to keychain items among a collection of apps. https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps
- [A4] Apple, Displaying live data with Live Activities. https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- [A5] Apple, Starting and updating Live Activities with ActivityKit push notifications. https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications
- [A6] Apple, Adding interactivity to widgets and Live Activities. https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities
- [A7] Apple, Declaring your actionable notification types. https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types
- [A8] Apple, Pushing background updates to your app. https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app
- [E1] Expo, Split view (expo-router, alpha). https://docs.expo.dev/versions/latest/sdk/router/split-view/
- [E2] Expo, Send notifications with the Expo push service (message fields). https://docs.expo.dev/push-notifications/sending-notifications/
- [E3] Expo, expo-widgets reference (SDK 58). https://docs.expo.dev/versions/latest/sdk/widgets/
- [E4] Expo blog, Live Activities with Expo, end to end (2026-10-01). https://expo.dev/blog/live-activities-with-expo-end-to-end-client-and-backend
- [E5] Expo, expo-notifications reference (categories, background task). https://docs.expo.dev/versions/latest/sdk/notifications/
- [G1] Android 16 behavior changes, large screens ignore orientation and resizability. https://developer.android.com/about/versions/16/behavior-changes-16
- [G2] Android, Receive simple data from other apps. https://developer.android.com/training/sharing/receive
- [G3] Android, Live Updates. https://developer.android.com/develop/ui/views/notifications/live-update
- [O1] OpenBSD, sshd(8), AUTHORIZED_KEYS FILE FORMAT. https://man.openbsd.org/sshd.8
- [M1] Winstein and Balakrishnan, Mosh: An Interactive Remote Shell for Mobile Clients, USENIX ATC 2012. https://mosh.org/mosh-paper.pdf
- [M2] mosh source, `src/frontend/terminaloverlay.h` (prediction thresholds). https://github.com/mobile-shell/mosh/blob/master/src/frontend/terminaloverlay.h
- [S1] expo-share-intent (SDK 58 = v9). https://github.com/achorein/expo-share-intent
- [S2] expo-share-extension. https://github.com/MaxAst/expo-share-extension
- [S3] Extension memory reports (unofficial, about 120 MB): sledtools/pika PR 409. https://github.com/sledtools/pika/pull/409
- [S4] @bacons/apple-targets. https://github.com/EvanBacon/expo-apple-targets
- [C1] Citadel (SSH client in Swift), `createDirectTCPIPChannel` (not used here; listed because forwarding was evaluated). https://github.com/orlandos-nl/Citadel
- [J1] sshj (SSH client in Java, used by the Android ssh module). https://github.com/hierynomus/sshj
- [W1] react-native-key-commands (UIKeyCommand wrapper, evaluated). https://github.com/envoy/react-native-key-commands
- Local: `herdr api schema --json` (herdr protocol 22); expo-router 58.0.28 type definitions (`build/native-tabs/types.d.ts`, `build/split-view`); expo-notifications 58 `NotificationCenterManager.swift`.
