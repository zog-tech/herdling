import type { LucideIcon } from "lucide-react-native";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";

import { colors, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import { DelayedSpinner } from "@/ui/Delayed";
import { useHover } from "@/ui/hover";
import { Text } from "./Text";

/**
 * A text button (design rule 2). No variant has a border.
 *
 * | Variant | Look | Job |
 * |---|---|---|
 * | `primary` | accent fill, `onAccent` label | The one main action of a screen, in `ui/ActionBar` |
 * | `secondary` | `raised` fill, `text` label | A second action |
 * | `ghost` | no fill, `text` label | A low action |
 * | `danger` | `raised` fill, `danger` label | A destructive action. The caller asks for a confirm first |
 *
 * Pressed: the primary fill deepens to `accentPressed`; a `raised` fill steps up to `raisedHigh`;
 * a ghost dims to `state.pressedOpacity`. `style` places the button (for example `flex: 1` in a bar).
 *
 * ```tsx
 * <Button label="Start Claude Code here" Icon={Play} onPress={start} loading={starting} />
 * <Button label="Terminal" variant="secondary" Icon={SquareTerminal} onPress={openShell} />
 * ```
 */
type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  Icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  /** Icon-only button: hides the label text but keeps it as accessibility label. */
  iconOnly?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = "primary", Icon, loading, disabled, iconOnly, accessibilityHint, style }: Props) {
  const fg = variant === "primary" ? colors.onAccent : variant === "danger" ? colors.danger : colors.text;
  const fill = variant === "primary" ? colors.accent : variant === "ghost" ? "transparent" : colors.raised;
  const pressedFill = variant === "primary" ? colors.accentPressed : variant === "ghost" ? "transparent" : colors.raisedHigh;
  const off = disabled || loading;
  const { hovered, hoverProps } = useHover();
  // Under the pointer a ghost button gets the hover layer, a raised button the next fill. Gold stays as it is.
  const rest = hovered && !off ? (variant === "ghost" ? state.hoverFill : variant === "primary" ? fill : colors.raisedHigh) : fill;
  const glyph = Icon ? <Icon size={icon.md} color={fg} strokeWidth={icon.strokeWidth} /> : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => [
        {
          minHeight: hitTarget,
          minWidth: hitTarget,
          paddingHorizontal: iconOnly ? 0 : space.lg,
          paddingVertical: space.sm,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          borderRadius: radius.md,
          backgroundColor: pressed ? pressedFill : rest,
          opacity: off ? state.disabledOpacity : pressed && variant === "ghost" ? state.pressedOpacity : 1,
        },
        style,
      ]}
    >
      {loading ? <DelayedSpinner color={fg} fallback={glyph} /> : glyph}
      {iconOnly ? null : (
        <Text color={fg} bold style={{ flexShrink: 1, textAlign: "center" }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
