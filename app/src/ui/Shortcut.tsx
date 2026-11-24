import type { LucideIcon } from "lucide-react-native";
import { Pressable, type AccessibilityActionEvent, type AccessibilityActionInfo } from "react-native";

import { colors, denseScale, hitTarget, icon, motion, radius, shortcut, space, state } from "@/theme/tokens";

import { Text } from "./Text";

/** The space around the 36 pt token that makes the touch target 44 pt high. */
const SLOP = (hitTarget - shortcut.height) / 2;

/**
 * A shortcut token (design rule 2): a tap fills or sends a text, for example a saved prompt, a
 * recent command or a pasted text. The only chip-like part of the app. A rounded rectangle
 * (radius `md`) on `raised`, no border, no gold, 36 pt high in a 44 pt touch target. It never
 * shows a selected state: a choice is a `Segmented` or a `PickerRow`.
 *
 * ```tsx
 * <Shortcut
 *   label={promptChipLabel(text)}
 *   accessibilityLabel={`Saved prompt: ${label}`}
 *   onPress={() => onSend(text)}
 *   onLongPress={() => openSavedPromptMenu(text, onPick)}
 * />
 * ```
 */
export function Shortcut({
  label,
  onPress,
  onLongPress,
  Icon,
  mono,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  accessibilityActions,
  onAccessibilityAction,
}: {
  /** One line; it ends with "…" past `shortcut.maxWidth`. */
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  /** A small icon before the label (16 pt, `textMuted`). */
  Icon?: LucideIcon;
  /** The label in JetBrains Mono (a command). */
  mono?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={motion.press.longPressMs}
      hitSlop={{ top: SLOP, bottom: SLOP }}
      style={({ pressed }) => ({
        height: shortcut.height,
        maxWidth: shortcut.maxWidth,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.raisedHigh : colors.raised,
        opacity: disabled ? state.disabledOpacity : 1,
      })}
    >
      {Icon ? <Icon size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} /> : null}
      <Text variant="small" mono={mono} numberOfLines={1} maxFontSizeMultiplier={denseScale.pill} style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}
