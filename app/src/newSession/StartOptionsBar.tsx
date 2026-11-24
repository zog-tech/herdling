/**
 * The start options as rows of a `Group` (design rule 2), on New session and on the restart
 * screen: "Permissions" and "Thinking" (Pi) are `PickerRow`s that open the picker sheet, and
 * "Options" opens the start options sheet (`app/start-options.tsx`) and shows the model when one
 * is set. A mode with no approval shows its warning as the detail of the Permissions row, in
 * `danger` with the warning icon. The rows read and write the remembered options of the kind.
 *
 * Each row is its own component, because a `Group` puts a divider between its children and
 * a component that renders nothing still takes a row. Use `startOptionRows` to know which rows
 * the kind has.
 */
import { useRouter } from "expo-router";
import { Brain, SlidersHorizontal, TriangleAlert } from "lucide-react-native";

import { Group } from "@/ui/Group";
import { PickerRow } from "@/ui/PickerRow";

import { modeIcon } from "./modeIcon";
import {
  DEFAULT_THINKING_ID,
  extraFlagCount,
  isDanger,
  modelAliases,
  modelLabel,
  modeOf,
  optionsFor,
  thinkingOf,
  withMode,
  withThinking,
  type StartChoice,
} from "./startOptions";
import { choiceFor, rememberChoice, useStartOptionsMemory } from "./startOptionsMemory";

export const DANGER_WARNING = "The agent runs commands and edits files with no approval.";

/** The remembered choice of `kind` now. A pick reads it fresh, so a change made in the meantime stays. */
const storedChoice = (kind: string) => choiceFor(useStartOptionsMemory.getState().byKind, kind);

/** The rows that `kind` has. "Options" is always there: every kind takes extra flags. */
export function startOptionRows(kind: string): { permissions: boolean; thinking: boolean } {
  const opts = optionsFor(kind);
  return { permissions: opts.modes.length > 0, thinking: !!opts.thinking };
}

/** The detail of the Options row: the number of extra flags, when set. */
export function extraFlagsDetail(extra: number): string | undefined {
  if (extra <= 0) return undefined;
  return extra === 1 ? "1 extra flag" : `${extra} extra flags`;
}

type RowProps = { kind: string; choice: StartChoice; disabled?: boolean };

/** The permission mode. Renders nothing for a kind with no modes (check `startOptionRows` first). */
export function PermissionRow({ kind, choice, disabled }: RowProps) {
  const mode = modeOf(kind, choice);
  if (!mode) return null;
  const danger = isDanger(kind, choice);
  return (
    <PickerRow
      title="Permissions"
      Icon={modeIcon(mode)}
      disabled={disabled}
      detail={danger ? DANGER_WARNING : undefined}
      detailTone="danger"
      DetailIcon={danger ? TriangleAlert : undefined}
      picker={{
        title: "Permission mode",
        options: optionsFor(kind).modes.map((m) => ({ value: m.id, label: m.label, detail: m.detail, Icon: modeIcon(m), danger: m.danger })),
        value: mode.id,
        onPick: (id) => rememberChoice(kind, withMode(storedChoice(kind), id)),
      }}
    />
  );
}

/** The thinking level (Pi). Renders nothing for a kind with no levels. */
export function ThinkingRow({ kind, choice, disabled }: RowProps) {
  const thinking = optionsFor(kind).thinking;
  if (!thinking) return null;
  return (
    <PickerRow
      title="Thinking"
      Icon={Brain}
      disabled={disabled}
      picker={{
        options: [{ id: DEFAULT_THINKING_ID, label: "Default" }, ...thinking.levels].map((l) => ({ value: l.id, label: l.label })),
        value: thinkingOf(kind, choice)?.id ?? DEFAULT_THINKING_ID,
        onPick: (id) => rememberChoice(kind, withThinking(storedChoice(kind), id)),
      }}
    />
  );
}

/** "Options": the model as its value and the extra flags as its detail. A tap opens the start options sheet. */
export function OptionsRow({ kind, choice, disabled }: RowProps) {
  const router = useRouter();
  const model = modelLabel(kind, choice);
  // An alias label ("Opus") is a word; a typed model name is an identifier.
  const typedModel = !!model && !modelAliases(kind).some((a) => a.label === model);
  return (
    <PickerRow
      title="Options"
      Icon={SlidersHorizontal}
      value={model}
      placeholder="Default"
      mono={typedModel}
      detail={extraFlagsDetail(extraFlagCount(choice))}
      disabled={disabled}
      accessibilityHint="Opens the start options."
      onPress={() => router.push({ pathname: "/start-options", params: { kind } } as never)}
    />
  );
}

/** The start option rows of `kind` in their own `Group`, for a screen that has no other setup rows. */
export function StartOptionsBar({ kind, choice, disabled }: RowProps) {
  const rows = startOptionRows(kind);
  return (
    <Group>
      {rows.permissions ? <PermissionRow kind={kind} choice={choice} disabled={disabled} /> : null}
      {rows.thinking ? <ThinkingRow kind={kind} choice={choice} disabled={disabled} /> : null}
      <OptionsRow kind={kind} choice={choice} disabled={disabled} />
    </Group>
  );
}
