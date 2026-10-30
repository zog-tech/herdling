import type { LucideIcon } from "lucide-react-native";
import { Pressable } from "react-native";

import { colors, hitTarget, radius, space, state } from "@/theme/tokens";
import { DelayedSpinner } from "@/ui/Delayed";
import { Text } from "./Text";

type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  Icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  /** Icon-only button: hides the label text but keeps it as accessibility label. */
  iconOnly?: boolean;
};

export function Button({ label, onPress, variant = "primary", Icon, loading, disabled, iconOnly }: Props) {
  const fg = variant === "primary" ? colors.bg : variant === "danger" ? colors.danger : colors.text;
  const bg = variant === "primary" ? colors.accent : "transparent";
  const border = variant === "primary" ? colors.accent : variant === "danger" ? colors.danger : colors.border;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        minWidth: hitTarget,
        paddingHorizontal: iconOnly ? 0 : space.lg,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: bg,
        opacity: off ? state.disabledOpacity : pressed ? state.pressedFill : 1,
      })}
    >
      {loading ? <DelayedSpinner color={fg} fallback={Icon ? <Icon size={18} color={fg} /> : null} /> : Icon ? <Icon size={18} color={fg} /> : null}
      {iconOnly ? null : (
        <Text color={fg} bold>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
