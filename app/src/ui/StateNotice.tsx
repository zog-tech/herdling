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
          // A quiet text button: a filled capsule, no edge.
          style={({ pressed }) => ({
            minHeight: hitTarget,
            minWidth: hitTarget,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          <View style={{ paddingHorizontal: space.md, paddingVertical: space.xs + 2, borderRadius: radius.pill, backgroundColor: colors.raised }}>
            <Text variant="small" bold>
              {action}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
