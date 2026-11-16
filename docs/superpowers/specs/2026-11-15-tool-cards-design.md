# Tool cards for code edits and commands: design

Approved by the maintainer on 2026-11-15. Size: a small change.

## Intent

The Thread tab shows each agent tool call as a card. Open, the card shows the raw input as JSON
and the result as plain text. An edit shows as an `old_string` and `new_string` JSON block. The
maintainer wants edits and commands in a clear, designed form, like the demo screenshots.

## Goals

- Edit and MultiEdit: a line diff of the change, with "+N −M" counts in the card header.
- Write: the file path, the line count and the first lines of the content.
- Bash and other shell tools: `$ command`, the description, and the last lines of the output.
  A failed command keeps the red state.
- Read, Grep, Glob: one compact line each. Open, the card shows only the result.
- Codex `apply_patch`: the patch as a diff, one file section per file.
- Any other tool: today's card, unchanged.
- "Expand" (the full tool screen, `app/tool.tsx`) shows the same diff or output at full size.

## Non-goals

- No change to the Terminal tab. It shows the agent's own screen.
- No syntax highlighting.
- No change to herdlingd or the protocol. The app reads the `input` that hosts already send.

## Constraints

- JS-only: it ships as an OTA update to the 1.0.2 tester runtime. No new native dependency.
- The design system: tokens only. The diff rows use `colors.diff.*` and keep the "+" and "−"
  signs, so color is never the only cue (as in `app/diff`).
- Long inputs stay bounded: at most 400 diff rows on a card, with a "Show all" in the full screen.

## Approaches

1. Classify the tool by the keys of its input, in the app (chosen). It works with every host
   version and every agent: Claude (`old_string`), OpenCode (`oldString`), Pi (`oldText`), Codex
   patches (`*** Begin Patch`).
2. Add a typed "edit" item to the protocol in herdlingd. Cleaner data, but old hosts send nothing,
   and it needs a release and protocol rules. Rejected for now.
3. Classify by the tool name only. Fails for agents with other names (`replace`, `write_file`).

## The how (decided)

- A pure module `app/src/thread/toolKinds.ts`: `classifyTool(name, input)` returns one of
  `edit`, `write`, `shell`, `patch`, `lookup` or `other`, with the parsed fields. `lineDiff(old,
  new)` gives `DiffLine[]` (the type of `changes/diff.ts`) from a line LCS, with context lines.
- A component `app/src/thread/items/ToolBody.tsx` draws each kind. The diff rows reuse the look of
  the `app/diff` rows.
- `ToolCard` and `app/tool.tsx` use them. The copy text and the accessibility labels keep the
  raw input.

## Left to the builder

The exact context size of a diff (3 lines), the row cap per card, and the icon per kind.
