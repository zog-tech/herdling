# Cohesion redesign

## Intent

The app grew feature by feature. Each feature brought its own layout and its own controls, so the
app does not feel like one product. The maintainer's words: "not cohesive", "slapped together",
"some things are chips, some are glass", "the session screen looks cramped", "the menu options
look old and tacky", "I hate the bubble selectors".

The colors, the type scale and the "Night Watch" idea stay. The structure changes: one small set
of surfaces and controls, one screen skeleton, one menu, and less navigation at the top level.

## Goals

- Each job has exactly one control, the same on every screen.
- A choice keeps its position. No control moves when a list grows.
- Each screen shows its title, its content and at most one primary action.
- The session screen gives more height to the thread.
- All changes are JavaScript only, so they ship as an OTA update.

## Non-goals

- No new colors, fonts or themes. No light theme.
- No new native dependency and no change to `app/app.json` or `app/modules/`.
- No change to the RPC protocol, the state machines or the behavior of a feature.
- No removal of a feature. A feature can move, but the user can still reach it.

## Anti-goals

- A second style for the same job (for example a new chip type for one screen).
- A raw color, size or duration in a component.
- An iOS-only result. Each screen must work on Android too.

## Rule 1: three surfaces

| Surface | Where | Never |
|---|---|---|
| **Glass** | Chrome that floats over content: the system header buttons, the system tab bar, the composer, a bottom action bar | In content. No glass card, no glass row, no glass chip |
| **Grouped list** (`ui/Group` + `ui/Row` on `card`) | Every choice, every setting, every menu, every list of things | — |
| **Tile** (`card` + `divider` or status edge) | A preview of live content: a pane thumbnail, a dashboard tile, an agent card | For a choice or an action |

Anything else sits flat on `bg`.

## Rule 2: one control per job

| Job | Control | Notes |
|---|---|---|
| The main action of a screen | `Button` primary (accent fill), full width, in `ui/ActionBar` pinned at the bottom | At most one per screen |
| A second action | `Button` secondary: `raised` fill, no border, `text` label | Next to or above the primary in the `ActionBar`, or in content |
| A low action | `Button` ghost: no fill, no border | |
| A destructive action | `Button` danger: no border, `danger` label on `raised`; in a menu: a `danger` row in the last section | Always asks first, as today |
| Choose 1 of 2 to 4 fixed options | `ui/Segmented` | The options never change at run time |
| Choose 1 of a list that can grow (computer, space, tab, folder, agent, model, voice) | `ui/PickerRow`: a `Row` with the title at the left and the current value + chevron at the right. A tap opens `ui/PickerSheet`: a list with a check on the current value | Replaces every selector chip |
| On or off | `GoldSwitch` in a `Row` | |
| A set of actions on a thing ("⋯", long press) | `ui/MenuSheet` | Replaces `ActionSheetIOS` on iOS too |
| Filter a list | `Segmented` for 2 to 4 fixed filters, else a header menu button that opens a `MenuSheet` with checks | No filter chips |
| A shortcut that fills or sends text (saved prompt, recent command, pasted text) | `ui/Tag`-style token: `raised` fill, no border, radius `md` (a rounded rectangle, not a pill), 36 pt visual in a 44 pt target | The only chip-like thing left. Never shows a selected state |

Removed: `newSession/Chip`, `spaces` `TabChip`, the outline (`border`) button, the outline icon
button, pill-shaped selectors. The pill radius stays only for the status dot, the switch, the
send button and the system glass controls.

## Rule 3: one menu (`ui/MenuSheet`)

A bottom sheet in the app's own style. It replaces the system action sheet on iOS and the
current Android sheet.

- Layout: an optional title and one line of detail at the top, then sections. A section is a
  `Group` of rows. A row: a lucide icon (20 pt, `textMuted`), a label (`body`), an optional value
  at the right (`callout`, `textMuted`) or a check, 52 pt high.
- Destructive rows are in the last section, with `danger` icon and label.
- No "Cancel" row. The sheet closes on a tap outside, a swipe down and a close button in its header
  (MASTER.md section 8).
- Motion and haptics follow MASTER.md: it enters in `motion.enterMs`, a spring when the finger
  moves it, `haptics.press()` on open, `haptics.tap()` on a pick, `haptics.warn()` when a
  destructive confirm comes up. Reduce Motion: fade only.
- The surface is `card` with the top highlight, radius `lg` at the top, the system bottom inset.
- API: `showMenu({ title?, detail?, sections: [{ title?, items: [{ label, Icon?, value?, checked?,
  destructive?, disabled?, onPick }] }] })`, rendered by one host in the root layout.
- `showActionSheet(options, onPick)` keeps its signature and now draws through the same sheet on
  both platforms (one section, the destructive indexes in a last section, no Cancel row; a close
  without a pick calls `onPick(cancelButtonIndex)` as the system sheet does). Old call sites thus
  get the new look with no change. Screens move to `showMenu` when they want icons and sections.
- `PickerSheet` is the same sheet with checked rows and an optional search field for long lists.

## Rule 4: one screen skeleton

- Header: the native stack header with the screen title. Header buttons are icon buttons
  (the system puts them on glass). At most two at the right; more go in a "⋯" `MenuSheet`.
- Content: `ui/Screen`. Horizontal inset `space.lg`. Sections are `Section` + `Group`.
  The gap between sections is `space.xl`. The last content clears the tab bar and the `ActionBar`
  (bottom inset), so nothing stays under them at the end of the scroll.
- Bottom: `ui/ActionBar` when the screen has a primary action: a glass (or `glassFallback`) bar
  above the safe area with the primary button and at most one secondary. Buttons never float in
  the middle of an empty page.
- Empty state: `StateNotice` in the center of the content area: icon, one sentence, one action.

## Rule 5: three tabs

`Agents` (the route `(overview)`), `Spaces`, `More` (the route `settings`). The route names stay,
so deep links and push routing do not change.

- Usage and Automations leave the tab bar. They become stack screens (`/usage`, `/automations`)
  that open from rows at the top of `More`. The Usage row shows the current plan use as its value
  when the data is there.
- `More` is a short index of rows. Each row opens one page:
  Computers (the host list, Add host, Try the demo) · Usage · Automations · Appearance (theme,
  accent, terminal theme, agent list style, overview top) · Voice (speak replies, what to read,
  voice engine, voice, speed, test voice, voice input engine and models, download over cellular,
  Bluetooth microphone) · Notifications · Terminal (renderer, key bar) · Prompts (saved prompts) ·
  General (haptics) · Diagnostics (speech log, display log, crash log) · About.
  Each index row shows its icon and the current value where one value sums it up.
- Every setting that exists today exists after the change, with the same stored key and effect.

## Screens

### New session (`app/new.tsx`, `newSession/`)

One screen with no scroll in the common case. Top to bottom:

1. A `Group` of setup rows. Each row keeps its place:
   - **Computer** — `PickerRow` (hidden when there is one computer).
   - **Agent** — `PickerRow` with the agent mark (Claude Code, Codex, …, Shell).
   - **Folder** — `PickerRow` with the path in mono, middle-truncated. It opens the folder browser as
     its own page or sheet. Recent folders are rows at the top of that browser.
   - **Space** — `PickerRow`. "New space" is the first row of the list. The "Where" choice
     (new workspace or new tab in the existing one) joins this picker or becomes a `Segmented`.
   - **New git worktree** — switch row, only in a git repo. Its extra fields show under it when on.
   - **Permissions** — `PickerRow` (replaces the red outline pill). "Skip permissions" shows its
     warning as the row detail in `danger` with the warning icon.
   - **Options** — a row that opens the start options sheet (replaces the "Options" pill).
2. **Recent sessions** of this agent, as rows (when there are any).
3. Pinned at the bottom: the first prompt box with the mic (the composer look of the session
   screen), then the primary button "Start <agent> here" and the folder path in `caption` mono.

The logic, the state and the tests of the flow stay. Only the presentation changes.

### Spaces list and space screen (`app/(tabs)/spaces/`, `spaces/`)

- List row: the group tile, the name, and one detail line in words: the folder (short path) and
  the counts, for example "~/dev/apps/webapp · 3 panes · 1 working". Two spaces with the same
  name thus differ by their folder. The tab map cells stay at the right of the detail line or
  under it, but the words carry the meaning. The status word + dot shows for needs you and working.
- Computer headers: the `section` label with the online dot and the count.
- Space screen: the header shows the space name; a "⋯" header button opens a `MenuSheet`
  (Rename space, Close space). Tabs: none shown for one tab, `Segmented` for 2 to 4, a
  `PickerRow` for more. The pane thumbnails are tiles in a 2-column grid. An empty tab shows a
  centered `StateNotice` with its message. The `ActionBar` holds "New agent" (primary) and
  "Terminal" (secondary).

### Session (`app/session/`, `thread/SessionDetail.tsx`, `thread/`, `terminal/`)

- One header row: back, the agent mark, the title (2 lines allowed before it truncates) and the
  "host · agent · model" line, then at the right a compact Thread/Terminal switch and "⋯".
- The full-width Thread/Terminal row goes away. Its height goes to the thread.
- The speaker toggle and "Find" move into the menu (the speaker as a row with its state; ⌘F
  stays). The dot on "⋯" stays for its current meaning.
- The "⋯" menu is a `MenuSheet` with icons and sections:
  **This session**: Model (value: the current model), Rename, Speak replies (state), Find ·
  **Work**: Changes, Preview (value: the count), Simulators · **Help**: Why this status? ·
  **History**: Resume older session · last section: Restart, Close (both destructive).
- The "+" menu of the composer and the command menu use the same `MenuSheet` row style.
- Thread spacing: the body text keeps `space.lg` side insets; lists and paragraphs get a little
  more air (paragraph gap `space.md`); the composer stays as it is (it is the reference for glass).

### Agents tab (`app/(tabs)/(overview)/`, `board/`)

- Board filter chips become a `Segmented` (when 2 to 4) or the header filter menu.
- "Group" and "Sort" open a `MenuSheet` with checks.
- The peek sheet actions and long-press menus use the `MenuSheet` row style.
- Tiles and agent cards follow the Tile surface. No outline buttons.

### All other screens

Computers and pairing (`app/hosts/`, `app/pair.tsx`, `hosts/`), Usage, Automations, changes, diff,
preview, devices, mirror, saved prompts, key bar, theme, the log screens, share, jump, resume,
restart, explain: apply rules 1 to 4. Replace each outline button, selector chip and action sheet
with the kit part. Give each screen the skeleton of rule 4.

## Approaches

1. **Mockup first**: a clickable mockup, then the rules, then the screens. Safest for direction.
2. **Kit first, in code** (chosen): build the shared parts in `ui/`, rewrite `MASTER.md`, then move
   every screen to them in parallel. The maintainer asked for the full redesign at once, with
   parallel agents, and judges the result on the phone.
3. **Worst screens first**: fastest, but it repeats the cause of the problem.

## Order of work

1. **Foundation** (one agent): `ui/MenuSheet`, `ui/PickerRow` + `ui/PickerSheet`, `ui/ActionBar`,
   the new `Button` variants, the `Tag` token, the `Screen` bottom inset, `showActionSheet` through
   `MenuSheet`, and `MASTER.md` rewritten to these rules.
2. **Screens** (six agents in parallel, each owns its files): New session · Spaces · Tabs + More +
   settings pages · Session · Agents tab · all other screens.
3. **Review**: type check, all Jest tests, a read of the full diff against this file.

## Left to the builder

The exact component props, the file split of the settings pages, the icon for each menu row, and
the tests. Where this file and a hard constraint of the code differ, keep the behavior and follow
the rule that is closest.
