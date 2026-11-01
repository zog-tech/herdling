import type { X } from "lucide-react-native";
import { Pressable } from "react-native";

import { colors, hitTarget, icon, state } from "@/theme/tokens";

/** A 44 pt icon button of a browser toolbar: the preview and the in-app browser. */
export function ToolButton({ label, Icon, onPress, disabled }: { label: string; Icon: typeof X; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={2}
      style={({ pressed }) => ({
        width: hitTarget,
        height: hitTarget,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? state.disabledOpacity : pressed ? state.pressedOpacity : 1,
      })}
    >
      <Icon size={icon.md} color={colors.text} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}
