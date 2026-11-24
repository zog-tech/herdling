import { View } from "react-native";

import { colors, denseScale, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

/**
 * A small quiet label, for example "Demo" next to the demo host or "Herdr 2" on a Herdr 2
 * workspace. A graphite fill, no edge and no gold: it is a label, not a status and not an action.
 * A rounded rectangle, not a pill (the pill radius is only for the status dot, the switch, the send
 * button and the system glass). A tappable token that fills or sends text is `ui/Shortcut`.
 */
export function Tag({ label, accessibilityLabel }: { label: string; accessibilityLabel?: string }) {
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={{ backgroundColor: colors.raised, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: space.xxs }}
    >
      <Text variant="caption" muted bold numberOfLines={1} maxFontSizeMultiplier={denseScale.pill}>
        {label}
      </Text>
    </View>
  );
}
