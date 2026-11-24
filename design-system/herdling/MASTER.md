# Herdling design system (native iOS, dark first)

> A file in `design-system/herdling/pages/<screen>.md` overrides this file for that screen.
> The code source of truth is `app/src/theme/tokens.ts`. When this file and the tokens differ, fix one of them in the same change.

**Product:** a phone remote for coding agents in herdr panes on your own hosts.
**Platform:** iOS and Android (Expo, React Native). Every rule applies on both. No web rules apply: there is no scroll reveal. A pointer (iPad trackpad) gets a light hover layer only.
**Dials:** variance 3/10 (calm, familiar), motion 3/10 (motion only where it explains), density 7/10.

---

## 0. Idea: "Night Watch"

A shepherd keeps watch at night. The field is dark and quiet; the flock is the set of agents. One lantern burns while work happens, and its warm light is the only bright color. When an agent needs the shepherd, an ember glows. Everything else is calm stone and graphite. Premium means restraint: one accent, hairline edges, deep blacks, precise type, quiet motion. No decorative gradients, no glow on everything.

Motif rules:
- **Gold is scarce.** Gold marks only (a) the primary action (send, approve, pair, the primary button, the "+" new session button), (b) the "working" lantern, (c) the focus or selected state (tab bar, switches, the check of the current choice). Never decoration, never a large fill apart from the primary button.
- **The lantern glow.** While an agent works, its status dot has a soft radial gold glow (`ui/LanternGlow`) that breathes: 2.4 s per breath, opacity 0.35 ↔ 0.7, on the UI thread. When work stops it fades out in 400 ms. Reduce Motion: static. Only on the Board row status and the session status row.
- **Rows, not boxes.** Lists are flat rows split by spacing and an inset hairline (`ui/Group`, `ui/Row`). No bordered card around each item. One exception: the Board shows each agent as a card (a tile) by default (More, Appearance, "Agent list style": cards, rows with arrows, or plain rows), because new users did not see that a plain row opens the session. Settings-style screens use full-width grouped bands (`Group` inside `Section`, `Screen flush`).
- **One thing leads.** The Board top has two forms (More, Appearance, "Overview top", `homeTop` in `board/boardPrefs`). "Needs you" is the only loud row: an ember marker at the left edge and an 8 % ember tint. Everything else is quiet.
  - **Dashboard** (default, `board/Dashboard`, `board/BoardTop`): no native header. A brand header: the sheep mark and "Herdling" (`largeTitle`) at the left, and at most two buttons at the right (S4): the filter magnifier (`IconButton`, gold while the filter field shows; ⌘F) and the computers button (up to 3 circles with a first letter and an online dot in sage or stone, then "+n"; a tap opens More, Computers, `/settings/computers`). Then a `section` label ("Highlights", or "Recent" for the idle fallback) and a carousel of large tiles: 78 % of the board width (max 340 pt), 188 pt high (`TILE_H`), radius 24, gap 12, inset 16, snap per tile, no auto scroll. A tile is the agent's last screen lines in dim mono on `sunken`, faded to `sunken` at the bottom, with the title (`headline`), the status (dot + word) and "computer · agent". Needs you: a 1.5 pt ember edge and `blockedTint`; working: a `hintEdge` gold edge; else `divider`. An elapsed label (`ui/Tag` look: `raised`, radius `sm`, no glass, because glass is never in content) sits at the top right for working and needs you. The last tile is a quiet "New session" tile: `card` with a hairline `divider` edge, a `textMuted` "+" and the label in `headline`, `raised` when pressed. It is not gold: the floating "+" is the primary new session action. Tile press: the Board row press (scale 0.98, light layer). Only tiles on screen read the screen, every 5 s. Under the carousel: one summary line, then the list bar.
  - **List bar** (`board/ListBar`, both top forms): the list title ("All agents", or the status word of the filter) with its count, one `caption` line that says how the list is grouped and sorted ("Grouped by status · Sorted by name"), and one list options button. The button opens one `MenuSheet` (`board/listMenu`): "Show" (all agents or one status, with live counts), "Group by" and "Sort by", all with checks, and a last row "Jump to a terminal". While a status filter is on, the icon is gold (selected) and a ghost "Show all" button clears the filter. It replaces the old "Group" and "Sort" header menus and the filter chips.
  - **Summary** (`board/BoardTop` `Summary`): the native "Agents" header with one button (the filter magnifier) and one large number (`display`).
  - Computer and workspace section headers show a count and collapse on tap (a chevron turns in 180 ms; Reduce Motion: no turn).
- **Liquid Glass.** Glass is only for chrome that floats over content (see "Structure", S1). The tab bar is the system tab bar (`NativeTabs`, SF Symbols, gold selected). Headers are native stack headers, so iOS 26 puts back and bar buttons on glass. Floating controls (the "+" button, the composer box, the plus button, the `ActionBar`) use `ui/Glass` (`GlassSurface`, `GlassButton`). Before iOS 26 and on Android they fall back to `glassFallback`, a translucent `raised` fill. A control on a glass sheet uses a solid fill (`onGlass`), because glass on glass does not read. The peek sheet is a system glass sheet on iOS 26.

---

## Structure

The app is one product, so each job looks the same on every screen. The spec with the reasons is
`docs/superpowers/specs/2026-11-23-cohesion-redesign-design.md`.

### S1. Three surfaces

| Surface | Where | Never |
|---|---|---|
| **Glass** | Chrome that floats over content: the system header buttons, the session's own header buttons (`IconButton glass`), the system tab bar, the composer, the `ActionBar` | In content. No glass card, no glass row, no glass chip |
| **Grouped list** (`ui/Group` + `ui/Row` on `card`) | Every choice, every setting, every menu, every list of things | — |
| **Tile** (`card` + `divider` or a status edge) | A preview of live content: a pane thumbnail, a dashboard tile, an agent card | For a choice or an action |

Anything else sits flat on `bg`.

### S2. One control per job

| Job | Control | Notes |
|---|---|---|
| The main action of a screen | `Button` primary (accent fill), full width, in `ui/ActionBar` | At most one per screen |
| A second action | `Button` secondary: `raised` fill, no border, `text` label | Next to the primary in the `ActionBar`, or in content |
| A low action | `Button` ghost: no fill, no border | |
| A destructive action | `Button` danger: `raised` fill, `danger` label, no border. In a menu: a destructive row, which goes to the last section | Always asks first |
| Choose 1 of 2 to 4 fixed options | `ui/Segmented` | The options never change at run time. An option can have an attention dot (ember, its meaning in the VoiceOver name) or an icon in place of its label (the compact form, one touch target per segment) |
| An icon action (header button, a row's "⋯", a dismiss) | `ui/IconButton`: 44 pt target, no fill, no edge; `size="header"` in a header; `glass` only in the session's own header row | The one icon button. `CloseButton` is an `IconButton` |
| Search or filter text | `ui/SearchField`: `raised`, no edge, radius `md`, a magnifier | The one search field |
| Choose 1 of a list that can grow (computer, space, tab, folder, agent, model, voice) | `ui/PickerRow`: title at the left, the current value and a chevron at the right. A tap opens `ui/PickerSheet` (`showPicker`) with a check on the current value | No selector chips. A risky option has the `danger` tone and keeps its place. A row that opens an inline area (the Folder row of New session) is `expanded`: the chevron points down |
| On or off | `GoldSwitch` in a `Row` | |
| A set of actions on a thing ("⋯", long press) | `ui/MenuSheet` (`showMenu`) | Never the system action sheet |
| Filter a list | `Segmented` for 2 to 4 fixed filters, else a header menu button that opens a `MenuSheet` with checks | No filter chips |
| A shortcut that fills or sends text (saved prompt, recent command, pasted text) | `ui/Shortcut`: `raised` fill, no border, radius `md`, 36 pt visual in a 44 pt target | The only chip-like part. Never shows a selected state |

Not used any more: selector chips, filter chips, the outline (`border`) button, the outline icon
button, pill-shaped selectors and the system action sheet (`ActionSheetIOS`). The pill radius stays
only for the status dot, the switch, the send button and the system glass controls. A small quiet
label ("Demo", "Herdr 2") is a `ui/Tag`: `raised`, radius `sm`, not tappable.

### S3. One menu (`ui/MenuSheet`)

A bottom sheet in the app's own style, the same on iOS and Android. `showMenu(...)` opens it;
`MenuSheetHost` in the root layout draws it, over every screen, also over a modal or a form sheet.

- Layout: a grabber, an optional title (`headline`) and one line of detail, a close button at the
  right, then the sections. A section is an optional `section` title and a `Group` of rows.
- A row: a lucide icon (20 pt, `textMuted`) or a leading part (agent mark, group tile), a label
  (`body`), an optional detail line, and at the right an optional value (`callout`, `textMuted`) or
  a gold check. At least `sheet.rowHeight` (52 pt) high; it grows with the text.
- Destructive rows have a `danger` icon and label, and always sit in the last section.
- No "Cancel" row. The sheet closes with a tap outside, a swipe down, the close button, the Android
  back button and the VoiceOver escape gesture.
- Surface: `card` with the top highlight, radius `lg` at the top, the system bottom inset. At most
  80 % of the screen high (`sheet.maxHeightRatio`); then the rows scroll. With the keyboard up, the
  sheet sits on the keyboard.
- `PickerSheet` (`showPicker`) is the same sheet with a check on the current value, an optional
  detail line and leading part per option, and a search field from 10 options.
- `showActionSheet(options, onPick)` draws through the same sheet: one section, the destructive
  options in a last section, no Cancel row. A close with no pick reports `cancelButtonIndex`.
- An action runs after the sheet is gone, so it can open a screen or a confirm sheet.
- Motion and haptics: see sections 6 and 7.

### S4. One screen skeleton

- **Header:** the native stack header with the screen title. Header buttons are icon buttons (the
  system puts them on glass). At most two at the right; more go in a "⋯" `MenuSheet`.
- **Content:** `ui/Screen`. Side inset `space.lg`. Sections are `Section` + `Group`; the gap between
  sections is `space.xl` (`Screen flush`). The last content clears the home indicator, the tab bar
  and the `ActionBar` (`screenBottomPadding`), so nothing stays under them at the end of the scroll.
- **Bottom:** `ui/ActionBar` when the screen has a primary action: a glass (or `glassFallback`) bar
  with a top hairline, above the safe area or the tab bar, with the primary button and at most one
  secondary. Pass it as `Screen footer`. Buttons never float in the middle of an empty page.
- **Empty state:** `StateNotice` in the center of the content area: icon, one sentence, one action
  (a secondary `Button`). It takes the full width and centers itself, so the screen adds no wrapper.
  Inside a band or a banner it is `inline`: one row with no inset of its own.
- **Session header:** the session (and the subagent screen) has no native bar. It draws one row of
  its own (`SessionHeader`): back (`IconButton glass`), the agent mark, the title (2 lines) and the
  "computer · agent · model" line, then the compact Thread / Terminal `Segmented` (icon form) and
  "⋯" (`IconButton glass`, with a dot when a dev server port is found). The route sets
  `headerShown: false`, so the native bar never shows.

### S5. Three tabs

`Agents` (route `(overview)`), `Spaces`, `More` (route `settings`). The route names stay, so deep
links and push routing do not change.

- Usage and Automations are stack screens (`/usage`, `/automations`). Rows at the top of `More`
  open them. The Usage row shows the current plan use as its value when the data is there.
- `More` is a short index of rows (`settings/MorePage`), each a `PickerRow` with its icon and,
  where one value sums the page up, that value. Three groups: Computers (the count), Usage (the
  highest plan use, "42% used", once the Usage screen read it), Automations · Appearance (the
  theme), Voice, Notifications, Terminal (the renderer), Prompts (the count), General ·
  Diagnostics, About (the version). Every setting keeps its stored key and its effect.
- Keyboard: ⌘1 Agents, ⌘2 Spaces, ⌘3 More, ⇧⌘U Usage, ⇧⌘A Automations, ⌘N New session.

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
| `border` | `#706B62` | Edge of an input field and of the mic. Not a button edge | 3.7 / 3.5 / 3.2:1 |
| `text` | `#F5F2EA` | Body text (warm ivory) | 17.7 / 16.5 / 15.2:1 |
| `textMuted` | `#A39E93` | Secondary text, section headers (warm stone) | 7.4 / 6.9 / 6.4:1 |
| `accent` | `#D4A857` | Lantern gold: primary action, selected state | 8.4:1 on `card` |
| `accentPressed` | `#B8903F` | A pressed gold control | `onAccent` on it 6.7:1 |
| `onAccent` | `#0A0A0B` | Text and icons on gold and on status fills | 9.0:1 on `accent` |
| `link` | `#F5F2EA` | Links in replies, always underlined | as `text` |
| `danger` | `#E5484D` | Destructive actions, errors | 4.7:1 on `card`; always with an icon or a label |
| `scrim` | `rgba(0,0,0,0.6)` | Backdrop of the menu sheet and of a custom dialog | text behind drops to 3.3:1, so it does not compete |
| `raisedHigh` | `#2C2B2F` | Selected pill of a segmented control; the pressed fill of a `raised` button or shortcut | text 13.9:1, textMuted 5.3:1 |
| `glassFallback` | `rgba(28,28,31,0.92)` | Glass control before iOS 26 | as `raised` |
| `blockedTint` | `rgba(232,121,74,0.08)` | Tint of a Board row that needs you | text 15.9:1, textMuted 6.7:1, ember 5.9:1 |

**Agent marks.** `ui/AgentMark` shows an agent kind as one or two letters in a muted tint on a
`raised` tile (`colors.agent`). No brand logos. The name is always next to the mark, so the tint is
never the only cue. The tints are never gold and never the ember of "needs you".

| Kind | Tint | Contrast on `raised` |
|---|---|---|
| claude | `#E3A98C` clay | 8.4:1 |
| codex | `#F5F2EA` ivory | 15.2:1 |
| pi | `#B9A3E3` lavender | 7.6:1 |
| opencode | `#9FC7C0` sea green | 9.2:1 |
| omp | `#D7A3C9` heather | 8.1:1 |
| gemini | `#7FA7F0` sky | 7.0:1 |
| other kinds | `#A39E93` stone | 6.4:1 |

**Group tiles.** `ui/GroupTile` shows a Herdr 2 group as its first letter in a muted tone on the
tone at 18% over `card` (`colors.groupTile`, 8 tones). A hash of the group name picks the tone, so
a group keeps its color on every screen. The group name is always next to the tile. The tones are
never gold and never ember. Each letter is 5.1:1 or more on its tile in every theme (the theme
test checks it). The Spaces tab draws a tab map of small pane cells: ember for needs you, the
lantern for working, sage for done, `raisedHigh` for the rest; the row also says the count.

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
- Dividers that only group content use `divider`. A tappable tile uses `edge`; an input field uses `border`. Buttons have no edge: their fill shows that they are buttons.
- The terminal uses `terminal.bg` (= `sunken`) and a warmed ANSI palette (black and white entries warmed).

### Themes and accents

The values above are Night Watch, the default. More, Appearance, Theme lets the user pick a
theme and an accent (`app/src/theme/palettes.ts`). Each one changes only some tokens; the others keep
their Night Watch values. `palettes.test.ts` checks the contrast rules above for every combination.

| Theme | Change | text / textMuted on bg, card, raised | border |
|---|---|---|---|
| Night Watch | — | 17.7 / 16.4 / 15.2, 7.4 / 6.9 / 6.4 | 3.7 / 3.5 / 3.2 |
| Midnight | `bg` and `sunken` `#000000`, `card` `#0E0E10`, `raised` `#18181B`; same text | 18.8 / 17.2 / 15.8, 7.9 / 7.2 / 6.6 | 4.0 / 3.6 / 3.4 |
| Graphite | Cool greys (`bg` `#0A0B0D`, `card` `#141619`), cool text `#F1F3F6` / `#9BA1AB` | 17.7 / 16.3 / 14.9, 7.6 / 7.0 / 6.4 | 4.0 / 3.6 / 3.3 |

| Accent | `accent` | on `card` (lowest theme) | `onAccent` on it | on `accentPressed` |
|---|---|---|---|---|
| Lantern | `#D4A857` | 8.2:1 | 9.0:1 | 6.7:1 |
| Ember | `#F0884A` | 7.2:1 | 7.8:1 | 5.7:1 |
| Sea glass | `#5EC2B0` | 8.5:1 | 9.3:1 | 6.3:1 |
| Iris | `#A898F0` | 7.3:1 | 7.9:1 | 5.5:1 |
| Ivory | `#E9E4D8` | 14.3:1 | 15.6:1 | 11.0:1 |

Rules:
- "Gold" in this file means the accent. The same scarcity rules apply to every accent.
- The lantern follows the accent: `status.working` = `accent`. `onAccent` is `#0A0A0B` for every accent.
- "Needs you" stays ember, except with the Ember accent: then it is rose `#EE7BB4` (7.0:1 on `card`),
  so it never looks like the working lantern.
- Only dark themes. A light theme needs light variants of every token, light native controls
  (headers, glass, keyboard, status bar) and a check on a device.
- **Terminal themes** (More, Appearance, Theme, "Terminal"; `TERMINAL_THEMES` in `palettes.ts`) change only
  `terminal.bg`, `terminal.fg` and `ansi`: the screen of the terminal view. "Same as the app" keeps
  the theme's values. "Paper" is the one light surface: `#F7F4EC` with ink `#24211C` (14.6:1), and
  every ANSI entry 4:1 or more on it ("white" is a mid grey `#6F6A61`, so white text stays
  readable). Text drawn on the terminal screen uses `terminal.fg`, never `text` or `textMuted`.
- Code reads `colors.*` at render time. Never copy a color into a module constant: a theme change
  replaces the values in place and mounts the screens again. For a `StyleSheet.create` at module
  level, use `themed(() => StyleSheet.create(...))`.

## 2. Elevation

Depth by light, not shadow. Each step up is a little lighter, with a 1 pt edge. A card also has a 1 pt top highlight (`hairline`, `ui/TopHighlight`), like brushed metal under a lantern.

| Level | Fill | Edge | Use |
|---|---|---|---|
| sunken | `sunken` | `divider` | Terminal, code blocks |
| 0 | `bg` | none | Page |
| 1 | `card` + highlight | `divider` | Static cards (host card), sheets |
| tappable | `card` + highlight | `edge` | Agent card, tool card, subagent card |
| 2 | `raised` | none (an input field has `border`) | A button, a shortcut, a search field, a control on a card |

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

- Section headers (Board groups, "Computers", More pages) use `section`: the small caps editorial touch. No icon in a section header.
- A row title is `headline` (Board) or `body` (More pages, menus); its one line of detail is `callout` in `textMuted`.
- Dense rows (status labels, shortcuts, tags, header labels) cap the scale lower (`denseScale.pill` 1.4, `denseScale.row` 1.6).
- Titles wrap to 2 lines before they truncate. Timers, counters, CPU and usage use tabular figures.
- Line height is 1.5 times the size.

## 4. Space, radius, icons, targets

- Space: 2, 4, 8, 12, 16, 24, 32, 48 (`space.xxs` to `space.xxxl`). `xxs` is only the tight gap between a title and its detail line and the pad of a segmented track.
- Radius: 6 (`sm`: tags), 10 (`md`: buttons, shortcuts, fields), 16 (`lg`: sheets, banners), pill (only the status dot, the switch, the send button and the system glass controls).
- Icons: lucide, outline, stroke 2. Sizes `icon.sm` 16, `icon.md` 20, `icon.header` 22 (header row), `icon.lg` 24.
- Touch target: 44 × 44 pt minimum. A smaller visual gets `hitSlop` or padding, not a larger icon.
- Keep 8 pt or more between two touch targets.
- Sizes of the kit parts are tokens: `sheet` (menu sheet), `shortcut` (shortcut token), `actionBar` (the font scale where the bar buttons stack).

## 5. Press states

There is no hover. Feedback starts on press-in, the action runs on release.

| Control | Pressed state | Time |
|---|---|---|
| Icon button, ghost button | opacity `state.pressedOpacity` 0.6 | instant |
| Secondary or danger button, shortcut | fill `raisedHigh` | instant |
| Row (Board) | scale 0.98, then toward 0.96 while a long press charges; light layer at 0.04 | 100 ms ease-out in, spring back (damping 15, stiffness 220) |
| Glass control | the system glass response (iOS 26); fallback: opacity 0.6 | instant |
| Row in a list, a menu or a picker, a key | fill `raised` | instant |
| Primary (gold) button | fill `accentPressed` | instant |
| Send button | scale 0.94 + `accentPressed` | 120 ms (scale), 150 ms (color) |
| Disabled | opacity `state.disabledOpacity` 0.4, `accessibilityState.disabled`, no action | — |
| Offline host content | opacity `state.offlineOpacity` 0.6 | — |

Press feedback never changes layout bounds. Scale is a transform.

## 6. Motion

Tokens: `motion` in `tokens.ts`. Reanimated on the UI thread; never `setState` per frame.

- Press: 80-150 ms. State change (toggle, check): 180 ms. A menu or sheet that enters without a finger: 240 ms.
- Menu sheet: it rises in `motion.enterMs` (ease-out) over the scrim fade, and leaves in 65 % of that. A swipe down past 30 % of its height or faster than 800 pt/s closes it with a spring (`motion.spring.sheet`) and the finger's speed; a shorter swipe springs back. Reduce Motion: fade only.
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
| `tap()` | selection | A filter, the segmented control, a pick in a menu or picker, a shortcut that fills the box, a toggle (speaker) |
| `press()` | light impact | Send (on the tap), open a menu or picker (`showMenu` does it), open the "+" menu, open a session, recording stops |
| `peek()` | medium impact | A long press opens the peek sheet; a swipe passes its action point (once per crossing); recording starts |
| `commit()` | success | Approve, a retried prompt accepted, a rename saved, a copy |
| `warn()` | warning | Deny; a destructive confirm (close, restart) comes up (the caller gives it; `showActionSheet` gives no open haptic) |
| `fail()` | error | Send, upload or rename failed |
| `status()` | success / warning / selection | The open session or a Board card changes bucket: done → success, needs you → warning, else selection. At most one per 1.5 s |

Rules: one haptic per user action, at the moment of the visual change. Never on scroll, on typing, or on a plain render. A haptic is never the only feedback.

## 8. Sheets and modals

- Use native sheets for screens (`presentation: "formSheet"` with detents, or `"modal"`). The peek sheet has detents 0.6 and 1.
- A list of actions or a choice is never a screen: it is the menu sheet (`showMenu`, `showPicker`, see S3).
- Every sheet has a visible close button as well as swipe-down.
- Closing a sheet with a non-empty draft asks first ("Discard draft?").
- The keyboard never covers the composer: the sheet content sits in a `KeyboardAvoidingView`.
- Inside a sheet: header fixed at the top, content fills the middle (`flex: 1`, `minHeight: 0`), the composer is pinned at the bottom. Scroll views in a sheet use `contentInsetAdjustmentBehavior="never"`.

## 9. Thread

- Assistant replies render as markdown. Code blocks and tables scroll sideways inside their own box; they never draw outside the message.
- User prompts are right-aligned bubbles. A long prompt starts collapsed at 8 lines with "Show more".
- Queued prompts: a sent prompt shows at once as a dimmed bubble at the end with a state line: "Sending…", then "Queued" (clock icon) until the log has the same text. A failed send shows "Not sent · Retry" (tap retries, long press removes). A queued prompt of a working Claude Code agent has a "Send now" button at the left of its bubble: a secondary button (`raised` fill, no border, ArrowUp, 44 pt high), not gold. The row wraps, so on a narrow phone or with a long prompt the button sits under the bubble at the right.
- Tool cards: name and summary in mono. Running: spinner and a ticking timer. Done: check or X with the run time. Opened: input and result; the newest running card shows live pane output. "Expand" opens the full tool view (pinch for text size, copy).
- Search: "Find" in the "⋯" menu (or ⌘F) opens the search bar ("3 of 12", older, newer, close). A matching row gets a 3 pt bar at its left edge: gold for the current match (the selected state), stone for the others. The excerpt under the bar and the terminal text show the match in `search` colors. The composer hides while the search is open. ⌘F opens it.
- Saved prompts: while the prompt box is empty and has the focus, a row of shortcuts (`ui/Shortcut`) sits above it. A tap sends the text (while a send cannot go, it fills the box); a long press opens a `MenuSheet` with "Put in the box". No gold: a shortcut is not the primary action. Recent commands of the terminal and pasted texts use the same token.
- Board filter: a magnifier in the Board header (gold while open) shows a filter field (`SearchField`) above the list (⌘F). The status filters are rows of the list options menu (five statuses do not fit a `Segmented`), never chips. The status groups stay. No match: a `StateNotice` with Clear.
- Changes and diff: flat rows (status letter in mono, file name, folder, `+n −n`). The diff view is mono on `sunken`; added and deleted lines use the `diff` tints and keep their `+` or `-` sign, so color is never the only cue.

## 10. Loading

- An action that ends in under 300 ms shows no spinner. A spinner shows only after 300 ms (`useDelayed`).
- The first load of a thread shows a skeleton, not a spinner.
- Every network wait has a timeout and then an error with a Retry.

## 11. Empty, error and offline states

Each one has an icon, one sentence that says what is true, and an action when one exists.

| Where | State | Message + action |
|---|---|---|
| Board | no computers | "No computers yet." + Add a computer |
| Picker, menu search | no match | "No match." |
| Board | all quiet | "All quiet. Nothing needs you." |
| Board | computer offline | "<computer> is offline · seen 5m ago" + Retry |
| Usage, Automations | host offline or error | the cause + Retry |
| Pairing, discovery | nothing found or failed | the cause + Retry / Add manually |

## 12. Accessibility

- Every control has an `accessibilityLabel` and a role; icon buttons announce their state (selected, expanded, busy, disabled).
- Menu sheet: VoiceOver stays in the sheet (`accessibilityViewIsModal`). Each row is a button with its label, value and detail; picker rows announce "selected"; a disabled row announces "dimmed". The escape gesture and the close button close it.
- A `PickerRow` reads as its title with the current value, and its hint says that it opens a list.
- Gestures have a visible or VoiceOver alternative: the Board card has custom actions for swipe and long press, and the plain-row style also has a "⋯" button.
- Status changes on the Board are announced ("api moved to Needs you") without moving focus, at most one per 2 s.
- Hold-to-talk also works as tap-to-toggle, and has a VoiceOver action.
- Test at the largest accessibility text size and with Reduce Motion on before you ship.

## Pre-delivery checklist

- [ ] Only tokens: no raw hex, opacity, scale, size or duration in components.
- [ ] Three surfaces only: glass for floating chrome, grouped lists for choices and settings, tiles for live previews. No glass in content.
- [ ] One control per job (S2): no selector chips, no filter chips, no outline buttons, no pill-shaped selectors.
- [ ] Every action list is a `MenuSheet` (`showMenu` or `showActionSheet`); never `ActionSheetIOS`. Destructive rows sit last and ask first.
- [ ] Every choice from a list that can grow is a `PickerRow` + `PickerSheet`; 2 to 4 fixed options are a `Segmented`.
- [ ] At most one primary button per screen, in the `ActionBar` at the bottom.
- [ ] Screen skeleton: native header, at most two header buttons, `Screen` insets, the last content clears the tab bar and the `ActionBar`.
- [ ] Gold only on a primary action, the working lantern, or a selected state.
- [ ] Status shows a word + color (dot + word).
- [ ] No bordered card around a list item; no icon in a section header.
- [ ] Touch targets 44 pt; 8 pt between targets.
- [ ] Press feedback in 150 ms or less; no layout shift on press.
- [ ] Reduce Motion: no scale, rotation or slide.
- [ ] Largest text size: titles wrap, dense rows stay readable, menu rows grow and the sheet scrolls, nothing overlaps.
- [ ] Sheets: close button, draft confirm, keyboard does not cover the composer or a menu.
- [ ] Haptics follow the table; none on scroll or typing.
- [ ] Empty, error and offline states have a message and a Retry.
- [ ] VoiceOver: labels, order, custom actions, live announcements, selected and disabled states.
- [ ] The screen works on Android too.

## Session screen patterns (plan F2)

- **Pages of a tab.** A strip under the session header: one `dot.size` dot per pane (the open one
  in `text`, a pane that needs you in ember, others in `divider`), the tab name and "2 of 3" in
  `caption` muted, and a tab map button. The tab map is a page sheet with one tile per pane; the
  open pane has a 2 pt accent edge (selected state), a pane that needs you has the ember edge and
  `blockedTint`.
- **In-app banner.** A glass card at the top (radius `lg`, `edge` border), the status icon
  (ember hand, sage check, terminal), the title in bold and one muted line. It enters in
  `motion.enterMs` and stays 5 s. Never for the open session.
- **Key bar.** A key is a small secondary button (S2): a `raised` fill with no edge, 44 pt high,
  radius `sm`, `raisedHigh` when pressed. ^C has the `danger` label. An armed Ctrl or Alt has the
  accent label (selected state); a locked one also has the `accentTint` fill. Custom keys come
  after the arrows with the same look. The drag pad (`raised`) sits at the right, outside the
  paged row. Page dots under the bar only when it overflows.

