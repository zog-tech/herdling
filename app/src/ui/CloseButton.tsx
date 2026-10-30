import { X } from "lucide-react-native";
import { Pressable } from "react-native";

import { colors, hitTarget, icon, state } from "@/theme/tokens";

/** The visible close button every sheet has, next to swipe-down. */
export function CloseButton({ onPress, label = "Close" }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: hitTarget,
        height: hitTarget,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? state.pressedOpacity : 1,
      })}
    >
      <X size={icon.header} color={colors.text} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}
