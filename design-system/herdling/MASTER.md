# Herdling design system (native iOS, dark first)

> A file in `design-system/herdling/pages/<screen>.md` overrides this file for that screen.
> The code source of truth is `app/src/theme/tokens.ts`. When this file and the tokens differ, fix one of them in the same change.

**Product:** a phone remote for coding agents in herdr panes on your own hosts.
**Platform:** iOS (Expo, React Native). No web rules apply: there is no hover, no cursor, no scroll reveal.
**Dials:** variance 3/10 (calm, familiar), motion 3/10 (motion only where it explains), density 7/10.

---

## 0. Idea: "Night Watch"

A shepherd keeps watch at night. The field is dark and quiet; the flock is the set of agents. One lantern burns while work happens, and its warm light is the only bright color. When an agent needs the shepherd, an ember glows. Everything else is calm stone and graphite. Premium means restraint: one accent, hairline edges, deep blacks, precise type, quiet motion. No decorative gradients, no glow on everything.

Motif rules:
- **Gold is scarce.** Gold marks only (a) the primary action (send, approve, pair, the primary button, the "+" new session button), (b) the "working" lantern, (c) the focus or selected state (tab bar, switches, a chosen option). Never decoration, never a large fill apart from the primary button.
- **The lantern glow.** While an agent works, its status dot has a soft radial gold glow (`ui/LanternGlow`) that breathes: 2.4 s per breath, opacity 0.35 ↔ 0.7, on the UI thread. When work stops it fades out in 400 ms. Reduce Motion: static. Only on the Board row status and the session status row.
- **Rows, not boxes.** Lists are flat rows split by spacing and an inset hairline (`ui/Group`, `ui/Row`, `board/AgentRow`). No bordered card around each item. Settings-style screens use full-width grouped bands (`Group` inside `Section`, `Screen flush`).
- **One thing leads.** The Board opens with one large number (`board/summary`, `display` text role). "Needs you" is the only loud row: an ember marker at the left edge and an 8 % ember tint. Everything else is quiet.
- **Liquid Glass.** The tab bar is the system tab bar (`NativeTabs`, SF Symbols, gold selected). Headers are native stack headers, so iOS 26 puts back and bar buttons on glass. Floating controls (the "+" button, the composer box, the plus button) use `ui/Glass` (`GlassSurface`, `GlassButton`). Before iOS 26 they fall back to `glassFallback`, a translucent `raised` fill. A control on a glass sheet uses a solid fill (`onGlass`), because glass on glass does not read. The peek sheet is a system glass sheet on iOS 26.

## 1. Color

Dark only. Warm blacks, not blue slate. Every value is a token in `colors`; components never use raw hex.
Contrast is measured on `bg` / `card` / `raised`.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `bg` | `#0A0A0B` | Page (night) | — |
| `card` | `#141416` | Cards, sheets, the tab bar | — |
| `raised` | `#1C1C1F` | Raised fill: bubbles, icon tiles, the pressed state | not an edge of a control |
| `sunken` | `#070708` | Terminal, code blocks, tool output | — |
| `divider` | `#2A2A2E` | Lines that only group content | not an edge of a control |
| `hairline` | `rgba(255,255,255,0.06)` | 1 pt top highlight of a card | decorative |
| `edge` | `#64605A` | Edge of a tappable card | 3.2:1 on `bg` |
| `border` | `#706B62` | Edge of a control (input, outline button, mic) | 3.7 / 3.5 / 3.2:1 |
| `text` | `#F5F2EA` | Body text (warm ivory) | 17.7 / 16.5 / 15.2:1 |
| `textMuted` | `#A39E93` | Secondary text, section headers (warm stone) | 7.4 / 6.9 / 6.4:1 |
| `accent` | `#D4A857` | Lantern gold: primary action, selected state | 8.4:1 on `card` |
| `accentPressed` | `#B8903F` | A pressed gold control | `onAccent` on it 6.7:1 |
| `onAccent` | `#0A0A0B` | Text and icons on gold and on status fills | 9.0:1 on `accent` |
| `link` | `#F5F2EA` | Links in replies, always underlined | as `text` |
| `danger` | `#E5484D` | Destructive actions, errors | 4.7:1 on `card`; always with an icon or a label |
| `scrim` | `rgba(0,0,0,0.6)` | Backdrop of a custom sheet | text behind drops to 3.3:1, so it does not compete |
| `raisedHigh` | `#2C2B2F` | Selected pill of a segmented control | text 13.9:1, textMuted 5.3:1 |
| `glassFallback` | `rgba(28,28,31,0.92)` | Glass control before iOS 26 | as `raised` |
| `blockedTint` | `rgba(232,121,74,0.08)` | Tint of a Board row that needs you | text 15.9:1, textMuted 6.7:1, ember 5.9:1 |

**Status colors.** A status always shows a word + color: a small dot and the word (`ui/StatusDot`), no outlined pill. Color alone never carries the meaning. The session status row keeps its icon.

| Status | Color | Icon | Label |
|---|---|---|---|
| working | `#D4A857` lantern gold (+ lantern glow) | spinning `LoaderCircle` | Working |
| blocked (Board: needs you) | `#E8794A` ember | `Hand` | Needs you |
| done (Board: ready) | `#8DB580` pasture sage | `Check` / `Inbox` | Done / Ready |
| idle | `#A39E93` stone | `Check` / `Moon` | Idle |
| unknown | `#8A857B` dim stone | `CircleHelp` | Unknown |

All status colors are 5:1 or more on `card`.

Rules:
- Text on any surface: 4.5:1 or more. Large text and non-text UI (icons, control edges): 3:1 or more.
- Dividers that only group content use `divider`. Edges that show "you can tap this" use `edge` or `border`.
- The terminal uses `terminal.bg` (= `sunken`) and a warmed ANSI palette (black and white entries warmed).

## 2. Elevation

Depth by light, not shadow. Each step up is a little lighter, with a 1 pt edge. A card also has a 1 pt top highlight (`hairline`, `ui/TopHighlight`), like brushed metal under a lantern.

| Level | Fill | Edge | Use |
|---|---|---|---|
| sunken | `sunken` | `divider` | Terminal, code blocks |
| 0 | `bg` | none | Page |
| 1 | `card` + highlight | `divider` | Static cards (host card), sheets |
| tappable | `card` + highlight | `edge` | Agent card, tool card, subagent card |
| 2 | `raised` | `border` | A control that sits on a card |

## 3. Type

System font (SF Pro) for UI. JetBrains Mono for code, tool input and output, terminal text, IDs. No new font files (a font needs a native build).
Every text style is a role (`textRole`) and scales with Dynamic Type.

| Role | Size | Weight | Tracking | Max scale |
|---|---|---|---|---|
| display | 44 | 700 | -1, tabular figures | 1.3 |
| largeTitle | 28 | 700 | -0.4 | 1.6 |
| title | 20 | 600 | — | 2 |
| headline | 17 | 600 | — | 2 |
| body | 16 | 400 | — | 3 |
| callout | 14 | 400 | — | 2.5 |
| caption | 12 | 400 | — | 2 |
| section | 12 | 600 | +0.8, uppercase, `textMuted` | 1.6 |
| mono | 13 | 400 | — | 2 |

- Section headers (Board groups, "Hosts", Settings groups) use `section`: the small caps editorial touch. No icon in a section header.
- A row title is `headline` (Board) or `body` (Settings); its one line of detail is `callout` in `textMuted`.
- Dense rows (status pills, chips, header labels) cap the scale lower (`denseScale.pill` 1.4, `denseScale.row` 1.6).
- Titles wrap to 2 lines before they truncate. Timers, counters, CPU and usage use tabular figures.
- Line height is 1.5 times the size.

## 4. Space, radius, icons, targets

- Space: 4, 8, 12, 16, 24, 32, 48 (`space.xs` to `space.xxxl`).
- Radius: 6, 10, 16, pill.
- Icons: lucide, outline, stroke 2. Sizes `icon.sm` 16, `icon.md` 20, `icon.header` 22 (header row), `icon.lg` 24.
- Touch target: 44 × 44 pt minimum. A smaller visual gets `hitSlop` or padding, not a larger icon.
- Keep 8 pt or more between two touch targets.

## 5. Press states

There is no hover. Feedback starts on press-in, the action runs on release.

| Control | Pressed state | Time |
|---|---|---|
| Icon button, ghost button | opacity `state.pressedOpacity` 0.6 | instant |
| Filled button | opacity `state.pressedFill` 0.85 | instant |
| Row (Board) | scale 0.98, then toward 0.96 while a long press charges; light layer at 0.04 | 100 ms ease-out in, spring back (damping 15, stiffness 220) |
| Glass control | the system glass response (iOS 26); fallback: opacity 0.6 | instant |
| Row in a list or menu, a chip, a choice button, a key | fill `raised` | instant |
| Primary (gold) button | fill `accentPressed` | instant |
| Send button | scale 0.94 + `accentPressed` | 120 ms (scale), 150 ms (color) |
| Disabled | opacity `state.disabledOpacity` 0.4, `accessibilityState.disabled`, no action | — |
| Offline host content | opacity `state.offlineOpacity` 0.6 | — |

Press feedback never changes layout bounds. Scale is a transform.

## 6. Motion

Tokens: `motion` in `tokens.ts`. Reanimated on the UI thread; never `setState` per frame.

- Press: 80-150 ms. State change (chip, toggle): 180 ms. A menu or sheet that enters without a finger: 240 ms.
- Exit time is 65 % of enter time (`motion.exitRatio`).
- A finger moved it: use a spring (`motion.spring.sheet`, `motion.spring.swipe`) and pass the gesture velocity.
- Curves: ease-out `[0.23, 1, 0.32, 1]` for things that enter or react; ease-in-out `[0.77, 0, 0.175, 1]` for on-screen movement; linear only for constant rotation. Never ease-in.
- Status: the working spinner turns once per second; "needs you" pulses once when it starts; finished work pops once.
- Lantern glow: see section 0. Breathes 2.4 s, fades out 400 ms when work stops.
- Board enter: the first Board load per app launch staggers the first 8 cards (opacity 0 → 1, rise 8 pt, 40 ms apart, 260 ms ease-out). Never on refresh or return.
- Needs you: when a card moves to "needs you", its ember edge glows once (600 ms opacity pulse). No loop.
- Thread: a new item that arrives while you are at the bottom fades in and rises 6 pt (200 ms ease-out). Loaded pages do not animate.
- Pending prompt: the state line crossfades on a change (150 ms).
- Segmented control: the selected pill slides with a spring (duration 300, dampingRatio 1).
- Send button: gold fades in over 150 ms when there is text; graphite when empty.
- Tabs never slide. Screen transitions use the native stack.
- Reduce Motion: no scale, no rotation, no slide. Keep opacity and color changes that explain a state. Haptics still fire.

## 7. Haptics

`app/src/ui/haptics.ts` is the only module that calls expo-haptics. A "Haptics" setting (on by default) turns all of them off.

| Function | Feel | When |
|---|---|---|
| `tap()` | selection | A chip or filter, the segmented control, a menu row, a toggle (speaker) |
| `press()` | light impact | Send (on the tap), open the "+" menu, open a session, recording stops |
| `peek()` | medium impact | A long press opens the peek sheet; a swipe passes its action point (once per crossing); recording starts |
| `commit()` | success | Approve, a retried prompt accepted, a rename saved, a copy |
| `warn()` | warning | Deny; a destructive confirm (close, restart) comes up |
| `fail()` | error | Send, upload or rename failed |
| `status()` | success / warning / selection | The open session or a Board card changes bucket: done → success, needs you → warning, else selection. At most one per 1.5 s |

Rules: one haptic per user action, at the moment of the visual change. Never on scroll, on typing, or on a plain render. A haptic is never the only feedback.

## 8. Sheets and modals

- Use native sheets (`presentation: "formSheet"` with detents, or `"modal"`). The peek sheet has detents 0.6 and 1.
- Every sheet has a visible close button as well as swipe-down.
- Closing a sheet with a non-empty draft asks first ("Discard draft?").
- The keyboard never covers the composer: the sheet content sits in a `KeyboardAvoidingView`.
- Inside a sheet: header fixed at the top, content fills the middle (`flex: 1`, `minHeight: 0`), the composer is pinned at the bottom. Scroll views in a sheet use `contentInsetAdjustmentBehavior="never"`.

## 9. Thread

- Assistant replies render as markdown. Code blocks and tables scroll sideways inside their own box; they never draw outside the message.
- User prompts are right-aligned bubbles. A long prompt starts collapsed at 8 lines with "Show more".
- Queued prompts: a sent prompt shows at once as a dimmed bubble at the end with a state line: "Sending…", then "Queued" (clock icon) until the log has the same text. A failed send shows "Not sent · Retry" (tap retries, long press removes).
- Tool cards: name and summary in mono. Running: spinner and a ticking timer. Done: check or X with the run time. Opened: input and result; the newest running card shows live pane output. "Expand" opens the full tool view (pinch for text size, copy).

## 10. Loading

- An action that ends in under 300 ms shows no spinner. A spinner shows only after 300 ms (`useDelayed`).
- The first load of a thread shows a skeleton, not a spinner.
- Every network wait has a timeout and then an error with a Retry.

## 11. Empty, error and offline states

Each one has an icon, one sentence that says what is true, and an action when one exists.

| Where | State | Message + action |
|---|---|---|
| Board | no hosts | "No hosts yet." + Add a host |
| Board | all quiet | "All quiet. Nothing needs you." |
| Board | host offline | "<host> is offline · seen 5m ago" + Retry |
| Usage, Automations | host offline or error | the cause + Retry |
| Pairing, discovery | nothing found or failed | the cause + Retry / Add manually |

## 12. Accessibility

- Every control has an `accessibilityLabel` and a role; icon buttons announce their state (selected, expanded, busy, disabled).
- Gestures have a visible or VoiceOver alternative: the Board card has a "⋯" button and custom actions for swipe and long press.
- Status changes on the Board are announced ("api moved to Needs you") without moving focus, at most one per 2 s.
- Hold-to-talk also works as tap-to-toggle, and has a VoiceOver action.
- Test at the largest accessibility text size and with Reduce Motion on before you ship.

## Pre-delivery checklist

- [ ] Only tokens: no raw hex, opacity, scale or duration in components.
- [ ] Gold only on a primary action, the working lantern, or a selected state.
- [ ] Status shows a word + color (dot + word).
- [ ] No bordered card around a list item; no icon in a section header.
- [ ] Touch targets 44 pt; 8 pt between targets.
- [ ] Press feedback in 150 ms or less; no layout shift on press.
- [ ] Reduce Motion: no scale, rotation or slide.
- [ ] Largest text size: titles wrap, dense rows stay readable, nothing overlaps.
- [ ] Sheets: close button, draft confirm, keyboard does not cover the composer.
- [ ] Haptics follow the table; none on scroll or typing.
- [ ] Empty, error and offline states have a message and a Retry.
- [ ] VoiceOver: labels, order, custom actions, live announcements.
