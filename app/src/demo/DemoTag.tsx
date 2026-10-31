import { View } from "react-native";

import { colors, denseScale, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

/**
 * A small "Demo" label next to the demo host, so nobody takes it for a real computer.
 * A quiet graphite fill, no edge and no gold: it is a label, not a status and not an action.
 */
export function DemoTag() {
  return (
    <View
      accessible
      accessibilityLabel="Demo host"
      style={{ backgroundColor: colors.raised, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 }}
    >
      <Text variant="caption" muted bold maxFontSizeMultiplier={denseScale.pill}>
        Demo
      </Text>
    </View>
  );
}
