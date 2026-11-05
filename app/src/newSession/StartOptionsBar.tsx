/**
 * The start options as small pills in the start bar of New session and on the restart screen, like
 * the model picker of a chat composer: one tap changes the permission mode or the thinking level
 * with an action sheet. The "Options" pill opens the start options sheet (`app/start-options.tsx`)
 * and shows the model when one is set. The pills read and write the remembered options of the kind directly.
 */
import { useRouter } from "expo-router";
import { Brain, ChevronDown, SlidersHorizontal, TriangleAlert, type LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { colors, denseScale, dot, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { showActionSheet } from "@/ui/nativeSheet";
import { Text } from "@/ui/Text";

import {
  DEFAULT_MODE_ID,
  extraFlagCount,
  isDanger,
  modeMenu,
  modelAliases,
  modelLabel,
  modeOf,
  thinkingMenu,
  thinkingOf,
  optionsFor,
  withMode,
  withThinking,
  type ChoiceMenu,
  type StartChoice,
} from "./startOptions";
import { modeIcon } from "./modeIcon";
import { rememberChoice } from "./startOptionsMemory";

export const DANGER_WARNING = "The agent runs commands and edits files with no approval.";

/** The visual height of a pill. `hitSlop` makes the touch target 44 pt. */
const PILL_HEIGHT = 32;
const SLOP = (hitTarget - PILL_HEIGHT) / 2;

/** Shows `menu` as an action sheet and gives the picked id to `onPick`. Cancel picks nothing. */
function pickFrom(title: string, menu: ChoiceMenu, onPick: (id: string) => void) {
  haptics.tap();
  showActionSheet(
    {
      title,
      options: menu.options,
      cancelButtonIndex: menu.cancelButtonIndex,
      destructiveButtonIndex: menu.destructiveButtonIndex.length > 0 ? menu.destructiveButtonIndex : undefined,
    },
    (i) => {
      const id = menu.ids[i];
      if (id !== undefined) onPick(id);
    },
  );
}

function Pill({
  Icon,
  label,
  muted,
  danger,
  mono,
  chevron,
  marked,
  accessibilityLabel,
  accessibilityHint,
  disabled,
  onPress,
}: {
  Icon: LucideIcon;
  label: string;
  muted?: boolean;
  danger?: boolean;
  mono?: boolean;
  chevron?: boolean;
  /** A small dot after the label: more options are set than the label shows. */
  marked?: boolean;
  accessibilityLabel: string;
  accessibilityHint: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const tint = danger ? colors.danger : muted ? colors.textMuted : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: SLOP, bottom: SLOP }}
      style={({ pressed }) => ({
        minHeight: PILL_HEIGHT,
        maxWidth: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        // A control on glass has a solid fill (MASTER §0). The edge is always there, so a danger
        // mode changes only its color, not the size.
        borderWidth: 1,
        borderColor: danger ? colors.danger : "transparent",
        backgroundColor: colors.raised,
        opacity: disabled ? state.disabledOpacity : pressed ? state.pressedOpacity : 1,
      })}
    >
      <Icon size={icon.sm} color={tint} strokeWidth={icon.strokeWidth} />
      <Text variant="small" mono={mono} color={tint} numberOfLines={1} maxFontSizeMultiplier={denseScale.pill} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      {marked ? <View style={{ width: dot.size, height: dot.size, borderRadius: radius.pill, backgroundColor: colors.text }} /> : null}
      {chevron ? <ChevronDown size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} /> : null}
    </Pressable>
  );
}

/** The VoiceOver label of the "Options" pill: the model and the number of extra flags, when set. */
function optionsLabel(model: string | undefined, extra: number): string {
  const parts = ["Start options"];
  if (model) parts.push(`model ${model}`);
  if (extra > 0) parts.push(extra === 1 ? "1 extra flag" : `${extra} extra flags`);
  return parts.join(", ");
}

/**
 * One row of option pills for `kind`: the permission mode, the thinking level (Pi) and "Options".
 * `choice` is the remembered choice of the kind (the caller reads it from the store).
 */
export function StartOptionsBar({ kind, choice, disabled }: { kind: string; choice: StartChoice; disabled?: boolean }) {
  const router = useRouter();
  const opts = optionsFor(kind);
  const mode = modeOf(kind, choice);
  const level = thinkingOf(kind, choice);
  const model = modelLabel(kind, choice);
  const extra = extraFlagCount(choice);
  // An alias label ("Opus") is a word; a typed model name is an identifier.
  const typedModel = !!model && !modelAliases(kind).some((a) => a.label === model);

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
      {mode ? (
        <Pill
          Icon={modeIcon(mode)}
          label={mode.label}
          muted={mode.id === DEFAULT_MODE_ID}
          danger={mode.danger}
          chevron
          accessibilityLabel={`Permission mode: ${mode.label}`}
          accessibilityHint="Double tap to change the permission mode"
          disabled={disabled}
          onPress={() => {
            const menu = modeMenu(kind, choice);
            if (menu) pickFrom("Permission mode", menu, (id) => rememberChoice(kind, withMode(choice, id)));
          }}
        />
      ) : null}
      {opts.thinking ? (
        <Pill
          Icon={Brain}
          label={`Thinking: ${level?.label ?? "Default"}`}
          muted={!level}
          chevron
          accessibilityLabel={`Thinking: ${level?.label ?? "Default"}`}
          accessibilityHint="Double tap to change the thinking level"
          disabled={disabled}
          onPress={() => {
            const menu = thinkingMenu(kind, choice);
            if (menu) pickFrom("Thinking", menu, (id) => rememberChoice(kind, withThinking(choice, id)));
          }}
        />
      ) : null}
      <Pill
        Icon={SlidersHorizontal}
        label={model ?? "Options"}
        mono={typedModel}
        muted={!model && extra === 0}
        marked={extra > 0}
        accessibilityLabel={optionsLabel(model, extra)}
        accessibilityHint="Double tap to open the start options"
        disabled={disabled}
        onPress={() => {
          haptics.tap();
          router.push({ pathname: "/start-options", params: { kind } } as never);
        }}
      />
    </View>
  );
}

/** The warning line for a mode with no approval. Shows nothing for a safe mode. */
export function DangerWarning({ kind, choice }: { kind: string; choice: StartChoice }) {
  if (!isDanger(kind, choice)) return null;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
      <TriangleAlert size={icon.sm} color={colors.danger} strokeWidth={icon.strokeWidth} />
      <Text variant="small" color={colors.danger} style={{ flex: 1 }}>
        {DANGER_WARNING}
      </Text>
    </View>
  );
}
