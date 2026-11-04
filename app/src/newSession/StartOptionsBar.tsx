/**
 * The start options as small pills in the start bar of New session and on the restart screen, like
 * the model picker of a chat composer: one tap changes the permission mode or the thinking level
 * with an action sheet. The model pill and the "more" pill open the start options sheet
 * (`app/start-options.tsx`). The pills read and write the remembered options of the kind directly.
 */
import { useRouter } from "expo-router";
import {
  Brain,
  ChevronDown,
  ClipboardList,
  Cpu,
  FilePen,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react-native";
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
  modeOf,
  optionsFor,
  thinkingMenu,
  thinkingOf,
  withMode,
  withThinking,
  type ChoiceMenu,
  type PermissionMode,
  type StartChoice,
} from "./startOptions";
import { rememberChoice } from "./startOptionsMemory";

export const DANGER_WARNING = "The agent runs commands and edits files with no approval.";

/** The field that the options sheet focuses when it opens. */
export type SheetFocus = "model" | "extra";

/** The visual height of a pill. `hitSlop` makes the touch target 44 pt. */
const PILL_HEIGHT = 32;
const SLOP = (hitTarget - PILL_HEIGHT) / 2;

/** The icon of a permission mode. The same icons show for the same kind of mode in every agent. */
function modeIcon(mode: PermissionMode): LucideIcon {
  if (mode.danger) return ShieldAlert;
  if (mode.id === DEFAULT_MODE_ID) return Shield;
  if (mode.id === "plan") return ClipboardList;
  if (mode.id === "acceptEdits" || mode.id === "autoEdit") return FilePen;
  return ShieldCheck;
}

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
      {chevron ? <ChevronDown size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} /> : null}
    </Pressable>
  );
}

/** The icon-only pill that opens the options sheet. A small gold dot shows that extra flags are set. */
function MorePill({ extra, disabled, onPress }: { extra: number; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={extra > 0 ? `More start options, ${extra === 1 ? "1 extra flag" : `${extra} extra flags`}` : "More start options"}
      accessibilityHint="Double tap to change the model and extra flags"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={SLOP}
      style={({ pressed }) => ({
        width: PILL_HEIGHT,
        height: PILL_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.pill,
        backgroundColor: colors.raised,
        opacity: disabled ? state.disabledOpacity : pressed ? state.pressedOpacity : 1,
      })}
    >
      <SlidersHorizontal size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
      {extra > 0 ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: dot.size,
            height: dot.size,
            borderRadius: radius.pill,
            backgroundColor: colors.accent,
          }}
        />
      ) : null}
    </Pressable>
  );
}

/**
 * One row of option pills for `kind`: the permission mode, the thinking level (Pi), the model and
 * "more". `choice` is the remembered choice of the kind (the caller reads it from the store).
 */
export function StartOptionsBar({ kind, choice, disabled }: { kind: string; choice: StartChoice; disabled?: boolean }) {
  const router = useRouter();
  const opts = optionsFor(kind);
  const mode = modeOf(kind, choice);
  const level = thinkingOf(kind, choice);
  const model = choice.model?.trim();
  const openSheet = (focus?: SheetFocus) => {
    haptics.tap();
    router.push({ pathname: "/start-options", params: focus ? { kind, focus } : { kind } } as never);
  };

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
      {opts.modelFlag ? (
        <Pill
          Icon={Cpu}
          label={model || "Model"}
          mono={!!model}
          muted={!model}
          accessibilityLabel={model ? `Model: ${model}` : "Model: the agent's default"}
          accessibilityHint="Double tap to change the model"
          disabled={disabled}
          onPress={() => openSheet("model")}
        />
      ) : null}
      <MorePill extra={extraFlagCount(choice)} disabled={disabled} onPress={() => openSheet()} />
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
