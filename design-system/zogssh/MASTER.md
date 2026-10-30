# Zogssh design system (native iOS, dark first)

> A file in `design-system/zogssh/pages/<screen>.md` overrides this file for that screen.
> The code source of truth is `app/src/theme/tokens.ts`. When this file and the tokens differ, fix one of them in the same change.

**Product:** a phone remote for coding agents in herdr panes on your own hosts.
**Platform:** iOS (Expo, React Native). No web rules apply: there is no hover, no cursor, no scroll reveal.
**Dials:** variance 3/10 (calm, familiar), motion 3/10 (motion only where it explains), density 7/10.

---

## 1. Color

Dark first. The app has no light theme. Every value is a token in `colors`; components never use raw hex.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `bg` | `#0F172A` | Page | — |
| `card` | `#1B2336` | Cards, sheets, the tab bar | — |
| `muted` | `#272F42` | Raised fill (bubbles, icon tiles, pressed rows) and dividers | not an edge of a control |
| `edge` | `#5B6B82` | Edge of a tappable card | 3.3:1 on `bg` |
| `border` | `#64748B` | Edge of a control (input, outline button, mic) | 3.8:1 on `bg`, 3.3:1 on `card` |
| `text` | `#F8FAFC` | Body text | 17:1 on `bg` |
| `textMuted` | `#94A3B8` | Secondary text | 7.0:1 on `bg`, 6.1:1 on `card` |
| `accent` | `#22C55E` | Primary action (send, new session) | text on it is `bg` |
| `danger` | `#EF4444` | Destructive actions, errors | 4.2:1 on `card`; always with an icon or a label |
| `scrim` | `rgba(0,0,0,0.6)` | Backdrop of a custom sheet | text behind drops to 3.4:1, so it does not compete |

**Status colors.** A status always shows icon + label + color. Color alone never carries the meaning.

| Status | Color | Icon | Label |
|---|---|---|---|
| working | `#60A5FA` blue | spinning `LoaderCircle` | Working |
| blocked (Board: needs you) | `#F59E0B` amber | `Hand` | Needs you |
| done (Board: ready) | `#22C55E` green | `Check` / `Inbox` | Done / Ready |
| idle | `#94A3B8` slate | `Check` / `Moon` | Idle |
| unknown | `#7C8BA1` dim slate | `CircleHelp` | Unknown |

Rules:
- Text on any surface: 4.5:1 or more. Large text and non-text UI (icons, control edges): 3:1 or more.
- Dividers that only group content use `muted`. Edges that show "you can tap this" use `edge` or `border`.

## 2. Elevation

Shadows do not show on a dark page. Each step up is a lighter fill plus a 1 pt edge (`elevation` in tokens).

| Level | Fill | Edge | Use |
|---|---|---|---|
| 0 | `bg` | none | Page |
| 1 | `card` | `muted` | Static cards (host card), sheets |
| tappable | `card` | `edge` | Agent card, tool card, subagent card |
| 2 | `muted` | `border` | A control that sits on a card |

## 3. Type

System font (SF Pro) for UI. JetBrains Mono for code, tool input and output, terminal text, IDs.
Every text style is a role (`textRole`) and scales with Dynamic Type.

| Role | Size | Weight | Max scale |
|---|---|---|---|
| largeTitle | 28 | 700 | 1.6 |
| title | 20 | 600 | 2 |
| body | 16 | 400 | 3 |
| callout | 14 | 400 | 2.5 |
| caption | 12 | 400 | 2 |
| mono | 13 | 400 | 2 |

- Dense rows (status pills, chips, header labels) cap the scale lower (`denseScale.pill` 1.4, `denseScale.row` 1.6).
- Titles wrap to 2 lines before they truncate. Timers and counters use tabular figures.
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
| Card (Board) | scale 0.98, then toward 0.96 while a long press charges; light layer at 0.04 | 100 ms ease-out in, spring back (damping 15, stiffness 220) |
| Row in a list or menu | fill `muted` | instant |
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
- Tabs never slide. Screen transitions use the native stack.
- Reduce Motion: no scale, no rotation, no slide. Keep opacity and color changes that explain a state. Haptics still fire.

## 7. Haptics

`app/src/ui/haptics.ts` is the only module that calls expo-haptics. A "Haptics" setting (on by default) turns all of them off.

| Function | Feel | When |
|---|---|---|
| `tap()` | selection | A chip or filter, the segmented control, a menu row, a toggle (speaker) |
| `press()` | light impact | Open the "+" menu, open a session, recording stops |
| `peek()` | medium impact | A long press opens the peek sheet; a swipe passes its action point (once per crossing); recording starts |
| `commit()` | success | Approve, a prompt sent and accepted, a rename saved, a copy |
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
- [ ] Status shows icon + label + color.
- [ ] Touch targets 44 pt; 8 pt between targets.
- [ ] Press feedback in 150 ms or less; no layout shift on press.
- [ ] Reduce Motion: no scale, rotation or slide.
- [ ] Largest text size: titles wrap, dense rows stay readable, nothing overlaps.
- [ ] Sheets: close button, draft confirm, keyboard does not cover the composer.
- [ ] Haptics follow the table; none on scroll or typing.
- [ ] Empty, error and offline states have a message and a Retry.
- [ ] VoiceOver: labels, order, custom actions, live announcements.
