import { Pressable } from "react-native";

import { colors, denseScale, hitTarget, radius, space } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";

/** A choice chip of New session, 44 pt high. The selected chip is gold (the selected state). */
export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={() => {
        if (!selected) haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        paddingHorizontal: space.lg,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accent : pressed ? colors.raised : "transparent",
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <Text bold color={selected ? colors.onAccent : colors.text} maxFontSizeMultiplier={denseScale.row}>
        {label}
      </Text>
    </Pressable>
  );
}
