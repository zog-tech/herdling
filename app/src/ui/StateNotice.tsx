import type { LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { colors, hitTarget, icon, radius, space, state } from "@/theme/tokens";

import { Text } from "./Text";

/**
 * An empty, error or offline state: an icon, one sentence that says what is true, and an action
 * when one exists (Retry, Add a host). Announced politely to VoiceOver.
 */
export function StateNotice({
  Icon,
  message,
  color = colors.textMuted,
  action,
  onAction,
}: {
  Icon: LucideIcon;
  message: string;
  color?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: hitTarget }}>
      <Icon size={icon.sm} color={color} />
      <Text variant="small" color={color} style={{ flex: 1 }}>
        {message}
      </Text>
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          onPress={onAction}
          hitSlop={4}
          style={({ pressed }) => ({
            minHeight: hitTarget,
            minWidth: hitTarget,
            paddingHorizontal: space.md,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          <Text variant="small" bold>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
