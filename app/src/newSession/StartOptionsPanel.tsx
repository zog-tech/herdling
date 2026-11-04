import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { colors, denseScale, hitTarget, icon, space, state } from "@/theme/tokens";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";

import { Chip } from "./Chip";
import { DEFAULT_MODE_ID, isDanger, modeOf, optionsFor, summary, thinkingOf, type StartChoice } from "./startOptions";

export const DANGER_WARNING = "The agent runs commands and edits files with no approval.";

function ChipRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="small" muted>
        {title}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{children}</View>
    </View>
  );
}

/**
 * The "Options" row of New session, under the agent picker: collapsed, it shows a short summary
 * ("Default", "Plan · opus"). Expanded: the permission mode, the model, the thinking level (Pi)
 * and extra flags. A mode with no approval shows a warning in the danger color, also when collapsed.
 * `onChange` gets each change; `onCommit` asks the parent to remember the text fields (on blur).
 */
export function StartOptionsPanel({
  kind,
  choice,
  onChange,
  onCommit,
  disabled,
}: {
  kind: string;
  choice: StartChoice;
  onChange: (choice: StartChoice, remember: boolean) => void;
  onCommit: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const opts = optionsFor(kind);
  const danger = isDanger(kind, choice);
  const text = summary(kind, choice);
  const mode = modeOf(kind, choice);
  const level = thinkingOf(kind, choice);
  const Chevron = open ? ChevronDown : ChevronRight;
  const set = (patch: Partial<StartChoice>, remember: boolean) => onChange({ ...choice, ...patch }, remember);

  return (
    <Card style={{ gap: space.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Start options: ${text}`}
        accessibilityHint={open ? "Double tap to hide the start options" : "Double tap to show the start options"}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          haptics.tap();
          setOpen(!open);
        }}
        style={({ pressed }) => ({
          minHeight: hitTarget,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          opacity: pressed ? state.pressedOpacity : 1,
        })}
      >
        <Text maxFontSizeMultiplier={denseScale.row}>Options</Text>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.xs }}>
          {danger ? <TriangleAlert size={icon.sm} color={colors.danger} strokeWidth={icon.strokeWidth} /> : null}
          <Text
            variant="small"
            color={danger ? colors.danger : colors.textMuted}
            numberOfLines={1}
            maxFontSizeMultiplier={denseScale.row}
            style={{ flexShrink: 1 }}
          >
            {text}
          </Text>
        </View>
        <Chevron size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
      </Pressable>

      {danger ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
          <TriangleAlert size={icon.sm} color={colors.danger} strokeWidth={icon.strokeWidth} />
          <Text variant="small" color={colors.danger} style={{ flex: 1 }}>
            {DANGER_WARNING}
          </Text>
        </View>
      ) : null}

      {open ? (
        <View style={{ gap: space.md }}>
          {opts.modes.length > 0 ? (
            <ChipRow title="Permission mode">
              {opts.modes.map((m) => (
                <Chip
                  key={m.id}
                  label={m.label}
                  accessibilityLabel={`Mode ${m.label}`}
                  selected={m.id === (mode?.id ?? DEFAULT_MODE_ID)}
                  disabled={disabled}
                  onPress={() => set({ mode: m.id === DEFAULT_MODE_ID ? undefined : m.id }, true)}
                />
              ))}
            </ChipRow>
          ) : null}
          {opts.modelFlag ? (
            <Field
              label="Model"
              mono
              value={choice.model ?? ""}
              onChangeText={(t) => set({ model: t }, false)}
              onEndEditing={onCommit}
              editable={!disabled}
              placeholder="The agent's default"
              spellCheck={false}
            />
          ) : null}
          {opts.thinking ? (
            <ChipRow title="Thinking">
              <Chip
                label="Default"
                accessibilityLabel="Thinking Default"
                selected={!level}
                disabled={disabled}
                onPress={() => set({ thinking: undefined }, true)}
              />
              {opts.thinking.levels.map((l) => (
                <Chip
                  key={l.id}
                  label={l.label}
                  accessibilityLabel={`Thinking ${l.label}`}
                  selected={l.id === level?.id}
                  disabled={disabled}
                  onPress={() => set({ thinking: l.id }, true)}
                />
              ))}
            </ChipRow>
          ) : null}
          <Field
            label="Extra flags"
            mono
            value={choice.extra ?? ""}
            onChangeText={(t) => set({ extra: t }, false)}
            onEndEditing={onCommit}
            editable={!disabled}
            placeholder="--flag value"
            spellCheck={false}
          />
        </View>
      ) : null}
    </Card>
  );
}
